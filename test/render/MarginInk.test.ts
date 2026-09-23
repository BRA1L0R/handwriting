import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import css from "../../styles.css?raw";
import obsidianCss from "./obsidianReadableWidth";

let browser: Browser, script: string;
beforeAll(async () => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL("./marginInkPage.ts", import.meta.url))],
		bundle: true, write: false, format: "iife", platform: "browser",
		alias: { obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)) } });
	script = bundle.outputFiles[0]!.text;
	browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });
async function run(method: string, value: boolean, ownLines = false) {
	const page = await browser.newPage({ viewport: { width: 1300, height: 700 } });
	const errors: string[] = [];
	page.on("pageerror", e => errors.push(e.message));
	try {
		await page.addStyleTag({ content: css + obsidianCss + ".markdown-preview-view canvas,.markdown-preview-view svg{max-width:100%;max-height:100%}" });
		await page.addScriptTag({ content: script });
		const result = await page.evaluate(([method, value, ownLines]) => (window as any).marginInk[method](value, ownLines), [method, value, ownLines] as const);
		expect(errors).toEqual([]);
		return result;
	} finally { await page.close(); }
}
it.each([[false, false], [true, false], [false, true], [true, true]])("editor margin ink remains reachable after narrowing, canvas=%s, own-lines=%s", async (canvas, ownLines) => {
	const r = await run("editorMargins", canvas, ownLines);
	expect(r.wide.left).toBeGreaterThanOrEqual(0);
	expect(r.wide.pixels).toBeGreaterThan(50);
	expect(r.narrow.left, JSON.stringify(r)).toBeGreaterThanOrEqual(0);
	expect(r.narrow.margin).toBeGreaterThan(0);
	expect(r.narrow.pixels).toBeGreaterThan(50);
	expect(r.narrow.overflow).toBe("auto");
	expect(r.narrow.strokes).toBe(3);
	for (const zoom of r.zooms) {
		expect(zoom.left, JSON.stringify(zoom)).toBeGreaterThanOrEqual(-.01);
		expect(zoom.pixels, JSON.stringify(zoom)).toBeGreaterThan(10);
	}
	expect(r.right.reach).toBeGreaterThanOrEqual(r.right.inkRight);
	expect(r.restored.margin, JSON.stringify(r)).toBe(0);
	expect(r.restored.pixels, JSON.stringify(r)).toBeGreaterThan(50);
	expect(r.empty.margin).toBe(0);
});
it.each([false, true])("reading mode paints negative coordinates and exposes every margin, negative-only=%s", async onlyNegative => {
	const r = await run("readingMargins", onlyNegative);
	expect(r.wide.pixels).toBeGreaterThan(100);
	expect(r.narrow.pixels).toBe(r.wide.pixels);
	expect(r.narrow.left).toBeGreaterThanOrEqual(0);
	expect(r.narrow.top).toBeGreaterThanOrEqual(0);
	expect(r.narrow.gap).toBe(-186);
	expect(r.narrow.overflow).toBe("auto");
	expect(r.replaced.left).toBe(r.narrow.left);
	expect(r.print.viewBox.startsWith(onlyNegative ? "-186 -86 " : "-186 0 ")).toBe(true);
	expect(r.print.left).toBeGreaterThanOrEqual(0);
	if (!onlyNegative) {
		expect(r.end.right).toBeGreaterThanOrEqual(r.narrow.left + r.narrow.width);
		expect(r.end.bottom).toBeGreaterThanOrEqual(r.narrow.top + r.narrow.height);
	}
	expect(r.erased).toEqual({ canvas: false, translated: false, overflow: "hidden" });
});
