/**
 * The pdf pan drag's arithmetic, with no DOM in it.
 *
 * WHY IT IS A FILE OF ITS OWN. The pan branch did this inline, and the shape
 * it did it in was the defect. `scroller.scrollLeft -= smp.x - last.x` is a
 * READ and a write, and in Blink reading `scrollLeft` goes through the same
 * layout update `clientWidth` does - `ScrollerSize` (PageBand.ts) says so in
 * its own header and `PdfInkController.syncBand` repeats it. pdf.js does not
 * virtualise its page divs, so on a document with many pages that read is a
 * forced layout over the whole viewer, and the pan branch made TWO of them
 * for every sample it walked.
 *
 * ALAN, 2026-09-05: "i was dragging with the mouse in pan mode earlier". A
 * mouse delivers one sample per move, so the batch size was never the lever -
 * coalescing four samples into one write would have saved nothing on the
 * hardware that actually lagged. The READ is the lever, and it is per MOVE
 * whatever the pointer is.
 *
 * So the drag stops asking the element where it is: it reads the scroller
 * once at pen-down, carries the position in its own state, and writes each
 * move's running total straight into `scrollLeft`/`scrollTop`. What is left
 * is arithmetic, and arithmetic can be a pure function - which is the other
 * half of why this is a file. `PdfInkController.ts` imports `obsidian` and
 * cannot be unit-tested, so a rule living inside it can only ever be asserted
 * by grepping its source; this one is asserted by being called.
 *
 * DOM-free by construction, like `TipMode.ts` and `InkSurfaces.ts`: nothing
 * here touches an element, and `panScrollLimit` takes the four size fields as
 * plain numbers rather than the scroller they were measured off.
 */

/** A hand position, or a pair of scroll offsets - the two the pan works in. */
export interface PanPoint {
	readonly x: number;
	readonly y: number;
}

/** What one `penRaw` batch asks of the scroller. */
export interface PanBatchDelta {
	/**
	 * The SCROLL delta the batch asks for, css px, signed - negated against
	 * the hand's travel, because content follows the pen: the page moves WITH
	 * the hand, so the offsets move against it.
	 */
	readonly dx: number;
	readonly dy: number;
	/** Where the batch's last sample left the hand. A copy, not the sample. */
	readonly last: PanPoint;
}

/**
 * One batch of samples, one scroll delta.
 *
 * TELESCOPING, which is why a single write per move is not an approximation
 * of the old per-sample loop but exactly equal to it. That loop applied
 * `smp[i] - smp[i-1]` for each i, with `smp[-1]` being `from`; summed term by
 * term the interior cancels and what is left is `smp[n-1] - from`. Computing
 * the difference directly is also the more accurate of the two in floating
 * point, since it never accumulates the rounding of n-1 intermediate sums.
 *
 * An empty batch is a real case - the router can hand `penRaw` a batch it
 * filtered down to nothing - and it means the hand did not move: zero delta,
 * and `last` is `from` unchanged rather than an undefined read off the end.
 */
export function panBatchDelta(from: PanPoint, samples: ReadonlyArray<PanPoint>): PanBatchDelta {
	const end = samples.length > 0 ? samples[samples.length - 1]! : from;
	// `from - end` rather than `-(end - from)`: the same number for every
	// finite pair, and it does not hand a hand that did not move a NEGATIVE
	// zero, which the trace would print as "-0.0" and a reader would spend a
	// minute on.
	return { dx: from.x - end.x, dy: from.y - end.y, last: { x: end.x, y: end.y } };
}

/** How far this scroller can actually be scrolled, both axes. */
export interface PanScrollLimit {
	readonly maxX: number;
	readonly maxY: number;
}

/** The four size fields the limit is derived from; see `ScrollerSize` (PageBand.ts). */
export interface PanScrollExtent {
	readonly clientWidth: number;
	readonly clientHeight: number;
	readonly scrollWidth: number;
	readonly scrollHeight: number;
}

/**
 * The scrollable range, from size fields somebody else already measured.
 *
 * Null means "not measured yet" and answers UNBOUNDED rather than zero. The
 * controller caches these four at each sync precisely because they are
 * layout reads (`ScrollerSize`), so a pan that starts before the first sync
 * has nothing to clamp against - and refusing to move is a far worse answer
 * there than trusting the browser's own clamp on the write, which is what
 * happens anyway.
 */
export function panScrollLimit(size: PanScrollExtent | null): PanScrollLimit {
	if (!size) return { maxX: Number.POSITIVE_INFINITY, maxY: Number.POSITIVE_INFINITY };
	return {
		maxX: Math.max(0, size.scrollWidth - size.clientWidth),
		maxY: Math.max(0, size.scrollHeight - size.clientHeight),
	};
}

