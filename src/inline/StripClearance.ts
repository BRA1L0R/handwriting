/**
 * Keeping the floating strip off the pane's own "More options" button.
 *
 * THE DEFECT, on hardware (alan, 2026-09-05, on an Orion): "the current
 * chevron covers up the 3 settings dots on a pdf page". Obsidian puts a
 * `.view-actions` row - the three-dots menu and whatever else the view
 * registers - at the top right of every pane's header, and the strip's
 * default corner is top-right.
 *
 * WHY THE PDF AND NOT THE NOTE, verified in the code rather than assumed.
 * The two surfaces mount their strip on different elements. The note overlay
 * uses `view.dom.parentElement` (InkOverlay's `chromeHost`), which is inside
 * `.view-content` and therefore BELOW the header - its coordinate space
 * starts under the actions row, and nothing it draws can reach them. The pdf
 * controller is handed `leaf.view.containerEl` (main.ts), which is the WHOLE
 * leaf, header included. So the pdf strip's top-right corner is the header's
 * top-right corner, and the two land on each other. The note is checked here
 * all the same, and gets no offset because it needs none: the rule below is
 * driven by a MEASUREMENT, not by a surface's name, so a note whose header
 * ever did overlap would be moved and a pdf whose header is hidden is not.
 *
 * WHY A MEASUREMENT AND NOT A CONSTANT. A blanket "sit 40px lower in a top
 * corner" would move the note's strip for a collision it does not have, and
 * would still be wrong for the pdf on any theme, font size or platform where
 * the header is not 40px. What the actions row occupies is knowable at
 * runtime and guessable at no other time.
 *
 * SIDEWAYS IF IT FITS, DOWN IF IT DOES NOT. The brief allows either, and
 * both are needed, which the first draft of this rule did not notice.
 * Sideways is the better move where there is room: the strip stays on the
 * line the "Toolbar corner" setting put it on, and the actions row is a few
 * buttons wide against a header's full height. But a full strip is most of a
 * phone wide, and there is no room beside a right-aligned actions row for
 * something that wide - shifting it anyway walked it off the far edge of the
 * pane, where it no longer overlapped the dots and was no longer reachable
 * either. So the sideways dodge is taken only when the strip lands back
 * inside the pane, and otherwise it drops below the header, which is the
 * brief's other option and the one a phone will almost always take.
 */

import { isMiddleAnchor } from "./ToolbarCorner";
import type { ToolbarCorner } from "./ToolbarCorner";

/** The parts of a DOMRect this rule reads. */
export interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface ClearanceInput {
	/** Which corner the strip is parked in. */
	corner: ToolbarCorner;
	/** Where the strip sits with NO offset applied. */
	strip: Box;
	/** The pane's `.view-actions`, or null where the pane has none. */
	actions: Box | null;
	/**
	 * The pane the strip must stay inside. A sideways dodge that puts the
	 * strip outside this is refused in favour of dropping below the header -
	 * a strip that no longer covers the dots because it is off the edge of
	 * the pane is not a fix.
	 */
	pane: Box;
	/** Clear space to leave between the two, in px. */
	gap: number;
}

/** A `translate` in px. Both zero means "leave it exactly where it is". */
export interface Clearance {
	x: number;
	y: number;
}

const NONE: Clearance = { x: 0, y: 0 };

/**
 * How far to move the strip so it clears the actions row.
 *
 * Zero on both axes whenever they do not actually overlap, which is the
 * common case and every note: a rule that fired on "is a top corner" rather
 * than on "the boxes intersect" would move chrome that was never in the way.
 *
 * A translate rather than an adjusted inset, because the corner insets are
 * spelled out across a dozen stylesheet rules (safe-area, android's
 * notification shade, the pill's concentric offsets, mobile's larger targets)
 * and threading one more term through all of them is a dozen chances to miss
 * one.
 */
export function stripClearance(input: ClearanceInput): Clearance {
	const { corner, strip, actions, pane, gap } = input;
	if (!actions) return NONE;
	// A hidden or empty actions row is not in the way of anything. Obsidian
	// leaves the element in the tree with a zero box in several states, and a
	// zero-width box at the origin would otherwise read as overlapping a
	// strip in a top-left corner.
	if (actions.right - actions.left <= 0 || actions.bottom - actions.top <= 0) return NONE;
	// BOTH AXES. A bottom-corner strip shares the pane's right edge with the
	// actions row and is nowhere near it vertically; testing only the
	// horizontal span would shove it sideways for nothing.
	const overlapsX = strip.left < actions.right && actions.left < strip.right;
	const overlapsY = strip.top < actions.bottom && actions.top < strip.bottom;
	if (!overlapsX || !overlapsY) return NONE;
	// Away from the actions, by exactly enough. A right-corner strip goes
	// left, past the actions' left edge; a left-corner strip goes right, past
	// their right edge. The corner decides the DIRECTION rather than the
	// amount, so a strip in the "wrong" corner for its pane still ends up
	// clear rather than pushed further under.
	// A MIDDLE has no side to reason from, so it reads the geometry instead:
	// go away from whichever side the actions box actually sits on. The
	// corners keep their name-based rule, which is the same answer and one
	// they have been tested on since they shipped.
	//
	// Without this a middle fell into the "not right" branch and was treated
	// as a left-hand strip, so a top-middle strip overlapping a top-RIGHT
	// actions row dodged further right - INTO the dots it was avoiding.
	const away = isMiddleAnchor(corner)
		? actions.left + actions.right >= strip.left + strip.right
		: corner.endsWith("right");
	const dx = away
		? -(strip.right - actions.left + gap)
		: actions.right - strip.left + gap;
	// Does it land back inside the pane? A full strip is most of a phone
	// wide, so on a phone this is usually NO, and the answer that looked
	// right on a desktop walked the strip off the glass. Checked with the
	// pane's own edges rather than a width comparison, so a pane with the
	// strip already near an edge is judged on where it actually ends up.
	const fits =
		strip.left + dx >= pane.left - 0.5 && strip.right + dx <= pane.right + 0.5;
	if (fits) return { x: dx, y: 0 };
	// Otherwise DOWN, clear of the whole actions row. Not of the header - the
	// actions are what must stay reachable, and a header with a tall title
	// above an inline row would push the strip further than it needs to go.
	return { x: 0, y: actions.bottom - strip.top + gap };
}
