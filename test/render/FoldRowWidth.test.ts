/**
 * HOW WIDE A REORDER ROW IS.
 *
 * "why is there so much space still on the right" (alan, 2026-09-06, on the
 * five rows of the Toolbar buttons control). The rows were full-bleed: the
 * grip, the icon and the label all sat at the left and the row's border ran on
 * to 400px whatever the label said, five rows deep, directly under a pill of
 * six icons that is exactly as wide as its own content. The ruling is that a
 * row is no wider than its content, with a floor so the drag target and the
 * drop zone stay big enough to hit.
 *
 * THE MEASUREMENT HAS TO BE COMPARATIVE, and against the row's own ink rather
 * than against the card: a row is "too wide" only relative to what is written
 * in it. So every assertion below is a distance between the label's last pixel
 * and the row's border - a number that only a real engine has, because the
 * name span is a flex child that stretches and its `offsetWidth` is the row's
 * leftover space, not the text's width. `rowWidths()` measures the text with a
 * Range for that reason.
 *
 * A REAL BROWSER for the usual reason as well: `FoldOrderControl` builds a
 * preview `MobileTools` whose fold is computed from measured widths, and the
 * unit suite measures zero for everything.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { launch, openFoldOrder } from "./harness";

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
});
afterAll(async () => {
	await browser?.close();
});

/**
 * The row's own trailing chrome: 10px of padding-right and a 1px border. Two
 * more pixels of tolerance for sub-pixel text measurement, and no more - the
 * defect being pinned is a gap of a hundred and seventy.
 */
const TRAILING = 13;

/** The floor the ruling asks for, so the drop zone never becomes a sliver. */
const FLOOR = 200;

describe("a reorder row is no wider than its content", () => {
	it("ends just after the longest label, not at the card's edge", async () => {
		const h = await openFoldOrder(browser, { realStrip: true, modalWidth: 700, viewport: 1400 });
		try {
			const p = await h.rowWidths();
			// PRECONDITIONS. Rows exist, they are all one width (the list is a
			// column, so a row that shrank on its own would make "the widest
			// row" meaningless), and the card really is offering more room than
			// the content needs - without that last one, a row filling the card
			// and a row fitting its content are the same picture.
			expect(p.rows.length, "no rows were built").toBeGreaterThanOrEqual(5);
			const widths = new Set(p.rows.map((r) => Math.round(r.width)));
			expect(widths.size, `rows have different widths: ${[...widths].join(", ")}`).toBe(1);
			expect(p.cardInnerWidth).toBeGreaterThanOrEqual(FLOOR);

			// THE RULING. The row stops where its longest label stops, plus the
			// padding and border that label sits inside.
			const ink = Math.max(...p.rows.map((r) => r.textRight));
			const slack = p.rows[0]!.right - ink;
			expect(
				slack,
				`the widest row runs ${Math.round(slack)}px past its own text ` +
					`(row ${Math.round(p.rows[0]!.width)}px, card ${Math.round(p.cardInnerWidth)}px)`
			).toBeLessThanOrEqual(TRAILING);

			// And the row is genuinely narrower than the room it was offered,
			// which is the complaint in one number.
			expect(p.cardInnerWidth - p.rows[0]!.width).toBeLessThan(48);
		} finally {
			await h.close();
		}
	});

	it("keeps a comfortable minimum under the shortest labels", async () => {
		const h = await openFoldOrder(browser, { realStrip: true, modalWidth: 700, viewport: 1400 });
		try {
			const p = await h.rowWidths();
			// A row is a drag handle and a drop zone before it is a label, so
			// the floor is not allowed to follow the text all the way down.
			for (const row of p.rows) {
				expect(row.width, `${row.label} is ${Math.round(row.width)}px wide`).toBeGreaterThanOrEqual(FLOOR);
			}
		} finally {
			await h.close();
		}
	});

	it("keeps the dashed line and the rows agreeing", async () => {
		// The line spans the list and carries the "More" label at its right
		// end, so a list that shrank away from its rows - or rows that shrank
		// away from the line - would put the split mark somewhere it does not
		// belong. Same left edge, same width, whatever that width is.
		const h = await openFoldOrder(browser, { realStrip: true, modalWidth: 700, viewport: 1400 });
		try {
			const p = await h.rowWidths();
			const row = p.rows[0]!;
			expect(Math.abs(p.lineLeft - row.left)).toBeLessThanOrEqual(1);
			expect(Math.abs(p.lineWidth - row.width)).toBeLessThanOrEqual(1);
			expect(Math.abs(p.listWidth - row.width)).toBeLessThanOrEqual(1);
		} finally {
			await h.close();
		}
	});

	it("does not change width when a row is picked up", async () => {
		// The one thing sizing a list to its content can break that a fixed
		// width could not: the dragged row wears a 2px border where the others
		// have 1, and a list measured from its rows' border boxes would grow by
		// two pixels the instant a grip goes down - moving the dashed line, the
		// "More" label and every right edge under the hand that is dragging.
		const h = await openFoldOrder(browser, { realStrip: true, modalWidth: 700, viewport: 1400 });
		try {
			const p = await h.pickUpWidth();
			expect(p.dragging, `${p.idle}px at rest, ${p.dragging}px dragging`).toBe(p.idle);
		} finally {
			await h.close();
		}
	});

	it("still fits when the settings pane is narrower than the rows want", async () => {
		// The floor is a floor, not a width: a pane too narrow for it must
		// still not push the list out through the side of its own card.
		const h = await openFoldOrder(browser, { realStrip: true, modalWidth: 280, viewport: 900 });
		try {
			const p = await h.rowWidths();
			expect(p.cardInnerWidth).toBeLessThan(FLOOR + 60);
			expect(
				p.listWidth,
				`the list is ${Math.round(p.listWidth)}px inside a ${Math.round(p.cardInnerWidth)}px card`
			).toBeLessThanOrEqual(p.cardInnerWidth + 1);
		} finally {
			await h.close();
		}
	});
});
