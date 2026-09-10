/**
 * THE FOLD LINE FOLLOWS THE WINDOW, measured.
 *
 * "draggong wrks fine, i narrowed the window and it didnt update the more
 * line" (alan, 2026-09-05, on his own screen, settings tab open over a note).
 *
 * WHY THIS SUITE AND NOT THE UNIT ONE. The cause is a measurement: `MobileTools
 * .layoutOverflow` reads `offsetWidth` on two elements that `styles.css` hides
 * with `display: none` most of the time - the More chevron
 * (`.handwriting-tools-more`, painted only under `is-more-needed`) and every
 * button already parked on the second row (`.handwriting-mobile-tools-more`,
 * painted only under `is-more-open`). A box that is not painted has no
 * dimensions, so both read 0. Nothing without a layout engine and the real
 * stylesheet can see that: the unit suite's elements answer whatever the fake
 * is told to answer, and `FoldOrderControl.test.ts` therefore has to STATE the
 * two display rules as a model. This file states nothing - the engine hides
 * them, the engine measures them, and `chevronAsIs` below is the number.
 *
 * WHAT THIS CAN ANSWER
 *   - what the chevron and a folded button actually measure while hidden
 *   - whether the dashed line moves when the window narrows, at the widths it
 *     really moves at, under the real `--handwriting-fold-keep` arithmetic
 *   - whether the LIST and the PREVIEW STRIP agree about how many buttons are
 *     behind More - the disagreement is the defect, and it is invisible to
 *     anything that reads only one of them
 *   - whether the fold is monotone in the window's width, and whether the same
 *     width reached by two routes lands in the same place
 *
 * WHAT THIS CANNOT ANSWER
 *   - anything about Obsidian. The workspace is rebuilt in `foldOrderPage.ts`
 *     from the class names `detectStripWidth` reads, and the settings modal is
 *     a fixed-width box because Obsidian's does not shrink until the window is
 *     narrower than it is. Both are parameters. The real acceptance is Alan's
 *     screen.
 *   - anything about a phone. This is desktop Chromium at a narrowed viewport.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openFoldOrder, type Browser, type FoldHarness } from "./harness";

let browser: Browser;

beforeAll(async () => {
	browser = await launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
});

/**
 * The window widths this walks, wide to narrow.
 *
 * They straddle the width the row stops fitting at rather than sitting either
 * side of it: the defect is a mis-measurement of one button's width, so a
 * sweep that jumped from "everything fits" to "half of it is gone" would step
 * over the one place the arithmetic is close.
 */
const NARROWING = [1400, 520, 500, 480, 460, 440, 420, 400] as const;

const WIDEST = NARROWING[0];
const NARROWEST = NARROWING[NARROWING.length - 1] as number;

/** A settings modal wide enough not to shrink at any width swept here. */
const MODAL = 600;

const open = (over: { realStrip: boolean }): Promise<FoldHarness> =>
	openFoldOrder(browser, { modalWidth: MODAL, viewport: WIDEST, ...over });

describe("the two boxes the fold is measured against are display: none", () => {
	// The cause, in the engine's own numbers, and the reason the fix is where
	// it is. This stays true after the fix: the stylesheet still hides them,
	// and what changed is that `layoutOverflow` no longer reads them hidden.
	it("the chevron measures nothing until the row needs it", async () => {
		const h = await open({ realStrip: true });
		try {
			await h.setWidth(WIDEST);
			const wide = await h.hidden();
			// Nothing has overflowed, so the chevron is not on the row.
			expect(wide.moreNeeded).toBe(false);
			expect(wide.chevronAsIs).toBe(0);
			// And it is not zero px wide - it is a strip button, and it costs
			// a strip button's width the moment it appears.
			expect(wide.chevronForced).toBeGreaterThan(24);
		} finally {
			await h.close();
		}
	}, 120_000);

	it("a button behind a closed More measures nothing either", async () => {
		const h = await open({ realStrip: true });
		try {
			// Narrow enough to fold, then read what the folded buttons measure
			// with the second row closed, which is the state `applyFoldOrder`
			// puts the strip in before it measures.
			await h.setWidth(NARROWEST);
			const narrow = await h.hidden();
			expect(narrow.secondRowForced.length).toBeGreaterThan(0);
			for (const w of narrow.secondRowForced) expect(w).toBeGreaterThan(24);
		} finally {
			await h.close();
		}
	}, 120_000);
});

