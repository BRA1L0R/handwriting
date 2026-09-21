import { PenStyle, pressureSensitivityEnabled, widthForPressure } from "./PenStyle";
import { smoothSegments } from "./Smoothing";
import { InkPoint } from "./Stroke";
import { RibbonPt, flattenSegmentHw } from "./Ribbon";

/**
 * Ink shaping: the difference between a polyline that tracks the pen and a
 * line that looks like it was written. Three effects, all computed from the
 * stored samples (x, y, pressure, t) at render time, so the canonical stroke
 * data is untouched and wet and committed ink always agree:
 *
 *   pressure settling   raw digitizer pressure jitters sample to sample, and
 *                       mapping it straight to width puts that jitter on the
 *                       outline. A one-pole filter settles it.
 *
 *   velocity thinning   a real nib starves at speed: fast strokes come out
 *                       thinner than slow ones. This is most of what makes
 *                       handwriting read as handwriting; without it every
 *                       letter has the same dead weight everywhere.
 *
 *   endpoint taper      strokes start and end at a tip, not at a blunt round
 *                       cap. The taper runs over a short arc length at each
 *                       end. The wet layer can only taper the start (the end
 *                       is unknown until pen-up); the committed repaint at
 *                       hand-off adds the end taper, so the stroke visibly
 *                       "dries" into its final shape the way OneNote's does.
 *
 * The highlighter is exempt: a chisel tip does not taper or starve, and its
 * flat, even wash is the whole point of the tool.
 */

export interface ShapeParams {
	/** One-pole filter weight for pressure (1 = no filtering). */
	pressureAlpha: number;
	/** One-pole filter weight for velocity. */
	velocityAlpha: number;
	/** Thinning strength per world-unit-per-ms of nib speed (0 = off). */
	thinningK: number;
	/** Width floor under velocity thinning, as a fraction of full width. */
	minVelocityFactor: number;
	/** Taper length at each end, in multiples of the style's base width. */
	taperWidths: number;
	/** Each taper may cover at most this fraction of the stroke's length. */
	taperMaxShare: number;
	/** Half-width multiplier remaining at the extreme tip (0 aliases away). */
	tipFloor: number;
	/**
	 * A final sample whose pressure is at or below this share of the one
	 * before it is drawn at the one before's pressure (0 = never). exp7 ink
	 * with pressure sensitivity on only; see shapedHalfWidths.
	 */
	liftHoldRatio: number;
	/**
	 * Whether exp7 ink with pressure sensitivity on still takes the geometric
	 * tip taper, the pre-1.4.20 law (see applyEndTaper). false: pressure draws
	 * the tips. A plant for tests and for the frozen pre-1.4.20 oracle; legacy
	 * and pressure-off ink take the taper either way.
	 */
	exp7TipTaper: boolean;
	/**
	 * The fastest the half-width may change per world unit of path, either
	 * way (Infinity = uncapped). exp7 ink with pressure sensitivity on only;
	 * see RIBBON_EDGE_SLOPE.
	 */
	edgeSlope: number;
}

/**
 * The half-width may grow or shrink by at most this much per world unit of
 * path, so a stroke is never wider than it is long at its own start.
 *
 * Why (the start blot, bug reports 28d6c5e4 and 4a3db156): a light pen-down
 * sample followed, one long frame later, by full writing pressure barely a
 * nib's width away widens the ribbon faster than the path moves, and a mark
 * wider than its lead-in reads as a disc. The 1.4.19 start taper hid it;
 * pressure ink has no geometric taper since 1.4.20. Capping the RATE draws the
 * landing as a short cone instead: the pen-down width is kept (a light start
 * stays light) and the full width arrives after a few px of travel. It is not
 * a taper to a point, and it is time-free on purpose: the silent frame before
 * the second sample would outlast any time window.
 *
 * 0.5 is an edge angle of about 27 degrees. Measured, it leaves these
 * untouched: the quick and push synthetics at every slider size, and the
 * stroke of 28d6c5e4's first three contacts and d1c16bdb at zoom 1, 2 and 4
 * and every size (RibbonEdgeSlope.test.ts, BlotCapture.test.ts). It DOES bind
 * on other real strokes whose firm start climbs as steeply as the blot's,
 * which in Alan's stored ink at the largest sizes is most strokes, and on a
 * few steep pressure drops late in a stroke, by about 1 percent of the width.
 * On the wet layer it also bounds the unheld quarter-pressure lift sample's
 * drop until the committed repaint replaces the tail. The number is Alan's to
 * tune on his screen.
 */
export const RIBBON_EDGE_SLOPE = 0.5;

