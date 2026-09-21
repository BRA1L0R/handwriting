/**
 * COST GATE: on the zoom host every preview frame repaints the zoomed
 * scroller background anyway, so report main-thread paint + raster (any
 * renderer thread) cost over a 1.0 -> 0.1 preview sweep, held (no commit), with paper
 * off / lines / grid, same gesture, alone on the machine. Threshold: paper
 * grid (the two-gradient worst case) <= 1.25x paper off. NOT asserted here
 * for grid/lines (a threshold pinned before the number exists cannot fail
 * honestly): the ratios are read from the JSON this cell writes. Two things
 * ARE asserted, because they are not the unknown the cell exists to measure:
 * the POSITIVE CONTROL arm (32 stacked gradient layers) must read > 1.25x
 * paper-off, and a second "off" measured again at the end must agree with
 * the first within 10% - either failing marks the record VOID (an instrument
 * that cannot show a known-costly case as costly, or whose baseline drifts
 * across its own run, proves nothing about grid/lines).
 *
 * WHAT IS MEASURED, and why not the obvious reader: the harness's
 * `round.scroll.paintMs` from scrollColumnAnchorPage.ts's `run(..., "lag",
 * ...)` times the OVERLAY's own JS `repaint()` (redrawing its ink canvases:
 * scrollColumnAnchorPage.ts :1358-1375, :1461), not Blink's paint/raster of
 * the CSS scroller gradient, and that gesture is a COMMITTED scroll-then-draw,
 * never a preview frame. This cell measures a real HELD PREVIEW (a pinch that
 * is never lifted, so it never commits) via noteViewportCameraPage.ts, and
 * reads Blink's own trace instead of any JS-side counter:
 * - RasterTask runs on a ThreadPool worker, not CrRendererMain, and DrawFrame
 *   is an instant Compositor-thread event with no `dur`. Raster is counted on
 *   any thread of the renderer process that owns CrRendererMain; the
 *   per-arm TOTAL is main-thread Paint + that process's RasterTask summed from the first mark through `stopTracing` (not
 *   per-frame bucketed: raster runs asynchronously on a worker and lags the
 *   frame that requested it, so it cannot be reliably attributed to one
 *   preview step); DrawFrame is counted, never summed as ms.
 * - Each step's own paint/layout completes strictly BEFORE that step's own
 *   mark is recorded (the mark is a separate CDP round-trip issued AFTER
 *   `settleFrame()` resolved), so per-frame costs are charged to the FIRST
 *   mark at or after an event's timestamp; events after the last mark are
 *   dropped.
 * - Paint and RasterTask are duration ("X" phase) events; DrawFrame is
 *   instant ("I" phase, no `dur`), so it contributes to a count only.
 * - A second "off" arm ("off-b") runs last; the record is VOID if it
 *   disagrees with the first "off" by more than 10%, so drift in the trace
 *   plumbing across the run cannot pass as a ratio.
 * - The gesture sweeps the whole 1.0 -> 0.1 range, not a steady state at
 *   10%: only the last few of 30 steps are near the floor.
 *
 * A timing run: gated behind HW_PAPER_COST so the ordinary suite never runs
 * it, and run only while nothing else loads the machine.
 *
 * TRACE PLUMBING: `browser.startTracing`/`stopTracing`
 * with categories devtools.timeline, disabled-by-default-devtools.timeline,
 * disabled-by-default-devtools.timeline.stack, disabled-by-default-devtools.
 * timeline.frame, blink.user_timing, blink; the main render thread is found
 * by its "thread_name" metadata event (`args.name === "CrRendererMain"`),
 * never assumed to be a fixed pid/tid; frames are bucketed by an IN-PAGE
 * `performance.mark(...)` per preview step - recorded in the SAME trace, on
 * the SAME clock as every other event.
 */

import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import css from "../../styles.css?raw";

declare const process: { env: Record<string, string | undefined> };
let browser: Browser, viewportScript: string;

beforeAll(async () => {
	const bv = await build({
		entryPoints: [fileURLToPath(new URL("./noteViewportCameraPage.ts", import.meta.url))],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		alias: { obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)) },
	});
	viewportScript = bv.outputFiles[0]!.text;
	browser = await chromium.launch({ headless: true });
}, 180_000);

afterAll(async () => {
	await browser?.close();
});

const gated = process.env.HW_PAPER_COST === "1" ? it : it.skip;

const TRACE_CATEGORIES = (process.env.HW_LAG_TRACE_CATS ??
	"devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.frame,blink.user_timing,blink"
).split(",");

