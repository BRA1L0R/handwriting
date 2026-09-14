import { CameraState } from "../camera/coordinates";
import { countPaintedPixels } from "../diag/Raster";
import { PenStyle, widthForPressure } from "./PenStyle";
import { InkPoint } from "./Stroke";
import { IncrementalSmoother, Point2 } from "./Smoothing";
import { RibbonPt, flattenSegment, flattenSegmentHw } from "./Ribbon";
import { IncrementalShaper, centerlineSmoothed, inkShapingEnabled } from "./InkShape";
import { fillRibbon } from "./RibbonRenderer";
import { inkColorFor } from "./InkTheme";
import { drawSegment } from "./StrokeRenderer";
import { strokeWidthPolicy, type PressureProfile } from "./StrokeWidth";

/**
 * The wet ink layer: incremental screen-space drawing of the stroke that is
 * currently being written (handoff §7). The latency path is:
 *
 *   PointerEvent -> convert to world -> drawSegment -> return
 *
 * No full-page rerender, no rAF wait. Segments are painted synchronously in
 * the pointer handler for minimum perceived latency.
 *
 * v0.1.2: the `desynchronized` context attribute is a request, not a promise.
 * Chromium decides whether a canvas is eligible for the low-latency path based
 * on compositing state, which is not necessarily settled at getContext() time.
 * So we snapshot getContextAttributes() at three moments (creation, after the
 * first real draw, and on demand) instead of trusting a single early read.
 */

export interface CanvasAttrs {
	alpha?: boolean;
	desynchronized?: boolean;
	willReadFrequently?: boolean;
	colorSpace?: string;
}

export class WetInkRenderer {
	private ctx: CanvasRenderingContext2D;
	private lastPoint: InkPoint | undefined;
	private smoother = new IncrementalSmoother();
	private lastRibbon: RibbonPt | undefined;
	/** Screen box of everything this stroke has painted, for clearStroke. */
	private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
	private blank = false;
	private strokeOwnsAllPixels = false;
	private incompletePaint = false;
	private backingScale = 1;
	beforeWrite?: () => void;
	get provenBlank(): boolean { return this.blank; }
	noteBackingCleared(): void { this.blank = true; this.strokeOwnsAllPixels = true; this.incompletePaint = false; }
	notePixelsChanged(): void { this.blank = false; this.strokeOwnsAllPixels = false; }
	/**
	 * The band moved under a live stroke (InkOverlay.carryBandUnderLock): slide
	 * every pixel by a whole number of device px so the ink stays where it is
	 * on screen, and slide the dirty box with it so the stroke's own clear
	 * still finds its pixels. `shiftX/Y` are css px, already snapped by the
	 * caller to a multiple of 1/backingScale. World-space state (last point,
	 * ribbon, smoother) is untouched: the camera moved by the same delta.
	 */
	carry(shiftX: number, shiftY: number): void {
		if (shiftX === 0 && shiftY === 0) return;
		this.beforeWrite?.();
		const ctx = this.ctx, b = this.backingScale;
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalCompositeOperation = "copy";
		ctx.drawImage(this.canvas, Math.round(shiftX * b), Math.round(shiftY * b));
		ctx.restore();
		if (this.dirty) this.dirty = { x0: this.dirty.x0 + shiftX, y0: this.dirty.y0 + shiftY, x1: this.dirty.x1 + shiftX, y1: this.dirty.y1 + shiftY };
	}
	private fullClearCovers(width: number, height: number): boolean {
		return Number.isFinite(width) && Number.isFinite(height) && this.backingScale > 0 &&
			width >= this.canvas.width / this.backingScale && height >= this.canvas.height / this.backingScale;
	}
	private markPaint(): void {
		this.beforeWrite?.();
		this.blank = false;
	}

	/** What we asked Chromium for. */
	readonly requested: boolean;
	/** getContextAttributes() immediately after getContext(). */
	readonly attrsAtCreate: CanvasAttrs | undefined;
	/** getContextAttributes() sampled after the first segment was painted. */
	attrsAfterFirstDraw: CanvasAttrs | undefined;
	private drewOnce = false;

	constructor(private canvas: HTMLCanvasElement, desynchronized: boolean) {
		this.requested = desynchronized;
		const ctx = canvas.getContext("2d", { desynchronized });
		if (!ctx) throw new Error("Handwriting: could not acquire wet ink 2d context");
		this.ctx = ctx;
		this.attrsAtCreate = this.currentAttrs();
	}

