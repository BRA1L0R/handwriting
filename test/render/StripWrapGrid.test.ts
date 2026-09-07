/**
 * THE WRAPPED STRIP IS A GRID, and it has no dividers in it.
 *
 * Alan, with a screenshot of a narrow pane (2026-09-06): "hide the dividers
 * whenver the strip is wrapped and thenmake the wrap an even grid". What he
 * was looking at was `flex-wrap: wrap` doing the only thing it can - packing
 * each line greedily until it will not take another button, so the lines come
 * out different lengths and whatever is left over sits alone under them - with
 * the three GROUP DIVIDERS still drawn. A divider is a hairline that means
 * "these belong together" in one horizontal row; in a stack it stands at the
 * end of a line dividing nothing, which is what he circled.
 *
 * A REAL BROWSER, because none of this exists without one. `layoutOverflow`
 * bails when the pane measures zero, which is every element in the unit
 * suite, so the fold, the wrap and the grid all only happen here.
 *
 * WHAT IS ASSERTED
 *   - wide: one line, `display: flex`, the dividers painted. The control, and
 *     the thing that stops "no dividers anywhere" from passing this file.
 *   - wrapped: `display: grid`, every divider `display: none`, every line the
 *     same width bar the last, every line starting at the same left edge, and
 *     no line longer than the first. Column alignment is the whole of "even".
 *   - the two-wide stack from the screenshot: the shape he photographed,
 *     asserted as the shape it now comes out as.
 *
 * WHAT THIS CANNOT ANSWER: how it looks. The widths below are desktop's 32px
 * button, not a phone's 40px (`harness.ts` has no `.is-mobile` body), so the
 * pane widths here are not the pane widths on Alan's phone - the SHAPES are
 * the same and the numbers are not.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openStrip, type Browser, type Harness } from "./harness";
import type { StripGridProbe } from "./stripPage";

let browser: Browser;
let strip: Harness;
beforeAll(async () => {
	browser = await launch();
	strip = await openStrip(browser);
}, 120_000);
afterAll(async () => {
	await strip?.close();
	await browser?.close();
});

/**
 * Pane widths, chosen off a measured sweep of this very harness rather than
 * computed here: 480 is the whole row on one line, 300 is the pane where the
 * fold has run out and the grid is two lines, and 120 is the narrow pane whose
 * shape - two controls per line - is the one in the screenshot.
 */
const ROOMY = 480;
const WRAPPED = 300;
const STACK = 120;

/** Every line but the last, which is the only one allowed to be short. */
const full = (p: StripGridProbe): StripGridProbe["lines"] => p.lines.slice(0, -1);

describe("a strip with room for its row", () => {
	it("is one flex line, and its group dividers are drawn", async () => {
		const p = await strip.grid({ width: ROOMY });
		expect(p.wrapped).toBe(false);
		expect(p.display).toBe("flex");
		expect(p.lines).toHaveLength(1);
		// Three groups: modes, selection actions, history. Painted, and one
		// hairline wide - the 9px box they now sit in is clearance, not ink.
		expect(p.dividerDisplays).toEqual(["block", "block", "block"]);
		expect(p.dividerWidths).toEqual([9, 9, 9]);
	});
});

describe("a strip too narrow for its row even folded", () => {
	it("says so, in a class, and lays itself out as a grid", async () => {
		const p = await strip.grid({ width: WRAPPED });
		expect(p.wrapped).toBe(true);
		expect(p.display).toBe("grid");
		expect(p.lines.length).toBeGreaterThan(1);
	});

	it("draws no group dividers at all", async () => {
		const p = await strip.grid({ width: WRAPPED });
		// Not "narrow", not "transparent": gone. A divider that still owned a
		// cell would be a hole in the grid, and the grid's cells are counted
		// rather than measured.
		expect(p.dividerDisplays).toEqual(["none", "none", "none"]);
		expect(p.dividerWidths).toEqual([0, 0, 0]);
	});

	it("gives every line the same left edge and the same width bar the last", async () => {
		const p = await strip.grid({ width: WRAPPED });
		// One left edge for every line is column alignment, which is the
		// difference between a grid and a wrap. The greedy wrap this replaced
		// put every line at a different left edge, because the strip packs to
		// `flex-end` and each line held a different number of things.
		const lefts = new Set(p.lines.map((l) => l.left));
		expect([...lefts]).toHaveLength(1);
		const widths = new Set(full(p).map((l) => l.width));
		expect([...widths]).toHaveLength(1);
		const first = p.lines[0];
		if (!first) throw new Error("a wrapped strip with no lines");
		for (const line of p.lines) expect(line.width).toBeLessThanOrEqual(first.width);
	});

	it("spreads its cells evenly rather than stranding the remainder", async () => {
		const p = await strip.grid({ width: WRAPPED });
		const counts = p.lines.map((l) => l.count);
		const cols = counts[0];
		if (cols === undefined) throw new Error("a wrapped strip with no lines");
		// Balanced, not greedy: every line but the last is full, and the last
		// is within one column of full. The greedy wrap's failure mode is a
		// last line holding one control under a line holding eleven, and this
		// is the number that says it cannot happen.
		for (const c of counts.slice(0, -1)) expect(c).toBe(cols);
		const last = counts[counts.length - 1];
		if (last === undefined) throw new Error("a wrapped strip with no lines");
		expect(last).toBeGreaterThan(0);
		expect(cols - last).toBeLessThan(counts.length);
	});
});

describe("opening the fold on a wrapped strip", () => {
	it("gives the folded row the whole grid rather than a column of it", async () => {
		const p = await strip.grid({ width: WRAPPED, open: true });
		expect(p.wrapped).toBe(true);
		expect(p.moreRow).not.toBeNull();
		expect(p.moreRow?.open).toBe(true);
		expect(p.moreRow?.count).toBeGreaterThan(0);
		// `width: 100%` is what made this a row on a flex line; in a grid it
		// is 100% of one COLUMN unless it is told to span, and a folded row
		// squeezed into a 32px column is the worst thing on this page.
		expect(p.moreRow?.width).toBe(p.content.width);
	});

	it("leaves the lines above it as even as they were", async () => {
		const shut = await strip.grid({ width: WRAPPED });
		const open = await strip.grid({ width: WRAPPED, open: true });
		// Opening the fold moves no button between lines: the plan is the
		// same plan, and `setMoreOpen` does not re-run it.
		expect(open.lines.map((l) => l.count)).toEqual(shut.lines.map((l) => l.count));
		expect(open.lines.map((l) => l.width)).toEqual(shut.lines.map((l) => l.width));
	});
});

describe("the narrow pane from the screenshot", () => {
	it("comes out as an even two-wide stack, dividers and all gone", async () => {
		const p = await strip.grid({ width: STACK });
		expect(p.wrapped).toBe(true);
		expect(p.display).toBe("grid");
		expect(p.dividerDisplays).toEqual(["none", "none", "none"]);
		// Two per line, and the one control that cannot pair up is the last -
		// which is the arrangement Alan's ruling allows out loud ("the More
		// chevron may sit alone"), rather than a button orphaned mid-stack.
		const counts = p.lines.map((l) => l.count);
		expect(counts.slice(0, -1).every((c) => c === 2)).toBe(true);
		expect(counts[counts.length - 1]).toBeLessThanOrEqual(2);
		const lefts = new Set(p.lines.map((l) => l.left));
		expect([...lefts]).toHaveLength(1);
	});
});
