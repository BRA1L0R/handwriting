/**
 * Dragging the pen toolbar to an anchor, decided without touching the DOM.
 *
 * Alan, 2026-09-05: "drag to anchor we can get out in 1.4.12? do it". The
 * convention is Apple's pencil palette: pick the thing up, put it anywhere,
 * and on release it flies to the nearest resting place. The six resting
 * places already exist and are already a setting - `ToolbarCorner.ts` owns
 * that vocabulary - so this module adds no seventh place and no new state.
 * It answers two questions and nothing else: has a contact become a drag,
 * and which of the six did the drag land on.
 *
 * DOM-FREE for the reason `StripClearance.ts` is: the suite has no layout, so
 * a rule living inside `MobileTools` could only be tested by not testing it.
 * What is left in the class is the measuring and the moving.
 */

import { TOOLBAR_CORNERS } from "./ToolbarCorner";
import type { ToolbarCorner } from "./ToolbarCorner";

/** The parts of a DOMRect these rules read. */
export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

/**
 * How far a contact must travel before it is a drag rather than a tap.
 *
 * A TAP MUST STILL BE A TAP: the collapsed pill is the handle when the strip
 * is folded away, and its tap is what brings the strip back. A pen on glass
 * moves a pixel or two between contact and lift on every tap ever made, so a
 * threshold of zero would mean the pill could never be tapped again. Six is
 * the same slop Obsidian's own drag handles use and comfortably above pen
 * jitter without being far enough to feel like a delay.
 */
export const DRAG_THRESHOLD_PX = 6;

/**
 * The gap the stylesheet leaves between an anchored strip and the pane's
 * edges, which is what puts each anchor's resting centre where it is.
 *
 * A COPY OF A STYLESHEET NUMBER, and it is pinned by a test that reads
 * `styles.css` rather than left to drift. It is only ever a tie-breaker: the
 * inset shifts all six resting centres inward by the same amount, so it moves
 * the boundaries between them by a few px and can change the answer only for
 * a drop that was already almost exactly between two anchors. The landing
 * itself never trusts it - `MobileTools` measures the real box before and
 * after the corner changes and animates the difference - so an inset that is
 * a few px out (a phone's safe-area term, android's notification shade) costs
 * a borderline choice and never a strip in the wrong place.
 */
export const TOOLBAR_ANCHOR_INSET_PX = 8;

/**
 * Has this contact travelled far enough to be a drag?
 *
 * STRICTLY beyond, so exactly the threshold is still a tap: the brief says
 * "movement beyond 6px", and a boundary written the other way would make the
 * one distance the test names ambiguous.
 */
export function dragPassedThreshold(dx: number, dy: number): boolean {
	return dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
}

/**
 * Where an anchor puts the CENTRE of a strip of this size, in the pane's own
 * client coordinates.
 *
 * SIZE IS AN INPUT because the strip has two of them. Collapsed it is a 34px
 * pill and expanded it is most of a phone wide, and the resting centre of a
 * left or right anchor is half that width in from the edge - so the same
 * finger position can legitimately be nearest a different anchor depending on
 * which of the two is on screen. Passing the size in is what makes the answer
 * match what the user is actually holding, and it is the same choice
 * `applyHeaderClearance` already makes when it measures the pill rather than
 * the hidden strip for a collapsed toolbar.
 *
 * A MIDDLE has no horizontal inset: the stylesheet centres it with auto
 * margins between `left: 0` and `right: 0`, so its resting centre is the
 * pane's own centre whatever the strip's width.
 */
export function anchorRestingCentre(
	corner: ToolbarCorner,
	pane: Box,
	size: Size,
	inset: number
): Point {
	const x = corner.endsWith("left")
		? pane.left + inset + size.width / 2
		: corner.endsWith("right")
			? pane.right - inset - size.width / 2
			: (pane.left + pane.right) / 2;
	const y = corner.startsWith("top")
		? pane.top + inset + size.height / 2
		: pane.bottom - inset - size.height / 2;
	return { x, y };
}

export interface NearestAnchorInput {
	/** Where the strip's centre is right now, mid-drag, in client coordinates. */
	centre: Point;
	/** The pane the strip is positioned inside. */
	pane: Box;
	/** The strip's layout size right now - the pill's, when it is collapsed. */
	size: Size;
	/** How far each anchor rests from the pane's edges. */
	inset: number;
	/**
	 * The anchor the strip is already parked in, and the tie-break.
	 *
	 * NOT decoration. The strip's stylesheet caps it at `calc(100% - 16px)`,
	 * which is exactly the width at which the left and right resting centres
	 * COINCIDE - so on a phone, where the strip is routinely at that cap, a
	 * top-left and a top-right drop are the same point and the comparison
	 * below is a genuine tie. Breaking it towards where the strip already is
	 * means a drag that cannot choose leaves the setting alone, rather than
	 * silently rewriting it to whichever name happened to sort first.
	 */
	current: ToolbarCorner;
}

/**
 * Which of the six the strip landed on: the nearest by straight-line distance
 * from the strip's centre to that anchor's resting centre.
 *
 * CENTRE TO CENTRE, not corner to corner and not pointer to corner. The
 * pointer is wherever the hand happened to grab, which for a strip most of a
 * phone wide is nowhere near its middle; measuring from the grab point would
 * mean the same gesture landed differently depending on which end of the grip
 * the finger started on. The strip's own centre is the thing the user is
 * moving, and comparing it against where it WOULD sit at each anchor is the
 * only comparison that answers "which of these six is this closest to being".
 */
export function nearestAnchor(input: NearestAnchorInput): ToolbarCorner {
	const { centre, pane, size, inset, current } = input;
	const distanceTo = (corner: ToolbarCorner): number => {
		const at = anchorRestingCentre(corner, pane, size, inset);
		const dx = at.x - centre.x;
		const dy = at.y - centre.y;
		return dx * dx + dy * dy;
	};
	let best = current;
	let bestDistance = distanceTo(current);
	for (const corner of TOOLBAR_CORNERS) {
		const d = distanceTo(corner);
		// STRICTLY closer, which is what leaves `current` holding every tie.
		if (d < bestDistance) {
			best = corner;
			bestDistance = d;
		}
	}
	return best;
}