	currentAttrs(): CanvasAttrs | undefined {
		return (
			this.ctx as CanvasRenderingContext2D & {
				getContextAttributes?: () => CanvasAttrs;
			}
		).getContextAttributes?.();
	}

	/** Best current answer to "is this actually a low-latency canvas?". */
	get actualDesynchronized(): boolean | undefined {
		return this.currentAttrs()?.desynchronized;
	}

	/** Compact one-line report for the metrics panel / export. */
	describe(): string {
		const at = (a: CanvasAttrs | undefined) =>
			a ? String(a.desynchronized) : "n/a";
		return (
			`req ${this.requested} | at-create ${at(this.attrsAtCreate)}` +
			` | post-draw ${at(this.attrsAfterFirstDraw)} | now ${at(this.currentAttrs())}`
		);
	}

	/** Call after the canvas backing store has been resized (dpr-scaled). */
	applyDpr(dpr: number): void {
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.backingScale = dpr;
	}

	/**
	 * Smoothed rendering geometry. When on, this canvas holds the SETTLED tail
	 * only: every segment behind the newest sample, curved and final. The
	 * unsmoothed head that reaches the nib is drawn by the caller on an overlay
	 * layer, because it has to be erased and redrawn on every event and this
	 * canvas is append-only.
	 */
	smooth = false;
	/**
	 * Whether this layer's DEVICE may take the shaped width law (InkShape).
	 * The overlay clears it for a mouse stroke, which is never shaped. It is
	 * a device-and-layer fact and says nothing about the tool: the tool's
	 * flatness arrives per stroke, as `beginStroke`'s `flat` argument, because
	 * a surface may serve pen and highlighter from ONE wet layer (the PDF
	 * does). The global shaping switch is consulted per stroke at beginStroke.
	 */
	shape = false;
	private shaper = new IncrementalShaper();
	private shapingThisStroke = false;
	/**
	 * Smoothed centerline for this stroke, decided once at pen-down from the
	 * one source (InkShape.centerlineSmoothed) the committed renderer reads.
	 *
	 * The wet layer has to make the same choice as the commit or the slice is
	 * pointless: draw the midpoint-quadratic here and the raw polyline there
	 * and the stroke would visibly reshape at pen-up, which is the jump this
	 * change exists to remove. Decided at pen-down rather than per sample so a
	 * setting toggled mid-stroke cannot split one stroke into two geometries.
	 */
	private smoothThisStroke = true;
	private lastMidHw: number | undefined;
	private prevSampleHw = 0;
	private strokeStyle: PenStyle | undefined;

	/**
	 * Start a stroke. `flat` is the TOOL's flatness - true for the
	 * highlighter, whose chisel wash is exempt from both the shaped width law
	 * and the raw centerline - and it has to be passed rather than inferred.
	 *
	 * It used to be inferred as `!this.shape`, and `shape` is a
	 * device-and-layer fact: false for a MOUSE stroke, whose ink was
	 * therefore drawn smoothed while its commit followed the setting; and
	 * permanently true on the PDF surface, whose single wet pair serves both
	 * tools, so the same inference there would have handed the highlighter
	 * the exact inverse of its exemption. The committed renderer reads the
	 * tool (StrokeRenderer.drawStroke) and the two must agree at pen-up.
	 */
	beginStroke(first: InkPoint, style?: PenStyle, flat = false, pressureProfile?: PressureProfile): void {
		const profile = pressureProfile;
		this.strokeStyle = style && !flat && profile === "exp7"
			? strokeWidthPolicy(style, undefined, profile).style
			: undefined;
		style = this.strokeStyle ?? style;
		this.lastPoint = first;
		this.smoother.reset(first);
		this.lastRibbon = undefined;
		this.strokeOwnsAllPixels = this.blank;
		this.dirty = null;
		// The committed rule, restated: shaped only for a non-flat tool on a
		// device that shapes, with the switch on (drawStroke's `shaping`).
		this.shapingThisStroke = this.shape && !flat && inkShapingEnabled();
		this.smoothThisStroke = centerlineSmoothed(flat);
		if (this.shapingThisStroke) {
			this.shaper.reset(first, style);
			this.prevSampleHw = this.shaper.last();
			this.lastMidHw = undefined;
		}
	}

