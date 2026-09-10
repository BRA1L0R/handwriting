import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser;
let page: Page;

beforeAll(async () => {
	const bundle = await build({
		entryPoints: [fileURLToPath(new URL("./liveInkOriginalColorPage.ts", import.meta.url))],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2022",
	});
	browser = await chromium.launch({ headless: true });
	page = await browser.newPage();
	await page.setContent("<!doctype html><html><body></body></html>");
	await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
});

afterAll(async () => {
	await browser?.close();
});

describe("original live ink in real Chromium canvases", () => {
	it("keeps committed, wet, head and predicted-tail pixels black under a dark host", async () => {
		const colors = await page.evaluate(() =>
			(
				window as unknown as Window & {
					liveInkOriginalColor: { render: () => Record<string, string> };
				}
			).liveInkOriginalColor.render()
		);
		expect(colors).toEqual({
			committed: "rgb(28,31,38)",
			wet: "rgb(28,31,38)",
			head: "rgb(28,31,38)",
			predicted: "rgb(28,31,38)",
		});
	});
});
