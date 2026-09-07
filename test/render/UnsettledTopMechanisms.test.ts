/**
 * What `view.documentTop` does after a stroke is stored against it, measured
 * on a REAL CodeMirror `EditorView` in a real engine - the read that decides
 * whether re-anchoring stored ink on the heal is the right shape.
 *
 * `UnsettledDocumentTop.test.ts` proves, through the real router and the real
 * `syncCamera`, that a stored stroke is `world.y = (clientY - documentTop) /
 * scale` and nothing else, and that a top which moves after the store leaves
 * the stroke painting elsewhere. It says nothing about WHICH way the top
 * moves, because its rig moves one number by hand. This file moves the real
 * thing, both ways it can move, and asks two questions of each:
 *
 *   (a) at the moment of the store, could the overlay have known the settled
 *       value, and by how much it was off?
 *   (b) does the TEXT move with the top - in which case the stroke is on the
 *       same line afterwards and is not wrong at all - or stay put, in which
 *       case the stroke really is stored wrong?
 *
 * `documentTop` is `contentDOM.getBoundingClientRect().top +
 * viewState.paddingTop` (view/dist/index.js:8036-8037), and the two terms
 * are the two mechanisms. The page half (`settleTopPage.ts`) says what is
 * real and what stands in.
 *
 * The last two describes are the FIX for the one of those two that is a real
 * store error: the overlay takes the padding term from the computed style
 * rather than from the belief (`src/inline/DocumentTop.ts`, called by
 * `syncCamera`). They are here rather than in a file of their own because
 * the belief and the declaration only genuinely differ on a real editor in a
 * real engine, which is the one thing this page has and the unit fakes do
 * not - and because the mechanism R measurement above is the negative
 * control the fix has to leave standing, so the two belong in one run.
 *
 * Run: npm run test:render. Deliberately NOT in `npx vitest run` - see
 * `harness.ts` for why the render suite is a separate script.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import type { TopReading } from "./settleTopPage";

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

/** Minimal's `.cm-editor .cm-content { padding-top: 0.5em }` (fixture :626) at 16px. */
const PADDING = 8;
/** One inch, the number in the owner's report. */
const INCH = 96;
/** Where the pen touches, client px: on the third line of a 600px editor. */
const PEN_Y = 60;

let bundled: string | null = null;
async function pageBundle(): Promise<string> {
	if (bundled) return bundled;
	const out = await build({
		entryPoints: [here("./settleTopPage.ts")],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2022",
		alias: { obsidian: here("../obsidian-stub.ts") },
	});
	const file = out.outputFiles[0];
	if (!file) throw new Error("esbuild produced no output for settleTopPage.ts");
	bundled = file.text;
	return bundled;
}

async function openTopPage(browser: Browser): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
	await page.setContent("<!doctype html><meta charset=utf-8><title>document top settle</title>");
	await page.addScriptTag({ content: await pageBundle() });
	return page;
}

/**
 * Mount and store in ONE evaluate: `mount` reads the editor before any
 * frame has run, and the store has to happen in that same synchronous run
 * or the rAF CodeMirror requested at construction gets in first.
 */
async function mountAndStore(page: Page): Promise<{ early: TopReading; stored: number }> {
	return page.evaluate(
		(a) => {
			const early = window.__hwtop.mount({ paddingTop: a.padding });
			return { early, stored: window.__hwtop.store(a.penY) };
		},
		{ padding: PADDING, penY: PEN_Y }
	);
}

/**
 * The same, storing the SAME pen point both ways in the same synchronous run:
 * once against CodeMirror's reported top, once through the shipped
 * `anchorTop`. One `evaluate` for the same reason as above - the window this
 * is about closes at the next frame - and both stores inside it so neither
 * can be blamed on having been taken a frame apart from the other.
 */
async function mountAndStoreBothWays(
	page: Page
): Promise<{ early: TopReading; raw: number; anchored: number }> {
	return page.evaluate(
		(a) => {
			const early = window.__hwtop.mount({ paddingTop: a.padding });
			return {
				early,
				raw: window.__hwtop.store(a.penY),
				anchored: window.__hwtop.storeAnchored(a.penY),
			};
		},
		{ padding: PADDING, penY: PEN_Y }
	);
}

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch();
});
afterAll(async () => {
	await browser?.close();
});

