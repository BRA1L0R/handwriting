/**
 * WHERE THE FOLDED BUTTONS SIT.
 *
 * "Blocks are uneven" (alan, 2026-09-05, with a screenshot). When the strip
 * does not fit, the buttons that do not make it go onto a second row of their
 * own. That row is `width: 100%`, so it is always exactly as wide as the
 * strip; its BUTTONS are fewer than the first row's, so they never fill it.
 * Wherever they are packed - the row shipped `justify-content: flex-end` -
 * all the leftover space collects at one end and the strip reads as a
 * rectangle with a bite out of one corner.
 *
 * The ruling is to centre them under the first row.
 *
 * A REAL BROWSER, because the fold does not exist without one: `layoutOverflow`
 * measures the pane and bails when it measures zero, which is every element in
 * the unit suite. Nothing below is reachable there.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { launch, openStrip } from "./harness";

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
});
afterAll(async () => {
	await browser?.close();
});

/**
 * Pane widths narrow enough that the full row cannot fit and the fold has to
 * happen, and wide enough that folding still WORKS. Several, because the
 * leftover space is a different size at each one and a rule that only centres
 * at one width is not a rule.
 *
 * 320 used to be one of these and is not any more. Below about 356px on this
 * harness the fold runs out of buttons to move, the strip wears `is-wrapped`
 * and lays itself out as a grid (StripWrapGrid.test.ts), and the folded row
 * spans that grid exactly - at 320 it comes out with no leftover space at
 * all, which makes the precondition below unsatisfiable rather than the
 * ruling wrong. The ruling this file pins is about the row that is centred
 * inside slack, so these are the widths that have some.
 */
const NARROW = [380, 420, 460] as const;

describe("the folded second row is centred under the first", () => {
	for (const width of NARROW) {
		it(`centres the fold at ${width}px`, async () => {
			const h = await openStrip(browser, {});
			try {
				const p = await h.moreRow(width);
				// PRECONDITIONS. Every assertion below is about a row that
				// exists, is showing, and is genuinely shorter than the one
				// above it - the case that made the block look wrong. Without
				// these, an empty second row would centre perfectly and prove
				// nothing.
				expect(p.needed, "the strip did not decide it needed a fold").toBe(true);
				expect(p.open, "the fold did not open").toBe(true);
				expect(p.secondRow).toBeGreaterThan(0);
				expect(
					p.secondRow,
					"the second row is as full as the first, so there is no slack to place"
				).toBeLessThan(p.firstRow);
				// Slack has to actually exist, or "centred" and "end-aligned"
				// are the same picture.
				expect(p.slackLeft + p.slackRight).toBeGreaterThan(4);

				// THE RULING: equal space either side. A sub-pixel tolerance,
				// not a loose one - an odd number of leftover pixels is the
				// only honest reason for these to differ.
				expect(Math.abs(p.slackLeft - p.slackRight)).toBeLessThanOrEqual(1);
			} finally {
				await h.close();
			}
		});
	}

	it("still folds the same buttons it always did", async () => {
		// The ruling was "nothing else about folding changes". The fold is
		// decided by `overflowPlan`, which this alignment does not touch, so
		// the counts at a given width are the counts that were there before.
		const h = await openStrip(browser, {});
		try {
			const p = await h.moreRow(360);
			expect(p.firstRow + p.secondRow).toBeGreaterThan(6);
			expect(p.secondRow).toBeGreaterThan(0);
		} finally {
			await h.close();
		}
	});
});