/**
 * Where the carried position lands after one batch.
 *
 * CLAMPING IS NOT TIDINESS, it is the whole reason the carried value can be
 * trusted. `scrollLeft -= d` was clamped by the browser on every step, so a
 * drag that ran off the top of the document simply stopped; a carried total
 * that is not clamped keeps counting into negative territory the element
 * never went to, and coming back needs the whole overshoot paid off before
 * anything moves - a dead zone at both ends of every document, which is a
 * user-visible regression and not a rounding detail.
 *
 * It cannot be left to the reconciliation on the scroll event either: an
 * element already pinned at 0 fires NO scroll event for a write that changes
 * nothing, so the one thing that would correct the drift is exactly the thing
 * that stops arriving.
 *
 * The lower bound is 0 on both axes. That is a statement about this surface
 * and not about the DOM in general - a right-to-left scroller reports
 * negative `scrollLeft` in some engines - and the pdf.js viewer this drags is
 * left-to-right.
 */
export function panScrollNext(
	at: PanPoint,
	delta: { readonly dx: number; readonly dy: number },
	limit: PanScrollLimit
): PanPoint {
	return {
		x: Math.min(Math.max(0, at.x + delta.dx), limit.maxX),
		y: Math.min(Math.max(0, at.y + delta.dy), limit.maxY),
	};
}

/**
 * Which axes a landing sits at the far end of.
 *
 * Carried from move to move as the drag's "already measured here" latch;
 * `panEdgeContact` is where it is read and written.
 */
export interface PanEdgeLatch {
	readonly x: boolean;
	readonly y: boolean;
}

/** A drag that is not touching an edge. The state every pan starts in. */
export const PAN_EDGE_CLEAR: PanEdgeLatch = { x: false, y: false };

/** What a landing asks of the caller, and the latch its next move must carry. */
export interface PanEdgeContact {
	/**
	 * Measure the scroller NOW, once, and clamp this same move again against
	 * what comes back. True only on the move that ARRIVES at an edge.
	 */
	readonly remeasure: boolean;
	/** The latch for the next move. A function of THIS landing alone. */
	readonly latch: PanEdgeLatch;
}

/**
 * Has this landing arrived at an edge, and so earned one size measurement?
 *
 * THE STALE HALF OF THE CLAMP, and the reason this exists. `panScrollNext`
 * clamps against a limit derived from `PdfInkController.scrollerSize`, which
 * is a CACHE: it is measured in `sync`, and a scroll does not reach `sync`.
 * pdf.js lays its pages out lazily, so `scrollHeight` can grow between two
 * syncs and the drag then stops short of a bottom that has since moved.
 *
 * The clamp itself cannot go - an unclamped carried total drifts past the real
 * range while the browser silently clamps each write, which is the dead zone
 * `panScrollNext`'s own header is about, and that is worse than stopping
 * short. So what goes is the STALENESS, at the one point it is observable.
 *
 * ONE MEASUREMENT PER ARRIVAL, which is the whole cost argument. A move that
 * lands inside the cached range answers false and reads nothing - that is
 * every move of an ordinary drag, and the zero-read move path stays zero-read.
 * A move that lands ON the limit answers true once; the next move at the same
 * edge finds the axis latched and answers false, so holding the finger against
 * the bottom of a document costs one forced layout and not one per move. The
 * latch IS the landing, so leaving the edge clears it with no bookkeeping and
 * coming back is a new contact that earns a new measurement.
 *
 * PER AXIS AND NOT SHARED. A drag can be pinned at the bottom while still free
 * horizontally - an ordinary diagonal drag along an edge - and a shared latch
 * stays held for the whole of it, so the x axis would reach its own limit with
 * the latch already set and never measure: the same defect, moved to the other
 * axis. Two arrivals are two contacts. They still cost at most one read EACH,
 * because the caller measures all four size fields together: a corner arrival
 * is one measurement that latches both.
 *
 * THE FAR EDGE ONLY. The near edge is the literal 0 in `panScrollNext` and not
 * a size field, so no measurement can move the answer there; asking for one
 * would be a forced layout that provably cannot change what the drag does.
 *
 * An UNMEASURED limit needs no special case: `panScrollLimit(null)` is
 * infinite on both axes and nothing finite reaches it, so a pan that starts
 * before the first sync keeps the unbounded behaviour that function documents
 * rather than quietly acquiring a measurement here. Written as the plain
 * comparison and not a `Number.isFinite` guard beside it, because a guard
 * that cannot change an answer is a line no test can ever fail on.
 */
export function panEdgeContact(
	at: PanPoint,
	limit: PanScrollLimit,
	latch: PanEdgeLatch
): PanEdgeContact {
	const onX = at.x >= limit.maxX;
	const onY = at.y >= limit.maxY;
	return { remeasure: (onX && !latch.x) || (onY && !latch.y), latch: { x: onX, y: onY } };
}