describe("narrowing the window moves the fold line", () => {
	// BOTH SURFACES, because `detectStripWidth` takes a different branch in
	// each and Alan's toolbar was up: with a real strip on screen it reads the
	// strip's own parent, and without one it reads the active editor's pane.
	for (const realStrip of [true, false]) {
		const surface = realStrip ? "with the toolbar up" : "with no toolbar on screen";

		it(`moves it, ${surface}`, async () => {
			const h = await open({ realStrip });
			try {
				await h.setWidth(WIDEST);
				const wide = await h.probe();
				await h.setWidth(NARROWEST);
				const narrow = await h.probe();
				// Cannot fail open: the sweep really does cross the fold.
				expect(wide.previewSecondRow).toHaveLength(0);
				expect(wide.caption).toBe("Drag to order. Everything fits on the screen.");
				expect(narrow.previewSecondRow.length).toBeGreaterThan(0);
				// THE REPORTED SYMPTOM. The line is drawn from
				// `--handwriting-fold-keep`, so this is the number that has to
				// move, and `lineTop` is where the engine actually put it.
				expect(Number(narrow.keep)).toBeLessThan(Number(wide.keep));
				expect(narrow.lineTop).toBeLessThan(wide.lineTop);
				expect(narrow.caption).toBe("Drag to order. Buttons below this line will collapse when window narrows.");
			} finally {
				await h.close();
			}
		}, 120_000);

		it(`keeps the list and the strip saying the same thing, ${surface}`, async () => {
			const h = await open({ realStrip });
			try {
				// Down and back up: the fold has to be a function of the width,
				// not of the widths it has been at.
				for (const w of [...NARROWING, ...[...NARROWING].reverse()]) {
					await h.setWidth(w);
					const p = await h.probe();
					// The line splits the list in two and nothing falls
					// between: the rows that stay, plus the buttons the strip
					// really has behind More, are the whole list. This is the
					// assertion the defect broke - the strip corrected itself
					// on a later pass and the list never heard about it.
					expect(
						Number(p.keep) + p.previewSecondRow.length,
						`at ${w}px: keep=${p.keep}, behind More=${JSON.stringify(p.previewSecondRow)}`
					).toBe(p.rowCount);
				}
			} finally {
				await h.close();
			}
		}, 120_000);
	}

	it("never puts FEWER behind More as the window gets narrower", async () => {
		const h = await open({ realStrip: true });
		try {
			const counts: number[] = [];
			for (const w of NARROWING) {
				await h.setWidth(w);
				counts.push((await h.probe()).previewSecondRow.length);
			}
			// Monotone. A button already behind More used to measure 0, look
			// free, and come back out on the next - narrower - pass, so this
			// ran 0, 1, 3, 0, 2, 4, 0, 4 on the way down.
			expect(counts).toEqual([...counts].sort((a, b) => a - b));
		} finally {
			await h.close();
		}
	}, 120_000);

	it("lands in the same place whichever way the window got there", async () => {
		const direct = await open({ realStrip: true });
		const stepped = await open({ realStrip: true });
		try {
			await direct.setWidth(440);
			await stepped.setWidth(480);
			await stepped.setWidth(440);
			const a = await direct.probe();
			const b = await stepped.probe();
			expect(a.detected).toBe(b.detected);
			// Same width, same fold - and the same line. The old measurement
			// depended on which buttons happened to be hidden when it ran, so
			// one step through 480px was enough to change the answer.
			expect(b.keep).toBe(a.keep);
			expect(b.lineTop).toBe(a.lineTop);
			expect(b.previewSecondRow).toEqual(a.previewSecondRow);
		} finally {
			await direct.close();
			await stepped.close();
		}
	}, 120_000);
});
