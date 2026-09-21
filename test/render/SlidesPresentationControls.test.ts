/** Real deck, toolbar, canvas and trusted browser input; Obsidian shell/storage are fixtures. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { launch, stylesCss } from "./harness";
import type {} from "./slidesPresentationPage";
import type { InkStroke } from "../../src/ink/Stroke";

let browser: Browser, bundle: string;
beforeAll(async () => {
	const result = await build({ entryPoints: [fileURLToPath(new URL("./slidesPresentationPage.ts", import.meta.url))],
		bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
		alias: { obsidian: fileURLToPath(new URL("../obsidian-stub.ts", import.meta.url)) } });
	bundle = result.outputFiles[0]!.text;
	browser = await launch();
});
afterAll(async () => { await browser?.close(); });

async function open(nestedExit = false, unmatched = false): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, hasTouch: true });
	await page.setContent("<!doctype html><html><body></body></html>");
	await page.addStyleTag({ content: stylesCss() });
	await page.addStyleTag({ content: `body { margin:0; --text-normal:#111; --text-muted:#444; --background-primary:white; --background-secondary:#eee; }
.slides-container { position:absolute; inset:0; } .reveal { position:absolute; left:0; top:0; width:960px; height:700px; }
.slides { position:absolute; width:960px; height:700px; } section { width:960px; height:700px; display:none; } section.present { display:block; }
.slides-close-btn { position:absolute; left:840px; top:620px; width:120px; height:45px; background:#ddd; touch-action:none; z-index:100; }
.presentation-test-modal { position:fixed; left:280px; top:160px; width:440px; padding:20px; background:white; border:1px solid black; z-index:1000; }
#exit-icon { display:block; width:100%; height:100%; }` });
	await page.addScriptTag({ content: bundle });
	await page.evaluate(({ nestedExit, unmatched }) => { window.presentation = window.openPresentation(nestedExit, unmatched); }, { nestedExit, unmatched });
	await page.waitForFunction(() => window.presentation.status().mutable);
	return page;
}

const button = (page: Page, label: string) => page.locator(`button[aria-label="${label}"],button[data-tip-label="${label}"]`);
// Bucket insertion order can change after clear/undo; drawing order within a slide cannot.
const bySlide = (strokes: InkStroke[]) => [...strokes].sort((a, b) => (a.page ?? 0) - (b.page ?? 0));

async function penDraw(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 300, y: 300, button: "left", buttons: 1, pointerType: "pen", force: 0.7, clickCount: 1 });
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 345, y: 320, button: "left", buttons: 1, pointerType: "pen", force: 0.7 });
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 345, y: 320, button: "left", buttons: 0, pointerType: "pen", clickCount: 1 });
	await cdp.detach();
	await page.waitForFunction(() => window.presentation.status().currentCount === 2);
}

describe("mounted presentation controls", () => {
	for (const nested of [true, false]) for (const pointerType of ["pen", "mouse", "touch"] as const) it(`${pointerType} long moving contact activates ${nested ? "nested" : "sibling"} host exit without ink or pointer capture`, async () => {
		const page = await open(nested);
		try {
			await page.evaluate(() => { window.presentation.holdUndo(); window.presentation.resetInput(); });
			const cdp = await page.context().newCDPSession(page);
			if (pointerType === "touch") {
				await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 870, y: 640 }] });
				await page.waitForTimeout(300);
				await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 880, y: 643 }] });
				await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
			} else {
				await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 870, y: 640, button: "left", buttons: 1, pointerType, clickCount: 1 });
				await page.waitForTimeout(300);
				await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 880, y: 643, button: "left", buttons: 1, pointerType });
				await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 880, y: 643, button: "left", buttons: 0, pointerType, clickCount: 1 });
			}
			await cdp.detach();
			const result = await page.evaluate(() => window.presentation.probe());
			expect(result.closed, JSON.stringify({ pointers: result.pointers, captures: result.captures, status: result.status })).toBe(1);
			expect(result.pointers.map(p => [p.type, p.pointerType, p.prevented, p.trusted, p.target])).toEqual([
				["pointerdown", pointerType, false, true, "exit-icon"], ["pointerup", pointerType, false, true, "exit-icon"],
			]);
			expect(result.captures).toBe(0);
			expect(result.saved.strokes.map(s => s.id)).toEqual(["saved-first", "saved-second"]);
			expect(result.countAtExit).toBe(2);
			expect(result.toolbarCount).toBe(0);
			expect(await page.evaluate(() => window.presentation.invokeStale())).toBe(false);
			expect((await page.evaluate(() => window.presentation.probe())).saved).toEqual(result.saved);
		} finally { await page.close(); }
	});

	it("the mounted toolbar clears and undoes presentation ink in order without touching the note", async () => {
		const page = await open();
		try {
			const initial = await page.evaluate(() => window.presentation.probe());
			const labels = await page.locator(".handwriting-slides-tools button").evaluateAll(nodes => nodes.map(el => el.getAttribute("aria-label") ?? (el as HTMLElement).dataset.tipLabel ?? ""));
			expect(labels.some(label => /lasso|insert space|paste|copy|cut|ocr/i.test(label))).toBe(false);
			await page.evaluate(() => window.presentation.setMode("auto"));
			expect(await page.locator(".handwriting-slides-tools").count()).toBe(0);
			await penDraw(page);
			await page.waitForFunction(() => window.presentation.probe().toolbarCount === 1);
			const drawn = await page.evaluate(() => window.presentation.probe());
			await page.evaluate(() => window.presentation.setMode("hide"));
			expect(await page.locator(".handwriting-slides-tools").count()).toBe(0);
			expect((await page.evaluate(() => window.presentation.status())).undoLabel).toBe(drawn.status.undoLabel);
			await page.evaluate(() => window.presentation.setMode("show"));
			expect(await page.locator(".handwriting-slides-tools").count()).toBe(1);
			expect((await page.evaluate(() => window.presentation.status())).undoLabel).toBe(drawn.status.undoLabel);
			expect(await button(page, "Clear ink on this slide").evaluate(el => getComputedStyle(el).pointerEvents)).toBe("auto");
			await button(page, "Clear ink on this slide").click();
			expect((await page.evaluate(() => window.presentation.status())).currentCount).toBe(0);
			await button(page, "Undo").click();
			expect(bySlide((await page.evaluate(() => window.presentation.probe())).saved.strokes)).toEqual(bySlide(drawn.saved.strokes));
			await button(page, "Undo").click();
			const undone = await page.evaluate(() => window.presentation.probe());
			expect(bySlide(undone.saved.strokes)).toEqual(bySlide(initial.saved.strokes));
			expect(undone.note).toEqual(initial.note);
			expect(undone.commands).toEqual([]);
			expect(undone.writes.every(id => id === "fixture.slides")).toBe(true);
			await page.evaluate(() => window.presentation.navigate(1));
			await page.waitForFunction(() => window.presentation.status().index === 1);
			await button(page, "Clear ink on this slide").click();
			expect((await page.evaluate(() => window.presentation.probe())).saved.strokes.map(s => s.id)).toEqual(["saved-first"]);
			await button(page, "Undo").click();
			expect(bySlide((await page.evaluate(() => window.presentation.probe())).saved.strokes)).toEqual(bySlide(initial.saved.strokes));
			await penDraw(page);
			// MobileTools refreshes its enabled state on the next animation frame.
			await expect.poll(() => button(page, "Undo").getAttribute("aria-disabled")).toBe("false");
			expect(await page.evaluate(() => window.presentation.holdUndo())).toBe(true);
			await page.locator("#exit-icon").click();
			await page.waitForFunction(() => window.presentation.probe().closed === 1);
			const closed = await page.evaluate(() => window.presentation.probe());
			expect(closed.saved.strokes).toHaveLength(3);
			expect(closed.toolbarCount).toBe(0);
			expect(await page.evaluate(() => window.presentation.invokeStale())).toBe(false);
			const afterStale = await page.evaluate(() => window.presentation.probe());
			expect(afterStale.saved).toEqual(closed.saved);
			expect(afterStale.writes).toEqual(closed.writes);
			expect(afterStale.note).toEqual(initial.note);
		} finally { await page.close(); }
	});

	it("Clear all confirms its stored scope, has one undo, and rejects stale confirmations", async () => {
		const page = await open(false, true);
		try {
			const initial = await page.evaluate(() => window.presentation.probe());
			expect(initial.status.totalCount).toBe(3);
			await button(page, "Clear all presentation ink").click();
			const modal = page.locator(".presentation-test-modal");
			expect(await modal.textContent()).toContain("Remove 3 strokes from every slide, including retained ink on unmatched slides");
			await modal.getByRole("button", { name: "Clear all presentation ink", exact: true }).click();
			expect((await page.evaluate(() => window.presentation.status())).totalCount).toBe(0);
			expect((await page.evaluate(() => window.presentation.probe())).saved.strokes).toEqual([]);
			await button(page, "Undo").click();
			let restored = await page.evaluate(() => window.presentation.probe());
			expect(bySlide(restored.saved.strokes)).toEqual(bySlide(initial.saved.strokes));
			expect(restored.status.undoLabel).toBeNull();
			expect(restored.note).toEqual(initial.note);

			await button(page, "Clear all presentation ink").click();
			await page.evaluate(() => window.presentation.navigate(1));
			await page.waitForFunction(() => window.presentation.status().index === 1);
			await modal.getByRole("button", { name: "Clear all presentation ink", exact: true }).click();
			restored = await page.evaluate(() => window.presentation.probe());
			expect(bySlide(restored.saved.strokes)).toEqual(bySlide(initial.saved.strokes));

			await button(page, "Clear all presentation ink").click();
			await page.locator("#exit-icon").click();
			await modal.getByRole("button", { name: "Clear all presentation ink", exact: true }).click();
			const retired = await page.evaluate(() => window.presentation.probe());
			expect(retired.closed).toBe(1);
			expect(bySlide(retired.saved.strokes)).toEqual(bySlide(initial.saved.strokes));
			expect(retired.note).toEqual(initial.note);
		} finally { await page.close(); }
	});
});