describe("mechanism P: CodeMirror's padding latch", () => {
	it("moves the top by an amount the overlay could have computed at store time, and moves no text", async () => {
		const page = await openTopPage(browser);
		const { early, stored } = await mountAndStore(page);
		const late = await page.evaluate(() => window.__hwtop.settle());
		const paintsAt = await page.evaluate((y) => window.__hwtop.paint(y), stored);
		await page.close();

		// eslint-disable-next-line no-console
		console.log("P early:", JSON.stringify(early));
		// eslint-disable-next-line no-console
		console.log("P late: ", JSON.stringify(late), "stored", stored, "paints at", paintsAt);

		// THE WINDOW. Synchronously after construction CodeMirror believes the
		// padding is 0 (view/dist/index.js:5929) while the stylesheet already
		// says 8, and `documentTop` is the bare rect top.
		expect(early.believedPadding).toBe(0);
		expect(early.declaredPadding).toBe(PADDING);
		expect(early.documentTop).toBeCloseTo(early.contentTop, 6);

		// THE LATCH. One measure cycle later the belief is the declared value
		// and the top has moved by exactly the difference.
		expect(late.believedPadding).toBe(PADDING);
		expect(late.geometryUpdates).toBeGreaterThan(0);
		expect(late.documentTop - early.documentTop).toBeCloseTo(
			early.declaredPadding - early.believedPadding,
			6
		);

		// (a): KNOWABLE. `declared - believed`, two reads the overlay can make
		// at pen-down (`getComputedStyle(contentDOM)` and the public
		// `view.documentPadding`), predicted the move to the pixel before it
		// happened.

		// (b): THE TEXT DID NOT MOVE. The padding was in force all along; only
		// the number changed. So the stroke stored against the early top now
		// paints PADDING px below the pen, off the line it was drawn on - the
		// one case where the store really is wrong, by exactly the knowable
		// amount.
		expect(late.lineTop).toBeCloseTo(early.lineTop, 6);
		expect(late.contentTop).toBeCloseTo(early.contentTop, 6);
		expect(paintsAt - PEN_Y).toBeCloseTo(PADDING, 6);
	});
});

describe("mechanism R: something above .cm-content grows", () => {
	it("moves the text by the whole delta with the top, so the stored stroke is still on its line", async () => {
		const page = await openTopPage(browser);
		// Settle P first, so this test isolates R.
		await page.evaluate((p) => window.__hwtop.mount({ paddingTop: p }), PADDING);
		const before = await page.evaluate(() => window.__hwtop.settle());
		const stored = await page.evaluate((y) => window.__hwtop.store(y), PEN_Y);
		await page.evaluate((px) => window.__hwtop.growAbove(px), INCH);
		const after = await page.evaluate(() => window.__hwtop.read());
		const paintsAt = await page.evaluate((y) => window.__hwtop.paint(y), stored);
		// The negative control for a re-anchor: what the delta-corrected
		// coordinate would paint at.
		const reanchoredPaintsAt = await page.evaluate(
			(y) => window.__hwtop.paint(y),
			stored - (after.documentTop - before.documentTop)
		);
		const settled = await page.evaluate(() => window.__hwtop.settle());
		await page.close();

		// eslint-disable-next-line no-console
		console.log("R before:", JSON.stringify(before));
		// eslint-disable-next-line no-console
		console.log(
			"R after: ",
			JSON.stringify(after),
			"stored",
			stored,
			"paints at",
			paintsAt,
			"re-anchored would paint at",
			reanchoredPaintsAt
		);

		// The top moved by the inch, read live off the rect, with CodeMirror's
		// belief about its padding untouched: this is the rect term.
		expect(after.documentTop - before.documentTop).toBeCloseTo(INCH, 6);
		expect(after.believedPadding).toBe(before.believedPadding);

		// (b): THE TEXT MOVED WITH IT, by the same inch. The line the pen was
		// over is an inch lower on the glass.
		expect(after.lineTop - before.lineTop).toBeCloseTo(INCH, 6);

		// So the stroke stored against the early top paints an inch lower -
		// the teleport in the report - and that is exactly where its line
		// went. Same offset from the line before and after: NOT stored wrong.
		expect(paintsAt - PEN_Y).toBeCloseTo(INCH, 6);
		expect(paintsAt - after.lineTop).toBeCloseTo(PEN_Y - before.lineTop, 6);

		// THE RE-ANCHOR, HAD IT RUN: subtracting the delta puts the stroke back
		// under where the pen WAS on the glass - which is now an inch above
		// the line it was written on, permanently.
		expect(reanchoredPaintsAt).toBeCloseTo(PEN_Y, 6);
		expect(reanchoredPaintsAt - after.lineTop).toBeCloseTo(PEN_Y - before.lineTop - INCH, 6);

		// (a): NOT KNOWABLE AT STORE TIME, AND NOT NEEDED. Nothing at the store
		// could have said how much a block that had not laid out yet would
		// grow; and two frames later CodeMirror itself has not run a
		// geometry update over it, because nothing resized - the rect is
		// simply read live.
		expect(settled.geometryUpdates).toBe(before.geometryUpdates);
	});
});

