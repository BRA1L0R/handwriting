import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openPaperPicker, type Browser, type BrowserEngine } from "./harness";

// Real NotePaper picker and menu binding, simulated host Modal shell.
// The former SuggestModal search was replaced by five pattern buttons.
describe.each(["chromium", "webkit"] satisfies BrowserEngine[])("paper picker header in %s", engine => {
	let browser: Browser;
	beforeAll(async () => { browser = await launch(engine); });
	afterAll(async () => { await browser?.close(); });
	it("keeps the title and bound note visible during keyboard navigation", async () => {
		const page = await openPaperPicker(browser, 600, "lines", "none");
		try {
			const title = page.locator(".handwriting-paper-picker .modal-title");
			const note = page.locator(".handwriting-paper-picker-note");
			expect(await title.isVisible()).toBe(true);
			expect(await title.textContent()).toBe("Paper background");
			expect(await note.textContent()).toBe("Notes/Sketch.md");
			expect(await page.locator("input").count()).toBe(0);
			expect(await page.locator(".handwriting-paper-tile").count()).toBe(5);
			expect(await page.locator('[aria-pressed="true"]').getAttribute("data-choice")).toBe("lines");
			await page.keyboard.press("ArrowRight");
			expect(await page.locator(":focus").getAttribute("data-choice")).toBe("grid");
			expect(await title.isVisible()).toBe(true);
			expect(await note.isVisible()).toBe(true);
			expect(await note.textContent()).toBe("Notes/Sketch.md");
			expect((await page.evaluate(() => window.__paperPicker.read())).writes).toBe(0);
		} finally { await page.close(); }
	});
});