type TraceEvent = { name: string; ts: number; dur?: number; cat?: string; ph?: string; pid?: number; tid?: number; args?: any };

// `any`, not `Buffer`: this project's tsconfig has no Node type globals in
// scope (the same reason other render test files avoid a `Buffer` annotation
// even though `readFileSync`/`writeFileSync` return/accept one at runtime).
function parseTrace(buffer: any): TraceEvent[] {
	try {
		const d = JSON.parse(buffer.toString("utf8"));
		return Array.isArray(d) ? d : (d.traceEvents ?? []);
	} catch {
		return [];
	}
}

/** The main renderer thread is identified by a "thread_name" metadata event
 * (ph "M"), never assumed to be a fixed pid/tid. */
function mainThreadKeys(events: TraceEvent[]): Set<string> {
	const keys = new Set<string>();
	for (const e of events) if (e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain") keys.add(`${e.pid}:${e.tid}`);
	return keys;
}

/** Marks named `${prefix}${i}` recorded via in-page `performance.mark`, found
 * in the SAME trace under blink.user_timing - the exact clock every other
 * event in the trace uses, so no Node-side clock-sync approximation. */
function marksByPrefix(events: TraceEvent[], prefix: string): { i: number; ts: number }[] {
	return events
		.filter(e => typeof e.name === "string" && e.name.startsWith(prefix) && String(e.cat ?? "").includes("blink.user_timing"))
		.map(e => ({ i: Number(e.name.slice(prefix.length)), ts: e.ts }))
		.sort((a, b) => a.ts - b.ts);
}

/**
 * Sum `dur` (converted ms) for events `include()` accepts, bucketed into the
 * frame whose in-page mark is the FIRST one at or after the event's own
 * timestamp: a step's dispatch -> settleFrame -> mark(i)
 * sequence means step i's own paint/layout always completes strictly BEFORE
 * mark(i)'s own timestamp (mark(i) is a separate CDP round-trip issued after
 * settleFrame already resolved) - so "last mark at or before the event"
 * (the previous, wrong direction) put a step's cost in the PRECEDING step's
 * bucket every time. Events after the last mark are dropped (no later frame
 * exists to charge them to). Paint/RasterTask carry
 * `dur` (duration "X" events); an event with none (e.g. DrawFrame, an
 * instant "I" event) still counts toward `counts` but contributes 0 ms - by
 * design, not an undercount, since DrawFrame is never used as a duration
 * source here.
 */
function bucketByMarks(events: TraceEvent[], marks: { i: number; ts: number }[], include: (e: TraceEvent) => boolean): Map<number, { ms: number; counts: Record<string, number> }> {
	const buckets = new Map<number, { ms: number; counts: Record<string, number> }>();
	for (const m of marks) buckets.set(m.i, { ms: 0, counts: {} });
	for (const e of events) {
		if (!include(e)) continue;
		let frame: number | null = null;
		for (const m of marks) { if (m.ts >= e.ts) { frame = m.i; break; } }
		if (frame === null) continue;
		const b = buckets.get(frame)!;
		b.ms += (e.dur ?? 0) / 1000;
		b.counts[e.name] = (b.counts[e.name] ?? 0) + 1;
	}
	return buckets;
}

/**
 * A held two-finger PREVIEW pinch - pointerdown, N pointermove steps each
 * settled to one animation frame and marked, and NO pointerup, ever, so this
 * arm never commits. Spread 100 -> 10px about (300,250): the same calibration
 * PaperLowZoom.test.ts's dots control cell uses (from a fresh zoom-1.0 rig,
 * ViewportEdgeAudit.test.ts:55, R) to reach the 10% floor - a 1.0 -> 0.1
 * SWEEP across the 30 steps, not a steady state at 10%.
 */
async function previewArm(paperClass: string | null, extraCss = "") {
	const page = await browser.newPage({ viewport: { width: 700, height: 540 }, deviceScaleFactor: 2 });
	try {
		await page.setContent(`<!doctype html><body class="${paperClass ?? ""}" style="--background-modifier-border:#777; background:white"></body>`);
		await page.addStyleTag({ content: css + readFileSync(fileURLToPath(new URL("./noteViewportCamera.css", import.meta.url)), "utf8") });
		if (extraCss) await page.addStyleTag({ content: extraCss });
		await page.addScriptTag({ content: viewportScript });
		await page.evaluate(() => (window as any).viewportFixture.setup("preview-cost"));

		const dispatch = (type: string, id: number, x: number, y: number, isPrimary: boolean) =>
			page.evaluate(a => {
				const target = document.elementFromPoint(a.x, a.y);
				target?.dispatchEvent(new PointerEvent(a.type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: a.id, isPrimary: a.isPrimary, clientX: a.x, clientY: a.y, buttons: 1, width: 8, height: 8 }));
			}, { type, id, x, y, isPrimary });
		const settleFrame = () => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => r())));
		const mark = (name: string) => page.evaluate(n => { performance.mark(n); }, name);

		await browser.startTracing(page, { categories: TRACE_CATEGORIES });

		const STEPS = 30;
		await dispatch("pointerdown", 701, 250, 250, true);
		await dispatch("pointerdown", 702, 350, 250, false);
		for (let i = 0; i < STEPS; i++) {
			const spread = 100 - (90 * (i + 1)) / STEPS;
			await dispatch("pointermove", 701, 300 - spread / 2, 250, true);
			await dispatch("pointermove", 702, 300 + spread / 2, 250, false);
			await settleFrame();
			await mark(`hw-paper-frame-${i}`);
		}
		// NEVER pointerup: the preview is torn down with the page, not
		// committed. `finally` below closes the page regardless.

		const traceBuffer = await browser.stopTracing();
		const events = parseTrace(traceBuffer);
		const mainKeys = mainThreadKeys(events);
		// The renderer process that owns CrRendererMain: its raster workers raster
		// this page, and no other process's raster may enter the total.
		const rendererPids = new Set([...mainKeys].map(k => k.split(":")[0]!));
		const marks = marksByPrefix(events, "hw-paper-frame-");

		// SELF-TEST: Paint dur>0 on the main
		// thread, AND RasterTask dur>0 on any thread of the renderer process (RasterTask runs on a
		// ThreadPool worker, never CrRendererMain - restricting it to main
		// made this always false).
		const paintNonZero = events.some(e => e.name === "Paint" && mainKeys.has(`${e.pid}:${e.tid}`) && (e.dur ?? 0) > 0);
		const rasterNonZero = events.some(e => e.name === "RasterTask" && rendererPids.has(String(e.pid)) && (e.dur ?? 0) > 0);

		// PER-ARM TOTAL: main-thread Paint + the renderer process's RasterTask,
		// summed from the first mark through stopTracing - not per-frame
		// bucketed, because raster lags the preview step that requested it and
		// cannot be reliably charged to one frame. This total is what the
		// ratios are computed from. DrawFrame is counted only (it has no `dur`).
		const firstMarkTs = marks.length ? marks[0]!.ts : -Infinity;
		let mainPaintMs = 0, rasterMs = 0, drawFrameCount = 0;
		for (const e of events) {
			if (e.ts < firstMarkTs) continue;
			if (e.name === "Paint" && mainKeys.has(`${e.pid}:${e.tid}`)) mainPaintMs += (e.dur ?? 0) / 1000;
			else if (e.name === "RasterTask" && rendererPids.has(String(e.pid))) rasterMs += (e.dur ?? 0) / 1000;
			else if (e.name === "DrawFrame") drawFrameCount++;
		}
		const totalMs = mainPaintMs + rasterMs;

		// Per-frame Paint bucket kept for diagnostics (main thread only - Paint
		// follows its own frame closely, unlike raster). NOT the number the
		// ratio is computed from.
		const paintBuckets = bucketByMarks(events, marks, e => e.name === "Paint" && mainKeys.has(`${e.pid}:${e.tid}`));
		const frames = marks.map(m => ({ i: m.i, paintMs: paintBuckets.get(m.i)!.ms }));

		return { framesCaptured: marks.length, mainThreadFound: mainKeys.size > 0, paintNonZero, rasterNonZero, mainPaintMs, rasterMs, drawFrameCount, totalMs, frames };
	} finally {
		await page.close();
	}
}