/**
 * Tuned on a Surface at zoom 1, where world units are CSS pixels and
 * ordinary handwriting moves the nib at roughly 0.5 to 2.5 units/ms.
 */
export const PEN_SHAPE: ShapeParams = {
	pressureAlpha: 0.4,
	velocityAlpha: 0.3,
	thinningK: 0.18,
	minVelocityFactor: 0.65,
	taperWidths: 2.4,
	// How much of a stroke the taper may claim. The taper is a multiple of the
	// nib WIDTH, so a fat nib tapers over a longer distance and a short stroke
	// hits this cap: measured 2026-08-29, a 2.5x nib gave up 27% of a short
	// stroke and 24% of a long one, which reads as the end being clipped off.
	// At 0.18 it holds near 14% whatever the nib. The tip floor is deliberately
	// NOT raised with it - ends are tips, not blunt caps, and there is a test
	// that says so.
	taperMaxShare: 0.18,
	tipFloor: 0.12,
	liftHoldRatio: 0.35,
	exp7TipTaper: false,
	edgeSlope: RIBBON_EDGE_SLOPE,
};

// ---- global switch ----------------------------------------------------------

let shapingOn = true;

export function setInkShaping(on: boolean): void {
	shapingOn = on;
}

export function inkShapingEnabled(): boolean {
	return shapingOn;
}

/**
 * Does this stroke get the smoothed (midpoint-quadratic) centerline, or the
 * raw polyline through its samples? The one source of that decision - the
 * committed renderer and the wet layer both ask here, so what lands at pen-up
 * is the geometry the user watched being drawn.
 *
 * Two things wore the name "smoothing" and only one of them had a switch. The
 * setting drove `setInkShaping`, which is the WIDTH law only (pressure
 * settling, velocity thinning, end taper - see this file's header). The
 * geometric smoothing in Smoothing.ts ran on every committed stroke with no
 * way to turn it off, which is why a Boox user with smoothing, prediction and
 * pressure all off still photographed rounded corners (r/Onyx_Boox,
 * 2026-09-02). Off now means off: the centerline is the samples.
 *
 * `flat` (the highlighter) is exempt and stays smoothed either way, the same
 * exemption it already has from the shaped width law: a chisel tip's broad
 * even wash is the tool, and faceting a wash that wide is visible in a way
 * faceting a nib-width line is not.
 *
 * Boox mode forces the setting off at runtime (main.ts `applyBooxMode`), so
 * Boox commits are raw by design - fewer geometry differences between the wet
 * line and the commit means fewer e-ink redraws, which is the point of the
 * mode, not a side effect of it.
 */
export function centerlineSmoothed(flat: boolean): boolean {
	return flat || shapingOn;
}

// ---- per-sample width law ---------------------------------------------------

/** Smoothstep eased from the tip floor up to 1. */
function taperEase(u: number, tipFloor: number): number {
	const c = Math.min(1, Math.max(0, u));
	const s = c * c * (3 - 2 * c);
	return tipFloor + (1 - tipFloor) * s;
}

/**
 * Per-sample half-widths for a whole stroke: filtered pressure through the
 * style's width law, then velocity thinning. No taper here; taper depends on
 * arc length over the flattened ribbon and is applied by applyEndTaper.
 *
 * The lift sample. The pen's last report before it leaves the glass comes in
 * at a quarter of the pressure before it (0.248-0.251 on 8 of 10 strokes in
 * Alan's 1.4.20 captures and 10 of 12 stored ones). Drawn as it stands it
 * drags the last half-width down, and exp7's end taper floors at the last
 * half-width over the widest, so one bad sample shaves the whole end zone:
 * 21-54 px^2 per stroke, an end about half the line's width. A final sample
 * at or below `liftHoldRatio` of the one before is therefore drawn at the
 * one before's pressure. It keeps its position, so the ink still reaches the
 * pen-up point, and every earlier sample is untouched (the filter is causal).
 * Legacy ink and pressure-off ink are left as they were: the first has a
 * fixed tip floor, the second never reads pressure. The wet layer cannot know
 * which sample is last, so the change lands with the committed repaint.
 */
