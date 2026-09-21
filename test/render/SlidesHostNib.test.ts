/**
 * The Slides host's `nib()` (main.ts, `startSlidesInk`), executed through its
 * production caller `SlidesDeck.onPointerDown`, across tool, size and pressure.
 *
 * Before this file the nib was executed by nothing: every Slides suite builds
 * `SlidesDeck` with a host whose nib is a literal `{ tool: "pen", ... }`
 * (1.4.20 durability inventory, row 15 and Slides 1a). See `slidesNibPage.ts`
 * for the chain this drives and the boundary it stubs.
 *
 * WHAT THE SETTINGS CONTROL, and so what is asserted:
 *   - the TOOL picks the base nib: a stroke stores `tool`, and its width is
 *     measured against DEFAULT_PEN.baseWidth (2.2) or HIGHLIGHTER_PEN.baseWidth
 *     (16) - the nib's `base.baseWidth`;
 *   - the SIZE multiplies it: stored width = base x `getInkSizeMult(tool)`,
 *     read per stroke at pen-down, so a size changed between strokes lands on
 *     the next one; on screen the painted thickness scales with it;
 *   - the COLOUR is the tool's own selection, `getInkColorHex(tool)`;
 *   - PRESSURE is NOT a nib input. It never changes the stored width; it
 *     changes the painted thickness through the tool's width law - a new pen
 *     stroke takes the exp7 law (StrokeBuilder; EXP7_PEN: 0.18..3.2 of width)
 *     and thickens with it, a highlighter's chisel barely moves
 *     (HIGHLIGHTER_PEN: 0.9..1).
 *
 * Painted thickness is read off the committed canvas's backing (a run of
 * alpha >= 128 through the row's middle column), as ratios between rows drawn
 * identically but for one setting, so shaping, taper and the slide scale
 * cancel. REGIME: Chromium, device scale 3 (so a thin pen is several backing
 * pixels thick), a 960x700 slide at scale 1, dark container, desktop platform,
 * pen PointerEvents at 5px steps a frame apart, sizes x1/x2/x4, pressures
 * 0.5 and 1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import css from "../../styles.css?raw";
import { DEFAULT_PEN, HIGHLIGHTER_PEN } from "../../src/ink/PenStyle";
import type { NibRun } from "./slidesNibPage";

let browser: Browser;
let script: string;

beforeAll(async () => {
	const built = await build({
		entryPoints: [fileURLToPath(new URL("./slidesNibPage.ts", import.meta.url))],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2022",
		alias: { obsidian: fileURLToPath(new URL("../obsidian-stub.ts", import.meta.url)) },
	});
	script = built.outputFiles[0]!.text;
	browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
	await browser?.close();
});

async function open(): Promise<{ page: Page; errors: string[] }> {
	const page = await browser.newPage({ viewport: { width: 1060, height: 820 }, deviceScaleFactor: 3 });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.setContent("<!doctype html><meta charset=utf-8><body style='margin:0;background:#1e1e1e'></body>");
	await page.addStyleTag({ content: "*, *::before, *::after { box-sizing: border-box; }" });
	await page.addStyleTag({ content: css });
	await page.addScriptTag({ content: script });
	return { page, errors };
}

/** The measured rows, one greppable JSON line (`HLPX `). */
const record = (label: string, value: unknown): void => {
	// eslint-disable-next-line no-console
	console.log(`HLPX ${JSON.stringify({ label, value })}`);
};

const BASE = { pen: DEFAULT_PEN.baseWidth, highlighter: HIGHLIGHTER_PEN.baseWidth } as const;
const HEX = { pen: "#e6e6e6", highlighter: "#4cc9f0" } as const;

describe("slides host nib() through SlidesDeck", () => {
	let run: NibRun;
	let errors: string[];

	beforeAll(async () => {
		const opened = await open();
		errors = opened.errors;
		try {
			run = await opened.page.evaluate(() =>
				(window as unknown as { __nib: { nibRun: () => Promise<NibRun> } }).__nib.nibRun()
			);
		} finally {
			await opened.page.close();
		}
		record("slides nib run", run);
	});

	it("reaches the deck: every stroke committed and handed to the store, no page errors", () => {
		expect(errors, "page errors").toEqual([]);
		expect(run.committedFound, "committed slide canvas").toBe(true);
		expect(run.stored).toHaveLength(run.rows.length);
	});

	it("stores the tool, the tool's colour, and base width x the size setting, per stroke", () => {
		run.rows.forEach((row, i) => {
			const s = run.stored[i]!;
			const label = `row ${i} ${row.tool} x${row.mult} p${row.pressure}`;
			expect(s.tool, label).toBe(row.tool);
			expect(s.color, label).toBe(HEX[row.tool]);
			expect(s.width, label).toBeCloseTo(BASE[row.tool] * row.mult, 6);
		});
	});

	it("paints thickness that scales with the size setting, for both tools at both pressures", () => {
		for (const tool of ["pen", "highlighter"] as const) {
			for (const pressure of [0.5, 1]) {
				const at = (mult: number): number =>
					run.rows.find((r) => r.tool === tool && r.mult === mult && r.pressure === pressure)!.paintedCss;
				const label = `${tool} p${pressure}: x1 ${at(1)}px, x2 ${at(2)}px, x4 ${at(4)}px`;
				expect(at(1), label).toBeGreaterThan(0);
				// Doubling the setting doubles the nib; a backing pixel of
				// antialias rounding at each edge is allowed for.
				expect(at(2) / at(1), label).toBeGreaterThanOrEqual(1.6);
				expect(at(2) / at(1), label).toBeLessThanOrEqual(2.4);
				expect(at(4) / at(2), label).toBeGreaterThanOrEqual(1.6);
				expect(at(4) / at(2), label).toBeLessThanOrEqual(2.4);
			}
		}
	});

	it("leaves pressure to the width law: a pen thickens with it, a highlighter barely moves", () => {
		for (const mult of [1, 2, 4]) {
			const at = (tool: "pen" | "highlighter", pressure: number): number =>
				run.rows.find((r) => r.tool === tool && r.mult === mult && r.pressure === pressure)!.paintedCss;
			// exp7 predicts 3.2 / 1.54 = 2.08 for the pen and HIGHLIGHTER_PEN
			// 1.0 / 0.95 = 1.05 for the chisel; the bounds sit between them.
			const pen = at("pen", 1) / at("pen", 0.5);
			const hl = at("highlighter", 1) / at("highlighter", 0.5);
			expect(pen, `pen x${mult}: p1 ${at("pen", 1)}px / p0.5 ${at("pen", 0.5)}px`).toBeGreaterThanOrEqual(1.5);
			expect(hl, `highlighter x${mult}: p1 ${at("highlighter", 1)}px / p0.5 ${at("highlighter", 0.5)}px`).toBeLessThanOrEqual(1.2);
		}
	});
});