	appendPoint(cam: CameraState, style: PenStyle, point: InkPoint): void {
		if (this.lastPoint) this.markPaint();
		const incomplete = this.incompletePaint;
		this.incompletePaint = true;
		style = this.strokeStyle ?? style;
		if (this.lastPoint) {
			if (this.smooth && !this.smoothThisStroke) {
				// Raw centerline: the ribbon runs straight from the previous
				// sample to this one, so it already reaches the nib and there
				// is no settled/head split to make - no lag to hide, and
				// nothing left over to close at pen-up. Same per-sample width
				// law as the committed raw path (Ribbon.flattenStroke with
				// smooth off), so the wet strip and the commit are the same
				// geometry to the last point.
				const prev = this.lastPoint;
				const rp = (p: InkPoint): RibbonPt => ({
					x: p.x,
					y: p.y,
					hw: widthForPressure(style, p.pressure) / 2,
				});
				const strip: RibbonPt[] = [this.lastRibbon ?? rp(prev), rp(point)];
				fillRibbon(this.ctx, cam, strip, inkColorFor(style));
				this.growDirtyStrip(cam, strip);
				this.lastRibbon = strip[strip.length - 1];
			} else if (this.smooth) {
				// Emits the segment that just became final, one sample behind
				// the pen. The head covers the rest.
				const sampleHw = this.shapingThisStroke
					? this.shaper.push(style, point)
					: 0;
				const seg = this.smoother.push(point);
				if (seg) {
					// Same ribbon construction the committed layer uses, emitted
					// one segment at a time so the pen path stays O(1). The strip
					// starts at the previous strip's last point, so consecutive
					// fills share an edge exactly and leave no seam.
					let flatSeg: RibbonPt[];
					if (this.shapingThisStroke) {
						const midHw = (this.prevSampleHw + sampleHw) / 2;
						flatSeg = flattenSegmentHw(
							seg,
							this.lastMidHw ?? this.prevSampleHw,
							midHw,
							cam.zoom
						);
						this.lastMidHw = midHw;
					} else {
						flatSeg = flattenSegment(seg, style, cam.zoom);
					}
					const strip: RibbonPt[] = this.lastRibbon
						? [this.lastRibbon, ...flatSeg]
						: flatSeg;
					fillRibbon(this.ctx, cam, strip, inkColorFor(style));
					this.growDirtyStrip(cam, strip);
					this.lastRibbon = strip[strip.length - 1];
				}
				if (this.shapingThisStroke) this.prevSampleHw = sampleHw;
			} else {
				drawSegment(this.ctx, cam, style, this.lastPoint, point);
				const hw = widthForPressure(style, (this.lastPoint.pressure + point.pressure) / 2) / 2;
				this.growDirty(
					(this.lastPoint.x - cam.x) * cam.zoom,
					(this.lastPoint.y - cam.y) * cam.zoom,
					(point.x - cam.x) * cam.zoom,
					(point.y - cam.y) * cam.zoom,
					hw * cam.zoom + 2
				);
			}
			if (!this.drewOnce) {
				this.drewOnce = true;
				this.attrsAfterFirstDraw = this.currentAttrs();
			}
		}
		this.lastPoint = point;
		this.incompletePaint = incomplete;
	}

	/**
	 * The raw stub from the settled curve to the nib; undefined in raw mode.
	 * A raw centerline has no settled/head split - the ribbon is already at
	 * the newest sample - so there is no stub to draw over it either.
	 */
	head(): { from: Point2; to: Point2; pressure: number } | undefined {
		return this.smooth && this.smoothThisStroke ? this.smoother.head() : undefined;
	}

	/**
	 * The width the ribbon is laying down right now, in css px.
	 *
	 * The predicted tail asks for this rather than computing one from raw
	 * pressure. With shaping on the ribbon is velocity-thinned, so a tail
	 * sized from pressure alone is much fatter than the ink it extends - a
	 * bulge that runs ahead of the nib and deflates as the real samples
	 * land. Reported from hardware 2026-08-29: distorting while writing,
	 * while the finished stroke looked perfect. The finished stroke WAS
	 * perfect; only the guess was drawn wrong.
	 */
	liveWidthPx(cam: CameraState, style: PenStyle, pressure: number): number {
		style = this.strokeStyle ?? style;
		return this.liveHalfWidth(style, pressure) * 2 * cam.zoom;
	}