export function shapedHalfWidths(
	points: readonly InkPoint[],
	style: PenStyle,
	params: ShapeParams = PEN_SHAPE
): number[] {
	const out: number[] = [];
	if (points.length === 0) return out;
	const last = points.length - 1;
	const held =
		style.pressureProfile === "exp7" &&
		pressureSensitivityEnabled() &&
		params.liftHoldRatio > 0 &&
		last > 1 &&
		points[last]!.pressure <= params.liftHoldRatio * points[last - 1]!.pressure;
	const capped = edgeSlopeFor(style, params);
	let pHat = points[0]!.pressure;
	let vHat = 0;
	let prev = points[0]!;
	for (let i = 0; i < points.length; i++) {
		const pt = points[i]!;
		let d = 0;
		if (i > 0) {
			d = Math.hypot(pt.x - prev.x, pt.y - prev.y);
			const dt = Math.max(1, pt.t - prev.t);
			vHat += params.velocityAlpha * (d / dt - vHat);
			const pressure = held && i === last ? prev.pressure : pt.pressure;
			pHat += params.pressureAlpha * (pressure - pHat);
		}
		const f = Math.max(params.minVelocityFactor, 1 / (1 + params.thinningK * vHat));
		const hw = (widthForPressure(style, pHat) / 2) * f;
		out.push(i > 0 && capped ? capEdge(hw, out[i - 1]!, d, params.edgeSlope) : hw);
		prev = pt;
	}
	return out;
}

/** Whether this style's half-widths take the edge slope cap. */
function edgeSlopeFor(style: PenStyle, params: ShapeParams): boolean {
	return style.pressureProfile === "exp7" && pressureSensitivityEnabled() && Number.isFinite(params.edgeSlope);
}

/** `hw`, moved no further from the previous (capped) half-width than `slope` per unit of travel `d`. */
function capEdge(hw: number, previous: number, d: number, slope: number): number {
	const room = slope * d;
	return Math.min(previous + room, Math.max(previous - room, hw));
}

// ---- endpoint taper ---------------------------------------------------------

/**
 * Multiply half-widths down toward the tip floor over a short arc length at
 * both ends of a flattened ribbon. Mutates `pts` in place (they are always
 * freshly built by the caller).
 *
 * Pressure ink draws its own tips (1.4.20). exp7 ink with pressure sensitivity
 * on starts and ends at the width its pressure gives, with no geometric taper.
 * The taper it used to take floored each end at that end's width over the
 * stroke's widest, and a push starts light: its start was already thin from
 * pressure and the taper multiplied it by that small ratio again, to about a
 * sixth of what the wet layer had drawn while the pen was down, so the start
 * visibly vanished at lift. Legacy (1.4.12) ink and pressure-off ink, which
 * carry no pressure in their width, keep the taper; `exp7TipTaper` restores the
 * old law for exp7 as a plant.
 */
