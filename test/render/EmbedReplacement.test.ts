import { afterAll, beforeAll, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import type { Picture } from "./embedReplacementPage";

let browser: Browser;
let page: Page;
const errors: string[] = [];
beforeAll(async () => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL("./embedReplacementPage.ts", import.meta.url))],
		bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
		alias: { obsidian: fileURLToPath(new URL("../obsidian-stub.ts", import.meta.url)) } });
	browser = await chromium.launch({ headless: true });
	page = await browser.newPage();
	page.on("pageerror", error => errors.push(error.message));
	await page.setContent("<!doctype html><html><body></body></html>");
	await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
});
afterAll(async () => { await browser?.close(); });
async function run(kind: string): Promise<Picture[]> {
	return page.evaluate(kind => (window as any).embedReplacement(kind), kind);
}
function painted(picture: Picture, expected: string[]) {
	expect(picture.ok).toBe(true);
	expect(picture.ids).toEqual(expected);
	for (const pixels of picture.pixels) {
		if (expected.length) expect(pixels).toBeGreaterThan(100);
		else expect(pixels).toBe(0);
	}
	expect(picture.hashes[0]).toBe(picture.hashes[1]);
}
it.each(["replace-empty", "replace-pieces"])("%s undo/redo immediately repaints both production embed roots", async kind => {
	const [initial, forward, undone, redone] = await run(kind);
	const finalIds = kind === "replace-empty" ? [] : ["piece"];
	painted(initial!, ["original"]); painted(forward!, finalIds);
	painted(undone!, ["original"]); painted(redone!, finalIds);
	expect(undone!.notifications).toEqual([["original"]]);
	expect(redone!.notifications).toEqual([finalIds]);
	expect(undone!.hashes).toEqual(initial!.hashes);
	expect(redone!.hashes).toEqual(forward!.hashes);
	expect(errors).toEqual([]);
});
it("snap acceptance, undo, redo and two chronological undos refresh both roots", async () => {
	const results = await run("snap");
	const expected = [["original"], ["piece"], ["original"], ["piece"], ["original"], [], []];
	results.forEach((result, i) => painted(result, expected[i]!));
	for (let i = 1; i < 6; i++) expect(results[i]!.notifications).toEqual([expected[i]]);
	expect(results[1]!.hashes).not.toEqual(results[0]!.hashes);
	expect(results[2]!.hashes).toEqual(results[0]!.hashes);
	expect(results[3]!.hashes).toEqual(results[1]!.hashes);
	expect(results[6]!.notifications).toEqual([]);
	expect(errors).toEqual([]);
});
it.each(["add", "remove", "move"])("ordinary %s history still refreshes both roots", async kind => {
	const [initial, forward, undone, redone] = await run(kind);
	painted(undone!, kind === "add" ? [] : ["original"]);
	painted(redone!, kind === "remove" ? [] : ["original"]);
	expect(undone!.notifications).toHaveLength(1);
	expect(redone!.notifications).toHaveLength(1);
	if (kind === "move") {
		expect(forward!.hashes).not.toEqual(initial!.hashes);
		expect(undone!.hashes).toEqual(initial!.hashes);
		expect(redone!.hashes).toEqual(forward!.hashes);
	}
	expect(errors).toEqual([]);
});