	/**
	 * The same width the ribbon is laying down right now, as a WORLD
	 * half-width - which is what a ribbon point's `hw` is and what
	 * TailRenderer.drawHead needs.
	 *
	 * It exists so no caller has to convert. `liveWidthPx` is a FULL width in
	 * css px, so getting a head width out of it means `/ cam.zoom / 2`, and
	 * dropping the `/ 2` ships a head at twice the ribbon - the exact error
	 * the first draft of this fix's design made. Six call sites is six
	 * chances to make it; here there is one place to get it right.
	 *
	 * The branch is `liveWidthPx`'s, not a simplification of it. On the
	 * shaped branch `shaper.last()` IS a world half-width and needs no
	 * arithmetic at all. On the other branch it must NOT be read: the shaper
	 * is only `reset` when `shapingThisStroke` (beginStroke, above), so off
	 * that branch it still holds whatever the last shaped stroke left in it.
	 * There the width comes from pressure and the `/ 2` is real.
	 *
	 * The shaped branch carries all three of the ribbon's factors: velocity
	 * thinning, the start taper, and the SMOOTHED pressure `pHat` rather than
	 * the raw sample. Taking pHat costs the head a few ms of pressure lag,
	 * and the head exists to be lag-free, so that is a real cost. It is paid
	 * deliberately: the head is a separate canvas layer over the ribbon, so a
	 * head that matches on two factors out of three still draws a visible
	 * step at the join - which is the defect. Matching all three is the only
	 * way the seam goes away, and a few ms of pressure lag is invisible
	 * beside it.
	 *
	 * SHAPING off and SMOOTHING off are different switches and have to be
	 * stated separately; conflating them is how the design first read this.
	 *
	 * Shaping off with smoothing on is an ordinary, shipped state - every
	 * MOUSE stroke (the overlay clears `shape` per stroke) and every
	 * highlighter (`centerlineSmoothed` returns true for a flat tool
	 * whatever the switch says). `head()` fires, this takes the pressure
	 * branch, and the head gets bit for bit the width it computed before this
	 * accessor existed. Genuinely unchanged.
	 *
	 * Smoothing off - Boox mode, which forces the switch off - is different.
	 * `head()` gates on smoothing and returns undefined, so the five gated
	 * head sites go dark and there is nothing there to change. But the
	 * pen-down dot is NOT gated on `head()`: it still draws, so it still
	 * moves, by the floor in `contactHalfWidth` below. That is the one
	 * visible change on the raw path and it is the ruled one.
	 */
	liveHalfWidth(style: PenStyle, pressure: number): number {
		style = this.strokeStyle ?? style;
		return this.shapingThisStroke
			? this.shaper.last()
			: widthForPressure(style, pressure) / 2;
	}

	/**
	 * The pen-down dot's world half-width: exactly one nib.
	 *
	 * The contact dot is the one head draw that is NOT gated on `head()`, and
	 * at pen-down the wet layer has painted nothing at all. For a TAP this dot
	 * is the entire visible mark. The pressure-aware wet ribbon now starts at
	 * the width the committed ribbon will use, which may exceed the nib under
	 * exp7; the contact dot is deliberately separate so that accepted line
	 * starts do not silently enlarge Alan's accepted nib-sized taps.
	 *
	 * The floor is the nib's own base width (Alan, 2026-09-02): a tap should
	 * look like the nib, not like the start of a stroke. `baseWidth` is a
	 * FULL width, so the floor on a half-width is `baseWidth / 2`; flooring
	 * at `baseWidth` itself would draw every tap at twice the nib.
	 *
	 * A tap draws at exactly the nib whatever the pressure sample says. That
	 * was already the ruling; making it explicit preserves it now that the ON
	 * curve is allowed to exceed `baseWidth`.
	 */
	contactHalfWidth(style: PenStyle, _pressure: number): number {
		style = this.strokeStyle ?? style;
		return style.baseWidth / 2;
	}

