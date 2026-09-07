/**
 * The dodge, attacked with rectangles.
 *
 * `MobileTools` measures and applies; `stripClearance` decides. The unit
 * suite has no layout, so this is the half that can be tested here at all -
 * and the half that runs in the gate. The other half, whether the rendered
 * boxes really stop intersecting under the real stylesheet, is measured in a
 * real browser by `test/render/StripHeaderClearance.test.ts`, which is NOT in
 * the default run (`npm run test:render`).
 *
 * Coordinates below are a pane at the origin, 420 wide - a handset - unless a
 * case says otherwise. The actions row sits at its top right, the way
 * Obsidian puts it.
 */
import { describe, expect, it } from "vitest";
import { stripClearance, type Box } from "./StripClearance";

const box = (left: number, top: number, right: number, bottom: number): Box => ({
	left,
	top,
	right,
	bottom,
});

const PANE = box(0, 0, 420, 700);
const WIDE = box(0, 0, 1200, 700);
/** Two 26px buttons and their padding, at the top right of the header. */
const ACTIONS = box(346, 7, 412, 33);
const WIDE_ACTIONS = box(1126, 7, 1192, 33);

const GAP = 8;

describe("stripClearance: nothing in the way, nothing moved", () => {
	it("does nothing when the pane has no actions row at all", () => {
		expect(
			stripClearance({
				corner: "top-right",
				strip: box(8, 8, 412, 48),
				actions: null,
				pane: PANE,
				gap: GAP,
			})
		).toEqual({ x: 0, y: 0 });
	});

	// Obsidian leaves the element in the tree with a zero box in several
	// states, and a zero-width box at the origin would read as overlapping a
	// top-LEFT strip if only the coordinates were compared.
	it("does nothing for a collapsed, zero-sized actions row", () => {
		expect(
			stripClearance({
				corner: "top-left",
				strip: box(8, 8, 412, 48),
				actions: box(0, 0, 0, 0),
				pane: PANE,
				gap: GAP,
			})
		).toEqual({ x: 0, y: 0 });
	});

	// THE NOTE SURFACE. Its strip mounts inside `.view-content`, so its box
	// starts below the header and the two can never meet - and it must not be
	// moved for a collision it does not have.
	it("does nothing for a strip that starts below the actions row", () => {
		expect(
			stripClearance({
				corner: "top-right",
				strip: box(8, 48, 412, 88),
				actions: ACTIONS,
				pane: PANE,
				gap: GAP,
			})
		).toEqual({ x: 0, y: 0 });
	});

	// A bottom corner shares the pane's right edge with the actions row and
	// is nowhere near it vertically. Testing only the horizontal span would
	// shove it sideways for nothing.
	it("does nothing for a bottom corner, which overlaps only horizontally", () => {
		expect(
			stripClearance({
				corner: "bottom-right",
				strip: box(8, 652, 412, 692),
				actions: ACTIONS,
				pane: PANE,
				gap: GAP,
			})
		).toEqual({ x: 0, y: 0 });
	});
});

describe("stripClearance: sideways, where there is room beside the actions", () => {
	// The pill: 34px, so it fits to the left of the actions even on a
	// handset. This is the state a phone writes in.
	it("slides a narrow pill left, clear of the actions by the gap", () => {
		const got = stripClearance({
			corner: "top-right",
			strip: box(375, 11, 409, 45),
			actions: ACTIONS,
			pane: PANE,
			gap: GAP,
		});
		expect(got.y).toBe(0);
		// Its right edge lands exactly `gap` left of the actions' left edge.
		expect(409 + got.x).toBe(ACTIONS.left - GAP);
	});

	it("slides a full strip left on a pane wide enough for it", () => {
		const got = stripClearance({
			corner: "top-right",
			strip: box(788, 8, 1192, 48),
			actions: WIDE_ACTIONS,
			pane: WIDE,
			gap: GAP,
		});
		expect(got.y).toBe(0);
		expect(1192 + got.x).toBe(WIDE_ACTIONS.left - GAP);
		// And it is still on the pane, which is the condition for taking this
		// branch at all.
		expect(788 + got.x).toBeGreaterThanOrEqual(WIDE.left);
	});

	// The corner decides the DIRECTION, not the amount, so a left-corner
	// strip that somehow reaches the actions is pushed past their right edge
	// rather than further under them.
	it("slides a left-corner strip RIGHT, past the actions", () => {
		const got = stripClearance({
			corner: "top-left",
			strip: box(8, 8, 120, 48),
			actions: box(60, 7, 126, 33),
			pane: WIDE,
			gap: GAP,
		});
		expect(got.y).toBe(0);
		expect(8 + got.x).toBe(126 + GAP);
	});
});

