/** Composite pixels on a mounted SlidesDeck; no native Obsidian/app.css claim. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { launch, stylesCss } from "./harness";
import type {} from "./slidesHighlighterPage";
import type { Pt, RGB } from "./penMarks";
declare const process: { env: Record<string, string | undefined> };

let browser: Browser, bundle: string;
beforeAll(async () => {
	const result = await build({ entryPoints: [fileURLToPath(new URL("./slidesHighlighterPage.ts", import.meta.url))],
		bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
		alias: { obsidian: fileURLToPath(new URL("../obsidian-stub.ts", import.meta.url)) } });
	bundle = result.outputFiles[0]!.text;
	browser = await launch();
});
afterAll(async () => { await browser?.close(); });
const yellow: RGB = [255, 214, 10];
const gap = (a: RGB, b: RGB) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
const blend = (paper: RGB) => paper.map((v, i) => Math.round(v * 0.65 + yellow[i]! * 0.35)) as RGB;

async function open(dark: boolean, dpr = 1) {
	const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: dpr });
	await page.setContent("<!doctype html><html><body style='margin:0'></body></html>");
	await page.addStyleTag({ content: stylesCss() });
	await page.addScriptTag({ content: bundle });
	const scene = await page.evaluate(d => window.slidesHighlighter.open(d), dark);
	await page.waitForFunction(() => window.slidesHighlighter.state().status.mutable);
	return { page, ...scene };
}
async function pixels(page: Page, points: Record<string, Pt>, label: string) {
	const directory = process.env.SLIDES_HIGHLIGHTER_EVIDENCE;
	const png = await page.screenshot({ scale: "css", path: directory ? `${directory}/${label}.png` : undefined });
	const result = await page.evaluate(({ b64, points }) => window.slidesHighlighter.sample(b64, { x: 0, y: 0 }, points, 0),
		{ b64: png.toString("base64"), points });
	console.log(`SLIDES_HIGHLIGHTER ${label} ${JSON.stringify(result)}`);
	return result;
}
function appearance(s: Record<string, RGB>, baseline: Record<string, RGB>, dark: boolean, label: string) {
	const pen: RGB = dark ? [230, 230, 230] : [28, 31, 38];
	const wash = blend(baseline.paper!);
	// Soft assertions keep opacity, pen ordering and content visibility independent.
	expect.soft(gap(s.wash!, baseline.paper!), `${label} wash visible`).toBeGreaterThanOrEqual(64);
	expect.soft(gap(s.wash!, yellow), `${label} wash not opaque`).toBeGreaterThanOrEqual(64);
	expect.soft(gap(s.wash!, wash), `${label} single 0.35 wash`).toBeLessThanOrEqual(12);
	expect.soft(gap(s.crossing!, pen), `${label} pen above highlighter`).toBeLessThanOrEqual(12);
	expect.soft(gap(s.crossWash!, wash), `${label} vertical single wash`).toBeLessThanOrEqual(12);
	expect.soft(gap(s.flatCrossing!, s.wash!), `${label} crossing is one wash`).toBeLessThanOrEqual(12);
	expect.soft(gap(s.head!, wash), `${label} live head has one wash`).toBeLessThanOrEqual(12);
	for (const key of ["text", "image"]) {
		expect.soft(gap(baseline[key]!, baseline.paper!), `${label} underlying ${key} present`).toBeGreaterThanOrEqual(64);
		expect.soft(gap(s[key]!, blend(baseline[key]!)), `${label} ${key} visible through wash`).toBeLessThanOrEqual(12);
	}
}

describe("Slides highlighter even wash", () => {
	for (const dark of [false, true]) for (const penFirst of [false, true]) {
		it(`${dark ? "dark" : "light"} ${penFirst ? "pen-first" : "highlighter-first"}: wet, lift and settled pixels`, async () => {
			const { page, points } = await open(dark);
			const label = `${dark ? "dark" : "light"}-${penFirst ? "pen" : "highlight"}-first`;
			// This crossing lies on the shoulder of the pen, inside both wide swipes.
			const probes = { ...points, flatCrossing: { x: 460, y: 369 } };
			try {
				const baseline = await pixels(page, probes, `${label}-paper`);
				if (penFirst) await page.evaluate(() => window.slidesHighlighter.pen());
				await page.evaluate(() => window.slidesHighlighter.firstWash());
				if (!penFirst) await page.evaluate(() => window.slidesHighlighter.pen());
				await page.evaluate(() => window.slidesHighlighter.secondWash());
				const wetState = await page.evaluate(() => window.slidesHighlighter.state());
				expect(wetState.wet).toBe(true);
				expect(wetState.contactPhase).toBe("drawing");
				expect(wetState.saved!.strokes).toHaveLength(2);
				appearance(await pixels(page, probes, `${label}-wet`), baseline, dark, "wet");
				const lifted = await page.evaluate(() => window.slidesHighlighter.lift());
				expect(lifted.saved!.strokes).toHaveLength(3);
				appearance(await pixels(page, probes, `${label}-lift`), baseline, dark, "first available frame after lift");
				await page.evaluate(() => window.slidesHighlighter.frames(1));
				appearance(await pixels(page, probes, `${label}-next`), baseline, dark, "next frame");
				await page.evaluate(() => window.slidesHighlighter.frames(8));
				appearance(await pixels(page, probes, `${label}-settled`), baseline, dark, "settled");
			} finally { await page.close(); }
		});
	}
	it("erase, undo, resize and remount keep the same stored geometry and pixels", async () => {
		const { page, points } = await open(true, 1.5);
		const probes = { ...points, flatCrossing: { x: 460, y: 369 } };
		try {
			const baseline = await pixels(page, probes, "lifecycle-paper");
			await page.evaluate(async () => { await window.slidesHighlighter.firstWash(); await window.slidesHighlighter.pen(); await window.slidesHighlighter.secondWash(); window.slidesHighlighter.lift(); });
			const before = await page.evaluate(() => window.slidesHighlighter.state());
			const erased = await page.evaluate(() => window.slidesHighlighter.eraseSecond());
			expect(erased.saved!.strokes).toHaveLength(2);
			const s = await pixels(page, probes, "erased");
			expect(gap(s.crossWash!, baseline.paper!)).toBeLessThanOrEqual(12);
			expect(gap(s.flatCrossing!, s.wash!)).toBeLessThanOrEqual(12);
			const undone = await page.evaluate(() => window.slidesHighlighter.undo());
			expect(undone.result).toBe(true);
			expect(undone.saved!.strokes).toEqual(before.saved!.strokes);
			for (const action of ["resize", "repairGroup", "remount"] as const) {
				const state = await page.evaluate(a => window.slidesHighlighter[a](), action);
				expect(state.saved!.strokes).toEqual(before.saved!.strokes);
				expect(state.canvases).toHaveLength(4);
				expect(new Set(state.canvases.map(c => `${c.width}/${c.height}/${c.left}/${c.top}`)).size).toBe(1);
				appearance(await pixels(page, probes, action), baseline, true, action);
			}
		} finally { await page.close(); }
	});
	it("switching from highlight to pen restores full-opacity live pen above the wash", async () => {
		const { page, points } = await open(true);
		try {
			await page.evaluate(async () => { await window.slidesHighlighter.firstWash(); await window.slidesHighlighter.pen(true); });
			const state = await page.evaluate(() => window.slidesHighlighter.state());
			expect(state.contactPhase).toBe("drawing");
			expect(state.saved!.strokes).toHaveLength(1);
			const s = await pixels(page, points, "switched-live-pen");
			expect(gap(s.crossing!, [230, 230, 230])).toBeLessThanOrEqual(12);
			await page.evaluate(() => window.slidesHighlighter.lift());
		} finally { await page.close(); }
	});
});
