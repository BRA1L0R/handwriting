/**
 * 128 cases: does the wet layer's box clear leave anything behind?
 *
 * The grid is every way `appendPoint` can paint - all four of its branches,
 * four path shapes, both camera zooms the surfaces use, both device pixel
 * ratios, and both pens' width laws. For each: draw the stroke, call
 * `clearStroke`, and count EVERY pixel of the backing store.
 *
 * Read `wetClearPage.ts`'s header first. Two things there are the whole
 * design: the count is exhaustive (the repo's own `countPaintedPixels` is
 * strided and returns a false zero over a one-pixel rim), and every case is
 * paired with a control that MUST leave ink, so a blind readback cannot pass
 * as a clean clear.
 *
 * Not in the gate: this file is under `test/measure/`, which neither
 * `vitest.config.mts` (`src/` + '**' + '/*.test.ts') nor `vitest.render.mts`
 * (`test/render/` + '**' + '/*.test.ts') includes. Run it with
 * `npx vitest run --config test/measure/vitest.measure.mts`.
 */

import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Branch, Shape, Tool, WetCase, WetResult } from "./wetClearPage";

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

const BRANCHES: readonly Branch[] = ["unsmoothed", "raw", "smoothed", "shaped"];
const SHAPES: readonly Shape[] = ["straight", "arc", "loop", "zigzag"];
const TOOLS: readonly Tool[] = ["pen", "highlighter"];
const ZOOMS: readonly number[] = [1, 2];
const DPRS: readonly number[] = [1, 2];

function grid(): WetCase[] {
	const out: WetCase[] = [];
	for (const branch of BRANCHES) {
		for (const shape of SHAPES) {
			for (const zoom of ZOOMS) {
				for (const dpr of DPRS) {
					for (const tool of TOOLS) out.push({ branch, shape, zoom, dpr, tool });
				}
			}
		}
	}
	return out;
}

let browser: Browser;

beforeAll(async () => {
	browser = await chromium.launch();
}, 600_000);

afterAll(async () => {
	if (browser) await browser.close();
});

async function bundlePage(): Promise<string> {
	const out = await build({
		entryPoints: [here("./wetClearPage.ts")],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2022",
		alias: { obsidian: here("../obsidian-stub.ts") },
	});
	const file = out.outputFiles[0];
	if (!file) throw new Error("esbuild produced no output for wetClearPage.ts");
	return file.text;
}

it("clearStroke leaves nothing, on all 128 wet geometries", async () => {
	const cases = grid();
	expect(cases.length).toBe(128);
	const script = await bundlePage();
	const results: WetResult[] = [];
	// dpr is a page-level setting, so one page per dpr; the cases are run in
	// small batches so 256 canvases are not alive at once.
	for (const dpr of DPRS) {
		const page = await browser.newPage({
			viewport: { width: 900, height: 700 },
			deviceScaleFactor: dpr,
		});
		await page.setContent("<!doctype html><meta charset=utf-8><title>wet clear</title>");
		await page.addScriptTag({ content: script });
		const mine = cases.filter((c) => c.dpr === dpr);
		for (let i = 0; i < mine.length; i += 8) {
			const batch = mine.slice(i, i + 8);
			results.push(...(await page.evaluate((b) => window.__wet.run(b), batch)));
		}
		await page.close();
	}

	expect(results.length).toBe(128);

	// A case whose LABEL and whose actual branch disagree measures something
	// other than what it says it does, so it is a failure, not a footnote.
	const mislabelled = results
		.filter((r) => !r.name.startsWith(`${r.branchTaken}/`))
		.map((r) => `${r.name} took ${r.branchTaken}`);

	const painted = results.filter((r) => r.drawn === 0).map((r) => `${r.name} painted nothing`);
	const dirty = results.filter((r) => r.leftover > 0).map((r) => `${r.name} left ${r.leftover}px`);
	const blind = results
		.filter((r) => r.control === 0 || r.controlDegenerate)
		.map((r) => `${r.name} control ${r.control}${r.controlDegenerate ? " (degenerate)" : ""}`);
	// How many cases had a box too thin to inset on both axes. Not a failure -
	// a one-axis inset still leaves a one-CSS-px rim - but it is part of what
	// the control proved and so is stated rather than hidden.
	const oneAxis = results.filter((r) => r.insetAxes.length === 1).length;

	const controls = results.map((r) => r.control).filter((n) => n > 0);
	const lo = controls.length ? Math.min(...controls) : 0;
	const hi = controls.length ? Math.max(...controls) : 0;
	const drawnLo = Math.min(...results.map((r) => r.drawn));
	const drawnHi = Math.max(...results.map((r) => r.drawn));

	// One assertion carrying every number, so a green run REPORTS the proof
	// and a red one prints exactly which cases and by how much.
	const summary = [
		`cases 128`,
		`clean ${128 - dirty.length}`,
		`controls-nonzero ${128 - blind.length}`,
		`blind ${blind.length}`,
		`mislabelled ${mislabelled.length}`,
		`one-axis-inset ${oneAxis}`,
		`drawn ${drawnLo}..${drawnHi}px`,
		`control ${lo}..${hi}px`,
		...painted.slice(0, 8),
		...dirty.slice(0, 8),
		...blind.slice(0, 8),
		...mislabelled.slice(0, 8),
	].join(" | ");

	expect(summary).toBe(
		`cases 128 | clean 128 | controls-nonzero 128 | blind 0 | mislabelled 0 | ` +
			`one-axis-inset ${oneAxis} | drawn ${drawnLo}..${drawnHi}px | control ${lo}..${hi}px`
	);
});