describe("stripClearance: down, where sideways would leave the pane", () => {
	/**
	 * THE BUG THIS BRANCH EXISTS FOR, found by the render harness rather than
	 * reasoned about: a full strip is most of a handset wide, so shifting it
	 * left of a right-aligned actions row put its left edge at about -400.
	 * It no longer overlapped the dots and was no longer reachable either,
	 * and an overlap assertion alone reported that as a fix.
	 */
	it("drops a full-width strip below the actions instead of off the pane", () => {
		const strip = box(8, 8, 412, 48);
		const got = stripClearance({
			corner: "top-right",
			strip,
			actions: ACTIONS,
			pane: PANE,
			gap: GAP,
		});
		expect(got.x).toBe(0);
		// Its top lands exactly `gap` below the actions' bottom.
		expect(strip.top + got.y).toBe(ACTIONS.bottom + GAP);
	});

	it("takes the same way out from a top-left corner on a narrow pane", () => {
		const strip = box(8, 8, 412, 48);
		const got = stripClearance({
			corner: "top-left",
			strip,
			actions: ACTIONS,
			pane: PANE,
			gap: GAP,
		});
		expect(got.x).toBe(0);
		expect(strip.top + got.y).toBe(ACTIONS.bottom + GAP);
	});

	// Clear of the ACTIONS, not of the header. A header with a tall title
	// above an inline actions row would push the strip further than it needs
	// to go, and the thing that must stay reachable is the dots.
	it("clears the actions row and no more", () => {
		const strip = box(8, 8, 412, 48);
		const shortActions = box(346, 7, 412, 20);
		const got = stripClearance({
			corner: "top-right",
			strip,
			actions: shortActions,
			pane: PANE,
			gap: GAP,
		});
		expect(strip.top + got.y).toBe(shortActions.bottom + GAP);
	});
});

/**
 * A MIDDLE STRIP HAS NO SIDE TO REASON FROM.
 *
 * The dodge direction was a two-way `endsWith("right")` test, so a middle
 * anchor - which ends in neither "right" nor "left" - fell into the left-hand
 * branch and dodged RIGHT. On the pane that matters, the actions row is in
 * the top right, so that pushed a top-middle strip straight into the dots it
 * was supposed to be avoiding. The middles read the geometry instead.
 */
describe("stripClearance: a middle dodges away from the actions, whichever side they are", () => {
	const pane = box(0, 0, 1000, 800);
	const gap = 8;

	/** A centred strip overlapping a box in the pane's top right. */
	const centredStrip = box(400, 10, 600, 50);

	it("goes LEFT when the actions sit to its right", () => {
		const actions = box(560, 10, 640, 50);
		const out = stripClearance({ corner: "top-center", strip: centredStrip, actions, pane, gap });
		expect(out.x).toBeLessThan(0);
		// Far enough to clear them, and no further.
		expect(centredStrip.right + out.x).toBeLessThanOrEqual(actions.left - gap + 0.001);
	});

	// The mirror, which the name-based branch could never have got right for
	// a middle: an actions row on the LEFT of a centred strip.
	it("goes RIGHT when the actions sit to its left", () => {
		const actions = box(360, 10, 440, 50);
		const out = stripClearance({ corner: "top-center", strip: centredStrip, actions, pane, gap });
		expect(out.x).toBeGreaterThan(0);
		expect(centredStrip.left + out.x).toBeGreaterThanOrEqual(actions.right + gap - 0.001);
	});

	it("still moves nothing when there is no overlap", () => {
		const actions = box(900, 10, 980, 50);
		const out = stripClearance({ corner: "top-center", strip: centredStrip, actions, pane, gap });
		expect(out).toEqual({ x: 0, y: 0 });
	});

	// The corners are untouched by the change: same inputs, same answers.
	it("leaves the corner rule exactly as it was", () => {
		const actions = box(560, 10, 640, 50);
		const right = stripClearance({ corner: "top-right", strip: centredStrip, actions, pane, gap });
		const left = stripClearance({ corner: "top-left", strip: centredStrip, actions, pane, gap });
		expect(right.x).toBeLessThan(0);
		expect(left.x).toBeGreaterThan(0);
	});
});