/** 32 stacked repeating-gradient layers on the scroller - the POSITIVE
 * CONTROL: a case known to cost far more paint/raster than plain paper,
 * regardless of whether grid/lines themselves turn out cheap or expensive. */
const CONTROL_CSS = `.cm-scroller { background-image: ${Array.from({ length: 32 }, (_, i) =>
	`repeating-linear-gradient(${i * 11}deg, rgba(0,0,0,0.02) 0, rgba(0,0,0,0.02) 1px, transparent 1px, transparent 6px)`).join(", ")}; }`;

gated("cost gate: paper off/lines/grid at a 1.0 -> 0.1 preview sweep held with no commit, main-thread paint + any-thread raster ms, positive control", async () => {
	const off = await previewArm(null);
	const lines = await previewArm("handwriting-paper-lines");
	const grid = await previewArm("handwriting-paper-grid");
	const control = await previewArm(null, CONTROL_CSS);
	// A second "off" measured last, to prove the trace plumbing itself
	// did not drift across the run of arms above.
	const offB = await previewArm(null);

	// SELF-TEST BEFORE ANY NUMBER IS BELIEVED (an instrument
	// that cannot fail is worse than no instrument): every arm must show the
	// main render thread found, at least one nonzero main-thread Paint and at
	// least one nonzero renderer-process RasterTask, and >= 20 marked preview frames.
	for (const [label, r] of [["off", off], ["lines", lines], ["grid", grid], ["control", control], ["off-b", offB]] as const) {
		expect(r.mainThreadFound, `${label}: CrRendererMain thread found in the trace`).toBe(true);
		expect(r.paintNonZero, `${label}: at least one nonzero main-thread Paint event`).toBe(true);
		expect(r.rasterNonZero, `${label}: at least one nonzero renderer-process RasterTask event`).toBe(true);
		expect(r.framesCaptured, `${label}: at least 20 marked preview frames captured`).toBeGreaterThanOrEqual(20);
	}

	const ratioGridOverOff = off.totalMs > 0 ? grid.totalMs / off.totalMs : null;
	const ratioLinesOverOff = off.totalMs > 0 ? lines.totalMs / off.totalMs : null;
	const ratioControlOverOff = off.totalMs > 0 ? control.totalMs / off.totalMs : null;
	const drift = off.totalMs > 0 ? Math.abs(offB.totalMs - off.totalMs) / off.totalMs : null;

	const record = {
		at: new Date().toISOString(),
		gesture: "held two-finger pinch, 1.0 -> 0.1 preview sweep (spread 100->10px), NEVER lifted (no commit), 30 steps, one performance.mark per settled frame",
		off: { framesCaptured: off.framesCaptured, totalMs: off.totalMs, mainPaintMs: off.mainPaintMs, rasterMs: off.rasterMs, drawFrameCount: off.drawFrameCount, frames: off.frames },
		lines: { framesCaptured: lines.framesCaptured, totalMs: lines.totalMs, mainPaintMs: lines.mainPaintMs, rasterMs: lines.rasterMs, drawFrameCount: lines.drawFrameCount, frames: lines.frames },
		grid: { framesCaptured: grid.framesCaptured, totalMs: grid.totalMs, mainPaintMs: grid.mainPaintMs, rasterMs: grid.rasterMs, drawFrameCount: grid.drawFrameCount, frames: grid.frames },
		control: { framesCaptured: control.framesCaptured, totalMs: control.totalMs, mainPaintMs: control.mainPaintMs, rasterMs: control.rasterMs, drawFrameCount: control.drawFrameCount, frames: control.frames, css: "32 stacked repeating-linear-gradient layers on .cm-scroller" },
		offB: { framesCaptured: offB.framesCaptured, totalMs: offB.totalMs },
		ratioGridOverOff, ratioLinesOverOff, ratioControlOverOff, drift,
		threshold: "paper grid (worst case) <= 1.25x paper off - NOT asserted here for grid/lines, read from this JSON.",
		void: !(ratioControlOverOff !== null && ratioControlOverOff > 1.25) || drift === null || drift > 0.10,
	};
	// eslint-disable-next-line no-console
	console.log(`PAPERCOST off=${off.totalMs}ms grid=${grid.totalMs}ms(${ratioGridOverOff}) lines=${lines.totalMs}ms(${ratioLinesOverOff}) control=${control.totalMs}ms(${ratioControlOverOff}) drift=${drift} void=${record.void}`);
	if (process.env.HW_PAPER_COST_REPORT) writeFileSync(process.env.HW_PAPER_COST_REPORT, JSON.stringify(record, null, 1));

	// POSITIVE CONTROL, asserted (unlike grid/lines, whose real-world ratio is
	// exactly what the run measures and so cannot be pinned in
	// advance): a known-costly case must read meaningfully costlier than off,
	// or this instrument cannot show ANY cost difference and a clean
	// grid/lines ratio from it would be worthless.
	expect(ratioControlOverOff, "positive control (32 gradient layers) must cost more than 1.25x paper-off, or this instrument is VOID").toBeGreaterThan(1.25);
	// DRIFT CONTROL, asserted: the trace plumbing's own baseline
	// must not have moved across the run, or later arms cannot be compared
	// against the first "off" measurement at all.
	expect(drift, "off measured again at the end must be comparable to the first off").not.toBeNull();
	expect(drift!, "off-b vs off must agree within 10%, or the run drifted and every ratio above is VOID").toBeLessThanOrEqual(0.10);
});
