/**
 * Where a strip pop opens, decided apart from the DOM that shows it.
 *
 * The strip's pops - the nib sliders, the eraser's, the More row - hang from
 * a button and have to end up somewhere a user can actually see. Two rules
 * decide that, and both used to live where they could not be tested: the
 * vertical one in a stylesheet keyed off the anchor class, the horizontal one
 * inside a closure in `MobileTools.refreshNow` reading live rects.
 *
 * SPLIT FOR THE SAME REASON `overflowPlan` and `stripClearance` are: the
 * suite has no layout at all, so a rule that lives inside the code that
 * measures can only be tested by not testing it. The measuring stays in
 * MobileTools; the arithmetic is here, and all nine anchors are pinned.
 */

import { toolbarAnchorRow, type ToolbarCorner } from "./ToolbarCorner";

/** Which way a pop opens away from the strip. */
export type PopFlip = "up" | "down";

/**
 * A pop hangs UNDER the strip everywhere except a bottom anchor, where under
 * the strip is off the glass: a slider dropped downward from a strip already
 * at the screen's edge opened into the edge (alan, 2026-08-31, on a
 * bottom-corner strip). Bottom anchors open upward instead.
 *
 * Keyed on the row alone. The middle row has room below and follows the normal
 * downward rule; only the bottom row is close enough to the glass edge to
 * require the upward override.
 *
 * The stylesheet implements this; a test pins the two together, so a new
 * anchor cannot get a rule here and no rule there.
 */
export function popFlipFor(corner: ToolbarCorner): PopFlip {
	return toolbarAnchorRow(corner) === "bottom" ? "up" : "down";
}

/** The horizontal span of something already on screen, in viewport pixels. */
export interface Span {
	left: number;
	right: number;
}

export interface PopOffsetInput {
	/** The strip's own box: the pop is positioned relative to its right edge. */
	strip: Span;
	/** The button the pop hangs from. */
	button: Span;
	/** The pop's rendered width. */
	popWidth: number;
	/** The pane the whole thing must stay inside. */
	pane: Span;
}

/**
 * The pop's `right` offset from the strip's right edge, in pixels.
 *
 * CENTRED UNDER ITS BUTTON, which is the rule that has always applied - the
 * offset arithmetic drifted a full button's width in the bottom-left corner
 * before it was measured from real rects (glass, 2026-08-31).
 *
 * THEN CLAMPED TO THE PANE, which arrived with the centre-column anchors and is why
 * this moved out of the closure. The old clamp was `Math.max(0, right)`: it
 * stopped the pop escaping past the strip's own right edge, which is the
 * correct instinct in a right-hand corner, where the strip's edge and the
 * pane's very nearly coincide. A centred strip's edges are nowhere near the
 * pane's, so that clamp both allows a pop to run off the pane on one side and
 * needlessly forbids it from using the room it has on the other.
 *
 * The pane clamp says what was actually meant: keep the pop on screen. In a
 * corner it reduces to very nearly the old behaviour; in the middle it is the
 * only thing standing between a wide pop and the edge of the pane.
 *
 * A pop WIDER than the pane cannot satisfy both ends. It keeps its left edge,
 * because that is where its content starts.
 */
export function popRightOffset(input: PopOffsetInput): number {
	const { strip, button, popWidth, pane } = input;
	const centred = strip.right - button.right + (button.right - button.left - popWidth) / 2;
	// Its right edge may not pass the pane's right edge...
	const min = strip.right - pane.right;
	// ...and its left edge may not pass the pane's left.
	const max = strip.right - popWidth - pane.left;
	if (max < min) return max;
	return Math.min(Math.max(centred, min), max);
}
