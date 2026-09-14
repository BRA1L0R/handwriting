/**
 * The plugin's own finger scroll - the assist pan, its palm-parole catch-up
 * and the fling that follows them - as arithmetic, with no DOM in it.
 *
 * WHY IT IS A FILE OF ITS OWN. The router moved the scroller with
 * `scrollLeft -= d`: a READ and a write, so every move started from what the
 * scroller reported back. The engine does not keep the offset it is given. It
 * keeps it on a grid - whole layout px on a plain scroller, and whole ZOOMED
 * px under a zoom-shrunk host, which at 10% is ten layout px - and a move
 * smaller than that grid loses its remainder when it is read back. The next
 * move starts from the rounded value and loses its own remainder, so the loss
 * compounds instead of averaging out: thirty 1.3 px finger moves at 10%
 * travelled 30 px of screen instead of 39, and a 1.3 px move at 100% landed
 * one layout px. The fling integrated its glide from the same rounded
 * read-back, frame after frame.
 *
 * So a gesture carries its own position, the way `PanScroll.ts` carries the
 * pdf pan: a float target, seeded from the settled read-back when the gesture
 * starts, advanced by every move, clamped to the scroller's range and written
 * absolutely. What the engine rounds a write to no longer feeds the next one.
 * The read-back keeps exactly one job: noticing that something else moved the
 * scroller (a wheel, the band's own compensation). A read-back more than one
 * grid step away from the value this gesture last wrote is taken as the new
 * start.
 *
 * DOM-free by construction, like `PanScroll.ts`: offsets and sizes arrive as
 * plain numbers, so the rule is asserted by being called.
 */

/** One axis of a carried scroll: where the gesture wants the scroller, and what it last wrote there. */
export interface ScrollCarry {
	readonly target: number;
	readonly written: number;
}

/** One axis as the scroller reports it this frame: its offset, and its range (scroll size minus client size). */
export interface ScrollAxis {
	readonly offset: number;
	readonly range: number;
}

/** One frame's result on one axis. Write `carry.target`. */
export interface ScrollCarryStep {
	readonly carry: ScrollCarry;
	/** The target changed this frame (false when the step was zero or the range pinned it). */
	readonly moved: boolean;
	/** The start of this frame was the read-back, because something else moved the scroller. */
	readonly adopted: boolean;
}

/**
 * The grid the engine keeps a scroll offset on, in layout px: one screen px
 * at the note's scale (`layoutPerScreenPx` = 1/k, ten at 10%), and never
 * finer than one layout px, which is the plain scroller's own grid.
 */
export function scrollGrid(layoutPerScreenPx: number): number {
	return Number.isFinite(layoutPerScreenPx) && layoutPerScreenPx > 1 ? layoutPerScreenPx : 1;
}

/** A gesture's carry, seeded from the settled read-back at the gesture's start. */
export function carryFrom(offset: number): ScrollCarry {
	return { target: offset, written: offset };
}

/**
 * One frame of a carried scroll on one axis. `step` is the scroll delta in
 * layout px (positive scrolls forward). The start is the carried target unless
 * the read-back has left the last written value by more than one grid step;
 * the result is clamped to [0, range]. A range that is not a finite number
 * (a host with no layout yet) clamps below only.
 */
export function carryStep(carry: ScrollCarry, axis: ScrollAxis, step: number, grid: number): ScrollCarryStep {
	const adopted = Math.abs(axis.offset - carry.written) > grid;
	const from = adopted ? axis.offset : carry.target;
	const top = Number.isFinite(axis.range) ? Math.max(0, axis.range) : Infinity;
	const target = Math.min(top, Math.max(0, from + step));
	return { carry: { target, written: target }, moved: target !== from, adopted };
}

/**
 * A glide has nowhere left to go on this axis: its target did not move, and
 * the scroller sits within one grid step of it. Within one step, because a
 * read-back rounded to the grid never equals a float target exactly - an
 * exact comparison would keep a fling alive against an edge forever.
 */
export function carryPinned(step: ScrollCarryStep, offset: number, grid: number): boolean {
	return !step.moved && Math.abs(offset - step.carry.target) <= grid;
}
