/**
 * The tail layer's three states, measured: what does `clear()` erase?
 *
 * Rebuilt on this tree rather than ported, as ruled. Three states x
 * two zooms x two device pixel ratios, each run on both arms - `clear()` and
 * `clearAll()` as the control - and every pixel of the backing store counted
 * afterwards. Read `tailClearPage.ts`'s header for why the count is written
 * out here instead of calling `countPaintedPixels`.
 *
 * What it establishes, and the limit of it: IF the dirty box is null, the old
 * `clear()` erased NOTHING. It does NOT establish that an ink pen-up can
 * reach that state - a pen-down dissolves the selection for a bare tip, and a
 * lasso gesture ends on its own branch. The fallback added to `clear()` makes
 * the question moot rather than answering it.
 *
 * Not in the gate: under `test/measure/`, which neither `vitest.config.mts`
 * (`src/` + '**' + '/*.test.ts') nor `vitest.render.mts` (`test/render/` +
 * '**' + '/*.test.ts') includes. Run it with
 * `npx vitest run --config test/measure/vitest.measure.mts`.
 */

import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { TailCase, TailResult, TailState } from "./tailClearPage";

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

const STATES: readonly TailState[] = ["head", "head-plus-prediction", "dirty-null"];
const ZOOMS: readonly number[] = [1, 2];
const DPRS: readonly number[] = [1, 2];

let browser: Browser;

beforeAll(async () => {
	browser = await chromium.launch();
}, 600_000);

afterAll(async () => {
	if (browser) await browser.close();
});

async function bundlePage(): Promise<string> {
	const out = await build({
		entryPoints: [here("./tailClearPage.ts")],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2022",
		alias: { obsidian: here("../obsidian-stub.ts") },
	});
	const file = out.outputFiles[0];
	if (!file) throw new Error("esbuild produced no output for tailClearPage.ts");
	return file.text;
}

async function measure(cases: readonly TailCase[]): Promise<TailResult[]> {
	const script = await bundlePage();
	const results: TailResult[] = [];
	for (const dpr of DPRS) {
		const page = await browser.newPage({
			viewport: { width: 900, height: 700 },
			deviceScaleFactor: dpr,
		});
		await page.setContent("<!doctype html><meta charset=utf-8><title>tail clear</title>");
		await page.addScriptTag({ content: script });
		const mine = cases.filter((c) => c.dpr === dpr);
		for (let i = 0; i < mine.length; i += 8) {
			const batch = mine.slice(i, i + 8);
			results.push(...(await page.evaluate((b) => window.__tail.run(b), batch)));
		}
		await page.close();
	}
	return results;
}

const line = (r: TailResult): string => `${r.name} drew ${r.drawn} left ${r.leftover}`;

it("the tail's dirty-rect clear erases the head and the prediction, and needs the fallback for a nulled box", async () => {
	// The OLD behaviour first: `clear()` with no size, which is the early
	// return this class always had. This is the measurement the decision to
	// add a fallback rests on, so it is taken rather than assumed.
	const bare: TailCase[] = [];
	for (const state of STATES) {
		for (const zoom of ZOOMS) {
			for (const dpr of DPRS) {
				bare.push({ state, zoom, dpr, arm: "clear", withSize: false });
			}
		}
	}
	const bareOut = await measure(bare);
	expect(bareOut.length).toBe(12);

	// Every case must have PAINTED something, or it proves nothing.
	expect(bareOut.filter((r) => r.drawn === 0).map(line)).toEqual([]);

	// Head and head-plus-prediction: the dirty rect covers them, so a bare
	// `clear()` is already clean.
	const boxed = bareOut.filter((r) => !r.name.startsWith("dirty-null/"));
	expect(boxed.length).toBe(8);
	expect(boxed.filter((r) => r.leftover > 0).map(line)).toEqual([]);

	// The nulled box: a bare `clear()` is a TOTAL no-op. Not a partial miss -
	// every painted pixel is still there, which is why the numbers below are
	// asserted to equal what was drawn rather than merely to be non-zero.
	const nulled = bareOut.filter((r) => r.name.startsWith("dirty-null/"));
	expect(nulled.length).toBe(4);
	// `leftover === drawn` in every config is the whole finding, and it is a
	// stronger statement than any threshold: nothing was erased at all. The
	// absolute counts are this fixture's own (2e7d91 measured 1027/3170/1191/
	// 3784 on ITS lasso; this file draws its own chrome and is not a port of
	// that one), so they are reported rather than asserted against.
	expect(nulled.filter((r) => r.leftover !== r.drawn).map(line)).toEqual([]);
	expect(nulled.every((r) => r.leftover > 0)).toBe(true);

	// THE CONTROL ARM. `clearAll` has to erase the canvas in all twelve, or a
	// zero above means the readback is blind rather than the clear clean.
	const control: TailCase[] = bare.map((c) => ({ ...c, arm: "clearAll" as const }));
	const controlOut = await measure(control);
	expect(controlOut.length).toBe(12);
	expect(controlOut.filter((r) => r.drawn === 0).map(line)).toEqual([]);
	expect(controlOut.filter((r) => r.leftover > 0).map(line)).toEqual([]);

	// THE FIX: `clear(cssWidth, cssHeight)` - the same no-box fallback
	// `WetInkRenderer.clearStroke` has. All twelve now end empty, the nulled
	// box included.
	const withSize: TailCase[] = bare.map((c) => ({ ...c, withSize: true }));
	const sizedOut = await measure(withSize);
	expect(sizedOut.length).toBe(12);
	expect(sizedOut.filter((r) => r.drawn === 0).map(line)).toEqual([]);
	expect(sizedOut.filter((r) => r.leftover > 0).map(line)).toEqual([]);

	// One assertion carrying the numbers, so a green run REPORTS the proof.
	const nulledLeft = nulled.map((r) => r.leftover).join("/");
	const summary =
		`bare-clear head+prediction clean ${boxed.filter((r) => r.leftover === 0).length}/8 | ` +
		`bare-clear nulled-box left ${nulledLeft} (all of what it drew) | ` +
		`clearAll control clean 12/12 | clear(w,h) clean 12/12`;
	expect(summary).toBe(
		`bare-clear head+prediction clean 8/8 | ` +
			`bare-clear nulled-box left ${nulledLeft} (all of what it drew) | ` +
			`clearAll control clean 12/12 | clear(w,h) clean 12/12`
	);
});
