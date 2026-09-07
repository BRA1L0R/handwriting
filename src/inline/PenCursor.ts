// Type-only, so nothing is imported at runtime and no cycle is possible:
// `TipMode.ts` imports nothing at all, and this module is the reticle's own.
import type { TipMode } from "./TipMode";

/**
 * A reticle has to be findable before it can be useful, and small enough to
 * aim with. A pen nib is about 2px. A 6px floor put a 4px speck under the tip
 * where the hand hides it, which read as "the cursor does not work"; 12 was
 * the correction and overshot, reading as a blob on Orion.
 *
 * The floor is not the whole footprint: styles.css rings the reticle with a
 * 1.5px shadow OUTSIDE the border box, so what lands on screen is this plus 3.
 * At 6 that is 9 painted. The old 6 that read as a speck was 6 painted,
 * before the ring existed.
 */
export const MIN_CURSOR_VISUAL_PX = 6;
const PEN_COMPAT_MOUSE_WINDOW_MS = 120;
const PEN_COMPAT_MOUSE_DISTANCE_PX = 4;
export const PEN_HOVER_CLASS = "handwriting-pen-hover";

/**
 * The scroller wears this for the length of a PAN DRAG, and only then.
 *
 * It exists because `PEN_HOVER_CLASS` puts `cursor: none` over the scroller,
 * so the reticle can be the only marker on screen. Hiding the reticle mid-pan
 * (see `penReticleShown` below) without answering for the cursor would leave
 * the surface with NO pointer at all - the exact defect an adversarial review
 * found on 2026-09-04 when mouse ink went off under a lit ring, and which
 * `GestureReticlePersists.test.ts`'s third suite exists to refuse. So the pan
 * drag SWAPS one class for the other: the hover class comes off, this goes
 * on, and the grabbing hand says "you are holding the page" for as long as
 * the drag lasts.
 *
 * A swap rather than an overlay, deliberately. Both rules select
 * `.cm-scroller.<class>` and `.cm-scroller.<class> *`, so their specificity is
 * identical and the winner would otherwise be whichever appears later in
 * styles.css - a coupling to source ORDER that nothing would catch the day
 * somebody reorders the sheet. Only ever one of the two is on the element.
 */
export const PAN_DRAG_CLASS = "handwriting-pan-drag";

/**
 * Is the reticle painted at all, given what the tip IS and whether it is
 * dragging?
 *
 * Alan, 2026-09-05, hardware: "pan reticle allows you to like fling it away
 * from the point of pan and it flickers". The mechanism is coordinates, not
 * painting. `InlinePenRouter` maps a client point into overlay space through a
 * rect it caches at pen-down and deliberately FREEZES for the length of a
 * claimed contact - the stroke pipeline's forward and inverse transforms have
 * to agree, so refreshing one without the other is exactly the mismatch that
 * freeze exists to prevent. Every other gesture leaves the overlay where it
 * is; a pan SCROLLS it, and the overlay is a child of the scroller. So the
 * rect goes stale by the whole accumulated scroll while the samples keep being
 * mapped through it, and the ring walks away from the nib a little further
 * every frame - flung, and flickering as the sample-driven paint and the
 * scroll-driven repaint alternate.
 *
 * The rule (architect, 1.4.12; Alan's to overturn on screen): a pan drag
 * paints no reticle. There is no correct place to put one - the tip is holding
 * the page, the page is what moved, and a marker that has to be right about a
 * coordinate nobody can compute is worse than no marker at all. The grabbing
 * hand (`PAN_DRAG_CLASS`) carries the meaning instead, and it needs no
 * coordinate to be right about.
 *
 * PURE, and here rather than inline in `InkOverlay`, for the reason
 * `TipMode.ts`'s own header gives: the overlay imports `obsidian` and cannot be
 * unit-tested, so a rule living in it can only ever be asserted by grepping its
 * source. This one is asserted by being called.
 *
 * `dragging` is "a drag of the tip's own mode is live under it". Only the pan
 * tip is ever refused, so a caller with nothing but a pan drag to report still
 * answers the whole predicate correctly; every other tip is shown either way.
 */
export function penReticleShown(tip: TipMode, dragging: boolean): boolean {
	return !(dragging && tip === "pan");
}

/**
 * No hover sample for this long means the pen is gone; see
 * `InkOverlay.armHoverWatchdog`, which is the one thing that arms a timer on
 * it. It lives HERE rather than in that file because the router needs the
 * same number - a mouse leaving the pane must not take a reticle down that a
 * pen still owns, and "still owns" is exactly this window - and `InkOverlay`
 * imports the router, so importing back would close a cycle. This module is
 * the reticle's own, and both already read from it.
 */
export const HOVER_GHOST_MS = 1000;

export interface PenCursorLayoutInput {
	x: number;
	y: number;
	strokeWidth: number;
	cameraZoom: number;
	cssScale: number;
}

/** Center a tool-size cursor on a pen sample without mixing visual and layout pixels. */
export function penCursorLayout(input: PenCursorLayoutInput): {
	x: number;
	y: number;
	diameter: number;
} {
	const cssScale = Number.isFinite(input.cssScale) && input.cssScale > 0 ? input.cssScale : 1;
	const cameraZoom =
		Number.isFinite(input.cameraZoom) && input.cameraZoom > 0 ? input.cameraZoom : 1;
	const strokeWidth =
		Number.isFinite(input.strokeWidth) && input.strokeWidth > 0 ? input.strokeWidth : 0;
	const diameter = Math.max(MIN_CURSOR_VISUAL_PX / cssScale, strokeWidth * cameraZoom);
	return {
		x: input.x - diameter / 2,
		y: input.y - diameter / 2,
		diameter,
	};
}

/**
 * Windows can follow a pen-hover pointermove with a mouse-compatible move at
 * the same point. Treat that pair as one pen hover; otherwise the synthetic
 * mouse event briefly restores CodeMirror's I-beam before the next pen sample.
 * A real mouse moving elsewhere still replaces the pen cursor immediately.
 */
export function isPenCompatMouseMove(input: {
	now: number;
	lastPenHoverAt: number;
	mouseX: number;
	mouseY: number;
	penX: number;
	penY: number;
}): boolean {
	return (
		input.now - input.lastPenHoverAt >= 0 &&
		input.now - input.lastPenHoverAt <= PEN_COMPAT_MOUSE_WINDOW_MS &&
		Math.hypot(input.mouseX - input.penX, input.mouseY - input.penY) <=
			PEN_COMPAT_MOUSE_DISTANCE_PX
	);
}

/**
 * Marks the hover reticle as showing an eraser rather than a nib: an outline
 * at the erase radius instead of a filled dot at the ink width.
 */
export const ERASER_CURSOR_CLASS = "handwriting-pen-hover-eraser";