describe("the two mechanisms compose, in steps", () => {
	it("leaves strokes stored between steps against different tops, needing different kinds of correction", async () => {
		const page = await openTopPage(browser);
		const { early, stored: s1 } = await mountAndStore(page);
		const latched = await page.evaluate(() => window.__hwtop.settle());
		const s2 = await page.evaluate((y) => window.__hwtop.store(y), PEN_Y);
		await page.evaluate((px) => window.__hwtop.growAbove(px), INCH);
		const grown = await page.evaluate(() => window.__hwtop.read());
		const s3 = await page.evaluate((y) => window.__hwtop.store(y), PEN_Y);
		const paints = await page.evaluate(
			(ys) => ys.map((y) => window.__hwtop.paint(y)),
			[s1, s2, s3]
		);
		await page.close();

		// eslint-disable-next-line no-console
		console.log("steps:", JSON.stringify({ early, latched, grown, s1, s2, s3, paints }));

		// Three strokes at the same pen point, three stored values, because
		// the top was three different numbers when they were stored.
		expect(s1 - s2).toBeCloseTo(PADDING, 6);
		expect(s2 - s3).toBeCloseTo(INCH, 6);

		// And where they paint now: the first is off its line by the padding
		// (mechanism P, stored wrong, knowable), and BOTH of the first two
		// carry the inch (mechanism R, on their line, not wrong). No single
		// delta describes the page, and no per-stroke delta of `documentTop`
		// does either: the part that must be corrected and the part that
		// must not are added together inside that one number.
		const lineOffset = PEN_Y - early.lineTop;
		expect(paints[0]! - grown.lineTop).toBeCloseTo(lineOffset + PADDING, 6);
		expect(paints[1]! - grown.lineTop).toBeCloseTo(lineOffset, 6);
		// The third was stored against the settled top, so it paints under
		// the pen - which, the line having moved out from under that point,
		// is now above the line. Untouched by anything: the control.
		expect(paints[2]!).toBeCloseTo(PEN_Y, 6);
	});
});

// ---- storing against the real padding ------------------------------------
//
// Mechanism P above is the defect: the padding term of `documentTop` is a
// belief that is 0 for one frame, the text is laid out with the declared
// value the whole time, so a stroke stored in that frame is stored `PADDING`
// px off its own line and stays that way. `src/inline/DocumentTop.ts` takes
// the padding from the computed style instead - CodeMirror's own formula,
// `parseInt` and `scaleY` included - and `syncCamera` builds the camera from
// that. These two say what that changes and, just as importantly, what it
// does not.
//
// Both run the SHIPPED function: `settleTopPage.ts` imports `anchorTop` and
// calls it, rather than re-implementing the arithmetic, so a change to the
// module that broke the rule would fail here.