	/**
	 * Close the smoothed curve out to the final sample at pen-up, so the wet
	 * stroke reaches the nib before it is replaced by the committed one.
	 */
	finishStroke(cam: CameraState, style: PenStyle): void {
		style = this.strokeStyle ?? style;
		if (!this.smooth) return;
		// Nothing to close on a raw centerline: appendPoint already drew out
		// to the final sample.
		if (!this.smoothThisStroke) return;
		const seg = this.smoother.finish();
		if (!seg) return;
		const flatSeg = this.shapingThisStroke
			? flattenSegmentHw(
					seg,
					this.lastMidHw ?? this.prevSampleHw,
					this.shaper.last(),
					cam.zoom
				)
			: flattenSegment(seg, style, cam.zoom);
		const strip: RibbonPt[] = this.lastRibbon
			? [this.lastRibbon, ...flatSeg]
			: flatSeg;
		this.markPaint();
		const incomplete = this.incompletePaint;
		this.incompletePaint = true;
		fillRibbon(this.ctx, cam, strip, inkColorFor(style));
		this.growDirtyStrip(cam, strip);
		this.lastRibbon = strip[strip.length - 1];
		this.incompletePaint = incomplete;
	}

	clear(cssWidth: number, cssHeight: number): void {
		this.beforeWrite?.();
		this.ctx.clearRect(0, 0, cssWidth, cssHeight);
		if (this.fullClearCovers(cssWidth, cssHeight)) this.noteBackingCleared();
		this.reset();
	}

	/**
	 * Clear only what this stroke painted. Same result as clear() when the
	 * canvas holds one finished stroke, which at pen-up it always does.
	 *
	 * E-ink refreshes the region a frame damaged. A whole-canvas clearRect
	 * damages the whole canvas, so every pen-up was a whole-screen refresh -
	 * the ~800ms freezes a NoteAir reported once per stroke (2026-09-01).
	 * Clearing the stroke's own box keeps the damage the size of the ink.
	 */
	clearStroke(cssWidth: number, cssHeight: number): void {
		this.beforeWrite?.();
		const d = this.dirty;
		const x0 = d ? Math.max(0, Math.floor(d.x0)) : NaN;
		const y0 = d ? Math.max(0, Math.floor(d.y0)) : NaN;
		const x1 = d ? Math.min(cssWidth, Math.ceil(d.x1)) : NaN;
		const y1 = d ? Math.min(cssHeight, Math.ceil(d.y1)) : NaN;
		// No box, or a box that is not a box (a NaN pressure poisons the
		// width): clear everything. Leaving wet ink behind is the one outcome
		// this must never produce.
		if (x1 > x0 && y1 > y0) {
			this.ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
			this.blank = this.strokeOwnsAllPixels && !this.incompletePaint && this.fullClearCovers(cssWidth, cssHeight);
		} else {
			this.ctx.clearRect(0, 0, cssWidth, cssHeight);
			if (this.fullClearCovers(cssWidth, cssHeight)) this.noteBackingCleared();
		}
		this.reset();
	}

	private reset(): void {
		this.lastPoint = undefined;
		this.lastRibbon = undefined;
		this.dirty = null;
		this.smoother.reset();
	}

	private growDirty(x1: number, y1: number, x2: number, y2: number, pad: number): void {
		const box = {
			x0: Math.min(x1, x2) - pad,
			y0: Math.min(y1, y2) - pad,
			x1: Math.max(x1, x2) + pad,
			y1: Math.max(y1, y2) + pad,
		};
		this.dirty = this.dirty
			? {
					x0: Math.min(this.dirty.x0, box.x0),
					y0: Math.min(this.dirty.y0, box.y0),
					x1: Math.max(this.dirty.x1, box.x1),
					y1: Math.max(this.dirty.y1, box.y1),
				}
			: box;
	}

	/** The ribbon's points are world-space with a world half-width each. */
	private growDirtyStrip(cam: CameraState, strip: readonly RibbonPt[]): void {
		let hw = 0;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const p of strip) {
			if (p.hw > hw) hw = p.hw;
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}
		if (!Number.isFinite(minX)) return;
		this.growDirty(
			(minX - cam.x) * cam.zoom,
			(minY - cam.y) * cam.zoom,
			(maxX - cam.x) * cam.zoom,
			(maxY - cam.y) * cam.zoom,
			hw * cam.zoom + 2
		);
	}

	/**
	 * Diagnostic readback: non-transparent pixels in a CSS-px rect of this
	 * wet canvas. Called once per pen-up (before clear) by the scroll probe,
	 * never on the hot path.
	 */
	countPainted(
		xCss: number,
		yCss: number,
		wCss: number,
		hCss: number,
		backing: number
	): number {
		return countPaintedPixels(this.ctx, xCss, yCss, wCss, hCss, backing);
	}
}