export function applyEndTaper(
	pts: RibbonPt[],
	style: PenStyle,
	params: ShapeParams = PEN_SHAPE
): void {
	const n = pts.length;
	if (n < 2) return;
	if (style.pressureProfile === "exp7" && pressureSensitivityEnabled() && !params.exp7TipTaper) return;
	const arc: number[] = [0];
	for (let i = 1; i < n; i++) {
		const a = pts[i - 1]!;
		const b = pts[i]!;
		arc.push(arc[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
	}
	const total = arc[n - 1]!;
	if (total < 1e-9) return;
	// A TAP is not a short line, and tapering one destroys it.
	//
	// The taper zone is capped at a share of the stroke, so on a tap it is a
	// share of almost nothing - and a stroke that short flattens to a ribbon
	// of two points, both of which are ends. Both then get multiplied to the
	// tip floor and the dot renders at 12% of the nib: measured 0.132 against
	// a 1.1 half-width, which is the near-invisible sliver reported on canvas,
	// SVG and PDF alike (all three flatten through here).
	//
	// Below one nib width of travel there is no direction to taper ALONG, so
	// the honest shape is the nib itself. Real short strokes are unaffected:
	// the existing 5-unit case is more than twice this bound.
	if (total < style.baseWidth) return;
	const taperLen = Math.min(params.taperWidths * style.baseWidth, total * params.taperMaxShare);
	if (taperLen < 1e-9) return;
	let startFloor = params.tipFloor;
	let endFloor = params.tipFloor;
	if (style.pressureProfile === "exp7" && pressureSensitivityEnabled()) {
		let maxHw = 0;
		for (const point of pts) if (point.hw > maxHw) maxHw = point.hw;
		if (maxHw > 0) {
			startFloor = Math.max(params.tipFloor, pts[0]!.hw / maxHw);
			endFloor = Math.max(params.tipFloor, pts[n - 1]!.hw / maxHw);
		}
	}
	for (let i = 0; i < n; i++) {
		const fromStart = taperEase(arc[i]! / taperLen, startFloor);
		const fromEnd = taperEase((total - arc[i]!) / taperLen, endFloor);
		pts[i]!.hw *= fromStart * fromEnd;
	}
}

// ---- committed rendering ----------------------------------------------------

/**
 * The shaped counterpart of Ribbon's flattenStroke: the same midpoint-
 * quadratic centerline at the same flatness, but half-widths come from the
 * shaped per-sample law, interpolated along each segment, with the endpoint
 * taper applied over the finished ribbon.
 */
export function flattenStrokeShaped(
	points: readonly InkPoint[],
	style: PenStyle,
	pxPerWorld: number,
	params: ShapeParams = PEN_SHAPE
): RibbonPt[] {
	if (points.length === 0) return [];
	const hws = shapedHalfWidths(points, style, params);
	if (points.length === 1) {
		const p = points[0]!;
		return [{ x: p.x, y: p.y, hw: hws[0]! }];
	}
	const segs = smoothSegments(points);
	const midHw = (a: number, b: number) => (hws[a]! + hws[b]!) / 2;
	const last = points.length - 1;
	const out: RibbonPt[] = [{ x: segs[0]!.from.x, y: segs[0]!.from.y, hw: hws[0]! }];
	for (let j = 0; j < segs.length; j++) {
		// Segment j bends around sample j; its ends sit on the midpoints
		// (j-1,j) and (j,j+1). The closing segment runs out to the last
		// sample itself.
		const hwFrom = j === 0 ? hws[0]! : midHw(j - 1, Math.min(j, last));
		const hwTo = j >= last ? hws[last]! : midHw(j, j + 1);
		for (const p of flattenSegmentHw(segs[j]!, hwFrom, hwTo, pxPerWorld)) out.push(p);
	}
	applyEndTaper(out, style, params);
	return out;
}

// ---- wet rendering ----------------------------------------------------------

/**
 * The same width law, one sample at a time, for the wet layer. Start taper
 * only: the end taper needs the total length, which exists at pen-up, and the
 * committed repaint applies it then.
 */
export class IncrementalShaper {
	private pHat = 0.5;
	private vHat = 0;
	private prev: InkPoint | undefined;
	private arcFromStart = 0;
	private lastHw = 0;
	private startHw = 0;
	private maxHw = 0;
	/** The previous sample's half-width after the edge slope cap, before any taper. */
	private cappedHw = 0;

	constructor(private params: ShapeParams = PEN_SHAPE) {}

	reset(first: InkPoint | undefined, style: PenStyle | undefined): void {
		this.pHat = first?.pressure ?? 0.5;
		this.vHat = 0;
		this.prev = first;
		this.arcFromStart = 0;
		this.startHw = first && style ? widthForPressure(style, first.pressure) / 2 : 0;
		this.maxHw = this.startHw;
		this.cappedHw = this.startHw;
		this.lastHw = this.startHw *
			(style?.pressureProfile === "exp7" && pressureSensitivityEnabled() ? 1 : this.params.tipFloor);
	}

	/** Shaped half-width at this sample, start taper included. */
	push(style: PenStyle, pt: InkPoint): number {
		const prev = this.prev;
		let d = 0;
		if (prev) {
			d = Math.hypot(pt.x - prev.x, pt.y - prev.y);
			const dt = Math.max(1, pt.t - prev.t);
			this.arcFromStart += d;
			this.vHat += this.params.velocityAlpha * (d / dt - this.vHat);
			this.pHat += this.params.pressureAlpha * (pt.pressure - this.pHat);
		}
		const f = Math.max(
			this.params.minVelocityFactor,
			1 / (1 + this.params.thinningK * this.vHat)
		);
		let hw = (widthForPressure(style, this.pHat) / 2) * f;
		// The same cap, the same order, as shapedHalfWidths: wet and committed agree.
		if (prev && edgeSlopeFor(style, this.params)) hw = capEdge(hw, this.cappedHw, d, this.params.edgeSlope);
		this.cappedHw = hw;
		this.maxHw = Math.max(this.maxHw, hw);
		const exp7 = style.pressureProfile === "exp7" && pressureSensitivityEnabled();
		const startFloor = exp7
			? Math.max(this.params.tipFloor, this.maxHw > 0 ? this.startHw / this.maxHw : this.params.tipFloor)
			: this.params.tipFloor;
		// Pressure draws the tips, here as in applyEndTaper, so the start the pen
		// lifts from is the start that was on screen while it was down.
		const taper = exp7 && !this.params.exp7TipTaper
			? 1
			: taperEase(this.arcFromStart / (this.params.taperWidths * style.baseWidth), startFloor);
		this.prev = pt;
		this.lastHw = hw * taper;
		return this.lastHw;
	}

	/** Half-width of the most recent sample (for the closing segment). */
	last(): number {
		return this.lastHw;
	}
}