describe("the anchor `anchorTop` builds the camera from", () => {
	it("stores a pre-measure stroke where a post-measure stroke of the same pen point goes", async () => {
		const page = await openTopPage(browser);
		const { early, raw, anchored } = await mountAndStoreBothWays(page);
		const late = await page.evaluate(() => window.__hwtop.settle());
		// The same pen point again, now that the measure cycle has run: the
		// value the store has always got right, and the one the pre-measure
		// store has to match.
		const afterRaw = await page.evaluate((y) => window.__hwtop.store(y), PEN_Y);
		const afterAnchored = await page.evaluate((y) => window.__hwtop.storeAnchored(y), PEN_Y);
		// Where each of the two pre-measure stores paints, now, through its
		// own pipeline.
		const anchoredPaintsAt = await page.evaluate(
			(y) => window.__hwtop.paintAnchored(y),
			anchored
		);
		const rawPaintsAt = await page.evaluate((y) => window.__hwtop.paint(y), raw);
		await page.close();

		// eslint-disable-next-line no-console
		console.log(
			"anchor:",
			JSON.stringify({
				early,
				late,
				raw,
				anchored,
				afterRaw,
				afterAnchored,
				rawPaintsAt,
				anchoredPaintsAt,
			})
		);

		// THE WINDOW IS OPEN. Same precondition as mechanism P, restated here
		// so a green run cannot mean the window simply never happened.
		expect(early.believedPadding).toBe(0);
		expect(early.declaredPadding).toBe(PADDING);

		// ACCEPTANCE. The stroke stored before the measure cycle and the
		// stroke stored after it are the same world y - so the first one
		// lands at the same offset from its `.cm-line` as the second, which
		// is the whole claim.
		expect(anchored).toBeCloseTo(afterAnchored, 6);
		expect(anchoredPaintsAt - late.lineTop).toBeCloseTo(PEN_Y - early.lineTop, 6);
		// ...and in the units the claim is stated in. The page runs at
		// `deviceScaleFactor` 1, so a client px here IS a device px.
		expect(Math.abs(anchoredPaintsAt - PEN_Y)).toBeLessThanOrEqual(1);

		// THE NEGATIVE CONTROL, in the same run and against the same editor:
		// the un-anchored pipeline, which is what `syncCamera` read before
		// this slice, stores the identical pen point `PADDING` px away and
		// paints it that far below the line it was drawn on.
		expect(raw - anchored).toBeCloseTo(PADDING, 6);
		expect(rawPaintsAt - PEN_Y).toBeCloseTo(PADDING, 6);

		// AND NOTHING CHANGES ONCE THE BELIEF IS TRUE. Strictly equal, not
		// close: after the measure cycle `anchorTop` re-derives the number
		// CodeMirror latched with CodeMirror's own expression, so the camera
		// is bit-for-bit the one that shipped and no settled frame moves, and
		// no drift compare fires on arithmetic noise.
		expect(afterAnchored).toBe(afterRaw);
		expect(late.believedPadding).toBe(late.declaredPadding);
	});

	it("does not move ink when a block above the content grows, which is the case that must not move", async () => {
		const page = await openTopPage(browser);
		await page.evaluate((p) => window.__hwtop.mount({ paddingTop: p }), PADDING);
		const before = await page.evaluate(() => window.__hwtop.settle());
		// Stored through the fix, on a settled editor: mechanism R with the
		// change in place.
		const stored = await page.evaluate((y) => window.__hwtop.storeAnchored(y), PEN_Y);
		await page.evaluate((px) => window.__hwtop.growAbove(px), INCH);
		const after = await page.evaluate(() => window.__hwtop.read());
		const anchoredPaintsAt = await page.evaluate(
			(y) => window.__hwtop.paintAnchored(y),
			stored
		);
		const rawPaintsAt = await page.evaluate((y) => window.__hwtop.paint(y), stored);
		await page.close();

		// eslint-disable-next-line no-console
		console.log(
			"anchor R:",
			JSON.stringify({ before, after, stored, anchoredPaintsAt, rawPaintsAt })
		);

		// The rect term moved by the inch and the belief did not change, so
		// this is the same event mechanism R measures.
		expect(after.documentTop - before.documentTop).toBeCloseTo(INCH, 6);
		expect(after.believedPadding).toBe(before.believedPadding);
		expect(after.lineTop - before.lineTop).toBeCloseTo(INCH, 6);

		// THE STROKE IS STILL ON ITS LINE, at the same offset it was drawn
		// at. It paints an inch lower because its line is an inch lower, and
		// that is correct: a fix that subtracted this delta would leave the
		// ink an inch above the words for good.
		expect(anchoredPaintsAt - PEN_Y).toBeCloseTo(INCH, 6);
		expect(anchoredPaintsAt - after.lineTop).toBeCloseTo(PEN_Y - before.lineTop, 6);

		// AND IT IS THE SAME NUMBER THE UNCHANGED PIPELINE PRODUCES. Strict
		// equality: `anchorTop` replaces the padding term only, the rect term
		// passes through it untouched, so on a settled editor the two
		// pipelines cannot differ by anything at all.
		expect(anchoredPaintsAt).toBe(rawPaintsAt);
	});
});
