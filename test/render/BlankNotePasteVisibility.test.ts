/**
 * The user-visible path, not InkClipboard in isolation: copy selected ink from
 * one real mounted ordinary-note overlay, paste into a second mounted overlay
 * whose note and scroll extent are empty, then let the queued paint settle.
 *
 * A successful count is not visibility. These assertions keep four facts
 * separate: the destination store gained the stroke, paste selected it, the
 * first paint expanded the blank note's scroll range, and the viewport moved
 * soon enough for that same paint to contain the stroke.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import type { BlankPasteTrace } from "./blankNotePastePage";

let browser: Browser;
let page: Page;
const pageErrors: string[] = [];

beforeAll(async () => {
	const bundle = await build({
		entryPoints: [fileURLToPath(new URL("./blankNotePastePage.ts", import.meta.url))],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2022",
		alias: {
			obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)),
		},
	});
	browser = await chromium.launch({ headless: true });
	page = await browser.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true });
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.setContent("<!doctype html><html><body></body></html>");
	await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
});

afterAll(async () => browser?.close());

async function run(
	phase: BlankPasteTrace["phase"],
	size: BlankPasteTrace["size"],
	destination: BlankPasteTrace["destination"]
): Promise<BlankPasteTrace> {
	return page.evaluate(
		([p, s, d]) =>
			(window as unknown as Window & {
				blankNotePaste: {
					run(
						value: BlankPasteTrace["phase"],
						size: BlankPasteTrace["size"],
						destination: BlankPasteTrace["destination"]
					): Promise<BlankPasteTrace>;
				};
			}).blankNotePaste.run(p, s, d),
		[phase, size, destination] as const
	);
}

function expectPasted(trace: BlankPasteTrace, before: number, count = 1): void {
	expect(trace.destinationBefore).toBe(before);
	expect(trace.copied).toBe(count);
	expect(trace.pasted).toBe(count);
	expect(trace.storedAfterPaste).toBe(before + count);
	expect(trace.selectedAfterPaste).toBe(count);
	expect(trace.storedAfterLoad).toBe(before + count);
}

describe("selection geometry", () => {
	it("a small selection pastes visibly into an already-loaded empty note", async () => {
		const trace = await run("loaded", "small", "other-note");
		expectPasted(trace, 0);
		expect(trace.loadedBeforePaste).toBe(true);
		expect(trace.storedFirstPoint).toEqual({ x: 90, y: 120 });
		expect(trace.afterPaint.visibleCommitted.alphaPixels).toBeGreaterThan(0);
	});

	it.each([
		["loaded", "wide"],
		["loading", "tall"],
		["loaded", "spanning"],
		["loading", "spanning"],
	] as const)(
		"a %s empty note reveals a %s beyond-screen selection",
		async (phase, size) => {
			const trace = await run(phase, size, "other-note");
			expectPasted(trace, 0);
			expect(trace.destinationBefore).toBe(0);
			expect(trace.loadedBeforePaste).toBe(phase === "loaded");
			// Sideways room only where the ink reaches past the pane's right edge: the tall stroke stays inside the pane's
			// width and extends only downward, so it gets none; the wide and spanning strokes reach x 1400.
			if (size === "tall") expect(trace.afterPaint.scrollWidth).toBe(trace.afterPaint.clientWidth);
			else expect(trace.afterPaint.scrollWidth).toBeGreaterThan(trace.afterPaint.clientWidth);
			expect(trace.afterPaint.scrollHeight).toBeGreaterThan(trace.afterPaint.clientHeight);

			// Control: the stored stroke is drawable. Once a user scrolls manually,
			// that same viewport gains pixels without another paste.
			expect(trace.afterManualScroll.visibleCommitted.alphaPixels).toBeGreaterThan(0);

			// Actual visible intersection only: overscan pixels outside the
			// scroller cannot make this green.
			expect(trace.afterPaint.visibleCommitted.alphaPixels).toBeGreaterThan(0);
		}
	);

	it("reveals actual sparse ink, not the empty top-left of its union bounds", async () => {
		const trace = await run("loaded", "sparse", "other-note");
		expectPasted(trace, 0, 2);
		expect(trace.storedFirstPoint).toEqual({ x: 1200, y: 20 });
		expect(trace.afterManualScroll.visibleCommitted.alphaPixels).toBeGreaterThan(0);
		expect(trace.afterPaint.visibleCommitted.alphaPixels).toBeGreaterThan(0);
	});

	it("reveals an actual L-shaped stroke, not the empty corner of its overlapping bbox", async () => {
		const trace = await run("loaded", "l-shaped", "other-note");
		expectPasted(trace, 0);
		expect(trace.storedFirstPoint).toEqual({ x: 1200, y: 20 });
		// The manual target is the real first point, not bbox.x/y. Seeing pixels
		// there proves the pasted stroke is drawable and the crop is honest.
		expect(trace.afterManualScroll.visibleCommitted.alphaPixels).toBeGreaterThan(0);
		expect(trace.afterPaint.visibleCommitted.alphaPixels).toBeGreaterThan(0);
	});

	it("the same beyond-screen selection is pasted and revealed in its source note", async () => {
		const trace = await run("loaded", "spanning", "same-note");
		expectPasted(trace, 1);
		expect(trace.loadedBeforePaste).toBe(true);
		expect(trace.visibleCommittedBeforePaste.alphaPixels).toBe(0);
		expect(trace.afterPaint.scrollTop).toBeGreaterThan(0);
		expect(trace.afterManualScroll.visibleCommitted.alphaPixels).toBeGreaterThan(0);
		expect(trace.sameNoteWithoutPasteAtManual).not.toBeNull();
		expect(trace.afterManualScroll.visibleCommitted.hash).not.toBe(
			trace.sameNoteWithoutPasteAtManual!.hash
		);
		expect(trace.afterPaint.visibleCommitted.alphaPixels).toBeGreaterThan(0);
	});
});

it("raises no browser errors", () => {
	expect(pageErrors).toEqual([]);
});
