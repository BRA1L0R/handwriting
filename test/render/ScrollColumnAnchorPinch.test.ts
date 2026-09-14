/**
 * Candidate (2): does committed ink SLIDE during a scroll and snap back when it
 * settles, at the zoom Alan actually reads at?
 *
 * Alan, verbatim: "slides left and like, towards the anchor?" and "ink sliding
 * during the scroll and correcting when it stops". His Throwaway notes sit near
 * 10%.
 *
 * WHY ZOOM CHANGES THE QUESTION. At pinch 1.0 - which is where the sibling
 * ScrollColumnAnchor guard runs, and where it is green - none of the relevant
 * geometry exists. Below 1.0 the note viewport owns the editor host: it is
 * counter-sized WIDER than the pane and CSS-scaled back down, so
 *   - `scrollLeft` becomes live, where at 1.0 it is pinned at 0;
 *   - `ScrollBand.bandFor` gives the band a horizontal margin, because
 *     `hMargin` is 0 until `scrollWidth > clientWidth`, and the band's `left`
 *     is then computed FROM `scrollLeft`;
 *   - the column's screen position is driven by CSS variables captured once in
 *     `prepareViewportLayout` (`--handwriting-note-column-margin-left`, from
 *     `getComputedStyle(contentDOM).marginLeft` at capture time) rather than
 *     measured each frame.
 * A slide that only appears when the band's left is a function of `scrollLeft`
 * cannot show up in a fixture where `scrollLeft` is always 0.
 *
 * SAMPLED EVERY FRAME DURING THE SCROLL, not at settle. "Slides then snaps" is
 * a during-scroll signal by construction: at settle it is by definition gone.
 *
 * The detector and its positive control are the page's, shared with the sibling
 * file: each arm displaces its own painted camera by a known 10 note-px and
 * must read it back, so a zero here is a measurement rather than a silence.
 */

import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import css from "../../styles.css?raw";

/** Matches the page. A displacement under this is measurement noise. */
const VISIBLE_PX = 0.5;

import REAL_OBSIDIAN_CSS from "./obsidianReadableWidth";
const READABLE_LINE_WIDTH_CSS = REAL_OBSIDIAN_CSS;

declare const process: { env: Record<string, string | undefined> };
let browser: Browser, script: string;
const report: unknown[] = [];

beforeAll(async () => {
	const b = await build({
		entryPoints: [fileURLToPath(new URL("./scrollColumnAnchorPage.ts", import.meta.url))],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		alias: { obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)) },
		plugins: process.env.HW_PINCH_DEMAND_PLANT ? [{ name: 'missing-settle-demand', setup(builder) {
			builder.onLoad({ filter: /src[\\/]inline[\\/]InkOverlay\.ts$/ }, args => ({ loader: 'ts',
				contents: readFileSync(args.path, 'utf8').replace('expansion: scrollExpansionEnabled && (left !== null || top !== null)', 'expansion: false && (left !== null || top !== null)') }));
		} }] : [],
	});
	script = b.outputFiles[0]!.text;
	browser = await chromium.launch({ headless: true });
}, 180_000);

afterAll(async () => {
	await browser?.close();
	if (process.env.HW_PINCH_ANCHOR) writeFileSync(process.env.HW_PINCH_ANCHOR, JSON.stringify(report, null, 1));
});

type ArmPlant =
	| "none" | "wide" | "hscroll" | "ic" | "icwide" | "twofinger"
	| "preview" | "previewPause" | "previewCommit" | "overscroll" | "minimal" | "overscrollNoIc"
	| "icToggle" | "icwideToggle" | "leftInk" | "leftInkToggle" | "lag" | "lagNoIc"
	| "pinchFocal" | "pinchFocalIC" | "pinchPointer";

async function run(pinch: number, plant: ArmPlant = "none") { return runArm(true, pinch, plant); }

async function runArm(readable: boolean, pinch: number, plant: ArmPlant = "none", centringTheme = false, offsetDisabled = false, startScrollTop = 0, zoomTo = 0.25) {
	const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
	try {
		const errors: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		await page.addStyleTag({
			content:
				css +
				readFileSync(fileURLToPath(new URL("./noteViewportCamera.css", import.meta.url)), "utf8") +
				READABLE_LINE_WIDTH_CSS,
		});
		await page.addScriptTag({ content: script });
		const r = await page.evaluate(
			a => (window as any).scrollColumnAnchor.run(a.readable, a.plant, a.pinch, a.centringTheme, a.offsetDisabled, a.startScrollTop, a.zoomTo),
			{ pinch, plant, readable, centringTheme, offsetDisabled, startScrollTop, zoomTo }
		);
		expect(errors, `page errors at pinch ${pinch}: ${errors.join(" | ")}`).toEqual([]);
		report.push(r);
		return r;
	} finally {
		await page.close();
	}
}

it("ink stays on the column through a scroll at 100%, 50% and 10% zoom", async () => {
	const full = await run(1);
	const half = await run(0.5);
	const tenth = await run(0.1);
	// The arm that actually has a live scrollLeft.
	const wide = await run(0.1, "wide");
	const hscroll = await run(0.1, "hscroll");
	// A REAL pinch value. A gesture never lands on 0.1 - the device probe for
	// Alan's own note recorded 0.0732132 - and a round ratio is exactly what
	// stops the scale quotient wobbling.
	const real = await run(0.0732132);
	// ALAN'S ACTUAL CONFIGURATION: Infinite Canvas ON + Readable line length ON
	// at the zoom floor, vertical scroll only.
	const ic = await run(0.1, "ic");
	const icToggled = await run(0.1, "icToggle");
	// P2 at Alan's geometry and his zoom: wide grant, k=1, opened-under-setting
	// vs opened-then-toggled. He reports it at EVERY zoom including 100%.
	const wideOpen = await run(1, "icwide");
	const wideToggled = await run(1, "icwideToggle");
	const leftOpen = await run(1, "leftInk");
	const leftToggled = await run(1, "leftInkToggle");
	// eslint-disable-next-line no-console
	console.log(`P2 ic hScrollable=${ic.hScrollable} scrollWidth=${ic.scrollWidths[0]} client=${ic.clientWidthsSeen[0]} | icToggle hScrollable=${icToggled.hScrollable} scrollWidth=${icToggled.scrollWidths[0]} client=${icToggled.clientWidthsSeen[0]}`);
	const icwide = await run(0.1, "icwide");
	const twofinger = await run(0.1, "twofinger");
	// THE TRIGGER ITSELF: mounted at 1.0, pinched down to 0.1, sampled during
	// the gesture. Reported before it is asserted on.
	const preview = await run(1, "preview");
	const previewPause = await run(1, "previewPause");
	const previewCommit = await run(1, "previewCommit");
	const overscroll1 = await run(1, "overscroll");
	const overscrollLow = await run(0.1, "overscroll");
	// CONTROL: Infinite Canvas on, Readable line length OFF. If the reachable
	// band to the left is our granted extent, it survives here; if it is the
	// RLL centring margin, it vanishes.
	const overscrollNoRll = await runArm(false, 0.1, "overscroll");
	// Minimal centres the LINES, not the sizer: a sizer-only override misses it.
	const overscrollMinimal = await run(0.1, "minimal");
	// Infinite Canvas OFF: the rule must not apply, so the column stays centred.
	const icOffCentred = await run(1, "overscrollNoIc");
	// The preview-offset arms would now pass vacuously - with the column pinned
	// dx is identically zero - so re-run them against a theme that still centres
	// through selectors our rule does not name. That is also the case the
	// machinery is retained as a safety net for.
	const previewThemed = await runArm(true, 1, "preview", true);
	const previewPauseThemed = await runArm(true, 1, "previewPause", true);
	const previewCommitThemed = await runArm(true, 1, "previewCommit", true);
	// THE SAME ARMS WITH THE OFFSET DISABLED. These measure the displacement the
	// fix prevents; without them the zeros above could equally mean the path is
	// never reached. Measured on this fixture: 270.000 px.
	const previewThemedOff = await runArm(true, 1, "preview", true, true);
	const previewPauseThemedOff = await runArm(true, 1, "previewPause", true, true);
	const previewCommitThemedOff = await runArm(true, 1, "previewCommit", true, true);
	// eslint-disable-next-line no-console
	console.log(
		"OVERSCROLL " + JSON.stringify([overscroll1, overscrollLow].map((r: any) => ({
			pinch: r.pinch, hScrollable: r.hScrollable, scrollWidth: r.scrollWidthBefore,
			clientWidth: r.clientWidthBefore, minScrollLeft: r.minScrollLeft,
			columnContentX: r.columnContentX, overscrollLeft: r.overscrollLeft,
		})), null, 1)
	);
	// eslint-disable-next-line no-console
	console.log(
		`PREVIEW ARM: offFrames=${preview.offFrames} maxOffBy=${preview.maxOffBy} ` +
			`healedOffBy=${preview.healedOffBy} endsOff=${preview.endsOff} ` +
			`pinchPreviewFrames=${preview.pinchPreviewFrames} columnXs=${JSON.stringify(preview.columnXs)}
` +
			`detail=${JSON.stringify(preview.offDetail.slice(0, 4), null, 1)}`
	);
	report.push({ note: "wide arm is pinch 0.1 with a grown surface extent" });

	// eslint-disable-next-line no-console
	console.log(
		"\nink vs column, by zoom\n" +
			[full, half, tenth]
				.map(
					(r: any) =>
						`  pinch=${String(r.pinch).padEnd(5)} now=${String(r.pinchNow).padEnd(6)} viewport=${String(r.viewportOwned).padEnd(6)} ` +
						`off=${String(r.offFrames).padEnd(4)} maxOffBy=${r.maxOffBy.toFixed(2).padEnd(9)} endsOff=${String(r.endsOff).padEnd(6)} ` +
						`detector=${r.detectorProves.toFixed(2).padEnd(8)} scrollLefts=${JSON.stringify(r.scrollLefts.slice(0, 5))} ` +
						`columnXs=${JSON.stringify(r.columnXs.slice(0, 5))}`
				)
				.join("\n") +
			"\n"
	);

	// Liveness first: a fixture that drew nothing or never scrolled reports a
	// clean zero and looks exactly like a pass.
	for (const r of [full, half, tenth]) {
		expect(r.strokes, `no stroke committed at pinch ${r.pinch}`).toBe(2);
		expect(r.scrolled, `the pinch ${r.pinch} arm never scrolled`).toBe(true);
		expect(
			r.detectorProves,
			`detector blind at pinch ${r.pinch}: a planted 10px displacement read back as ${r.detectorProves}`
		).toBeCloseTo(10 * r.probeScale, 1);
	}

	// The pinch arms must actually have pinched, or they are just three copies
	// of the 100% arm wearing different labels.
	expect(half.pinchNow, `pinch 0.5 did not take: pinchScaleNow=${half.pinchNow}`).toBeCloseTo(0.5, 2);
	expect(tenth.pinchNow, `pinch 0.1 did not take: pinchScaleNow=${tenth.pinchNow}`).toBeCloseTo(0.1, 2);

	// THE PINCH-PREVIEW GUARD. Ink must sit on the column on every frame OF THE
	// GESTURE, not merely once it settles - settling is what heals it, so a
	// post-settle sample can only ever be green.
	//
	// Non-vacuous, measured on 339fd524 before applyPreviewInkOffset existed:
	// offFrames 8 of 8, maxOffBy 629.125 px, monotonic through the zoom-out
	// (-70.1, -174.9, -279.8, -384.6, -489.4, -559.3 ...), healing to exactly 0
	// at pinch end. 629.125 is W * 0.45 at W 1398 - the closed form
	// W * (k/k0 - 1) / 2 - so this arm pins the derivation, not just a symptom.
	expect(
		preview.pinchPreviewFrames,
		`the preview arm never entered a pinch preview: the gesture was rejected, so its zero means nothing`
	).toBeGreaterThan(0);
	expect(
		preview.offFrames,
		`ink left the column during a pinch preview: ${preview.offFrames} frames, up to ${preview.maxOffBy}px ` +
			`(columns seen: ${JSON.stringify(preview.columnXs)})`
	).toBe(0);
	expect(preview.endsOff, `ink did not land on the column at pinch end: ${preview.healedOffBy}px`).toBe(false);

	// THE PAUSED GESTURE. A finger resting mid-pinch past PINCH_SCROLL_QUIET_MS
	// lets deferPinchRaster go false and syncCamera run, so any pairing of a
	// column written by one method with a scale written by another is comparing
	// two different moments. Red on 0987f17f for a DIFFERENT reason than the
	// arm above: that one fails on the viewport-relative hostLeft term, this one
	// on the column/scale pair.
	expect(
		previewPause.pinchPreviewFrames,
		`the paused arm never entered a preview; its zero means nothing`
	).toBeGreaterThan(0);
	// A stroke committing mid-gesture must not strand the rest of the layer at
	// the pre-gesture raster for the remainder of the pinch.
	expect(
		previewCommit.offFrames,
		`ink left the column after a mid-gesture commit: ${previewCommit.offFrames} frames, up to ${previewCommit.maxOffBy}px`
	).toBe(0);
	expect(
		previewPause.offFrames,
		`ink left the column across a paused pinch: ${previewPause.offFrames} frames, up to ${previewPause.maxOffBy}px`
	).toBe(0);

	// THE COLUMN'S OFFSET IS FROZEN AT ITS 100% VALUE while the viewport is
	// owned (SPEC-column-margin.md). Liveness first: an arm that never became
	// horizontally scrollable could not over-scroll even if the defect were there.
	expect(
		overscrollLow.hScrollable,
		`the zoomed arm is not horizontally scrollable: ${overscrollLow.scrollWidthBefore} vs ${overscrollLow.clientWidthBefore}`
	).toBe(true);
	// 1. unchanged at 100%.
	expect(overscroll1.columnContentX, `k=1 column`).toBeCloseTo(341.25, 1);
	// 2. FROZEN in host units at 10% - the same 341.25, which is 34.1 on screen,
	//    instead of the 6632.50 it re-centred to before.
	// The natural origin now leaves zero residual pan. A separate legal
	// leftward preview keeps the de-pan oracle's nonzero positive control.
	expect(Math.abs(overscrollLow.panAtMin)).toBeLessThan(.5);
	expect(Math.abs(overscrollLow.panProbe.pan)).toBeGreaterThan(100);
	expect(overscrollLow.panProbe.corrected).toBeCloseTo(341.25, 1);
	expect(
		overscrollLow.columnContentX,
		`k=0.1 column should hold its 100% host-local value, got ${overscrollLow.columnContentX} (was 6632.50 re-centring)`
	).toBeCloseTo(341.25, 1);
	// 7. Readable line length off is a no-op at any zoom.
	expect(overscrollNoRll.columnContentX, `RLL off`).toBeCloseTo(0, 2);
	// Infinite Canvas off: unowned at 100%, still centred, nothing reachable beside it.
	expect(icOffCentred.columnContentX, `IC off, k=1`).toBeCloseTo(341.25, 1);

	// LIVENESS: with the offset off, a centring theme really does drag ink off
	// the column. This is what makes the zeros below mean something.
	for (const r of [previewThemedOff, previewPauseThemedOff, previewCommitThemedOff]) {
		expect(
			r.maxOffBy,
			`offset disabled, themed ${r.plant}: expected visible drift, got ${r.maxOffBy}px over ${r.offFrames} frames`
		).toBeGreaterThan(100);
	}

	// The offset machinery must still hold where a theme still centres. The
	// UNTHEMED preview arms are redundant under the column freeze - the column
	// no longer moves, so their dx is identically 0 - and these themed arms are
	// the sole carriers of that coverage.
	for (const r of [previewThemed, previewPauseThemed, previewCommitThemed]) {
		expect(r.pinchPreviewFrames, `themed ${r.plant} never previewed`).toBeGreaterThan(0);
		expect(r.offFrames, `themed ${r.plant}: ${r.offFrames} frames up to ${r.maxOffBy}px`).toBe(0);
	}

	// REPORTED, NOT ASSERTED: the hand-rolled Minimal plant reads 0.00 with our
	// rule REMOVED as well as with it in force, so it does not reproduce that
	// theme's centring in this fixture and cannot test the reset list. Spec test
	// 5 is NOT satisfied; the repo's real theme slice
	// (test/render/fixtures/minimal-9.0.2-theme.css) is what it needs.
	// eslint-disable-next-line no-console
	console.log("MINIMAL PLANT (ineffective, reported only): columnLocal=" + overscrollMinimal.columnContentX);
	// eslint-disable-next-line no-console
	console.log("SCROLL RANGE " + JSON.stringify([overscroll1, overscrollLow, overscrollNoRll, icOffCentred].map((r: any) => ({
		rll: r.readable, pinch: r.pinch, plant: r.plant,
		min: r.minScrollLeft, max: r.maxScrollLeft, column: r.columnContentX,
	}))));

	// PLANT EFFICACY. "Ink tracked the column" is vacuous unless the column
	// actually moved. The hscroll arm is the one that reproduces Alan's
	// description - the column sliding sideways in BOTH directions during the
	// scroll - and these pin that it really did.
	expect(
		wide.hScrollable,
		`the wide arm is not horizontally scrollable: scrollWidths=${JSON.stringify(wide.scrollWidths)} clientWidths=${JSON.stringify(wide.clientWidthsSeen)}. ` +
			`Counter-sizing the host does not do it - the scroller grows with it; only the surface extent does.`
	).toBe(true);
	expect(
		hscroll.scrollLefts.length,
		`the hscroll arm never moved scrollLeft: ${JSON.stringify(hscroll.scrollLefts)}`
	).toBeGreaterThan(3);
	expect(
		hscroll.columnXs.length,
		`the hscroll arm never moved the column on screen: ${JSON.stringify(hscroll.columnXs)}`
	).toBeGreaterThan(2);

	// THE BEHAVIOUR THIS FILE PROTECTS. Committed ink stays on the text column
	// through a scroll at every zoom, including at 10% with a live horizontal
	// axis and the column sliding left and right underneath it.
	//
	// Non-vacuous: ablating syncCamera's per-frame column read
	// (`lastGoodColumnLeft ?? resolveColumnLeft(origin.left)` at the
	// `contentLeft` assignment) turns the hscroll arm red at 15 frames and
	// 40.00px - the exact width of that arm's column movement - and leaves
	// `endsOff` false, which is Alan's "slides during the scroll and corrects
	// when it stops" reproduced precisely. Every other arm stays green under
	// that ablation, so this arm is the only one carrying the guard.
	for (const r of [full, half, tenth, wide, hscroll, real, ic, icwide]) {
		expect(
			r.offFrames,
			`pinch ${r.pinch} plant=${r.plant} displaced ink off the column by up to ${r.maxOffBy}px over ${r.offFrames} frames ` +
				`(columns seen: ${JSON.stringify(r.columnXs)}, scrollLefts: ${JSON.stringify(r.scrollLefts)})`
		).toBe(0);
	}

	// Reported, not asserted. `resolveColumnLeft(null)` falls back to the cached
	// column, which is the shipped code doing what the ablation above does by
	// hand. It never fires on this fixture's plain text lines; a note built of
	// widgets or images is where it could.
	// eslint-disable-next-line no-console
	console.log(
		"COLUMN NOT FOUND counts (0 = the scan always resolved): " +
			JSON.stringify([full, half, tenth, wide, hscroll].map((r: any) => ({ pinch: r.pinch, plant: r.plant, scanNulls: r.scanNulls })))
	);
}, 300_000);

/**
 * THE SAME QUESTION IN COMPOSITED PIXELS, BOTH ZOOM DIRECTIONS AND A SCROLL.
 *
 * The arm above reads rects. The drift Alan saw (Infinite Canvas ON, Readable
 * line length ON: ink slides left of the text while zooming, then settles) is
 * a question about what the compositor put on screen, so this one takes a CDP
 * `Page.captureScreenshot` at every pinch preview frame, every scroll frame and
 * every settle, finds a magenta block in the image, and compares its centre to
 * where layout says the block belongs at that same frame: the column's painted
 * left edge plus the block's note-space centre times the column's painted
 * scale. No overlay field is part of the expected value.
 *
 * TOLERANCE, in device px: 2 + half of one raster texel as displayed. The 2 is
 * 0.5 for rounding each mask edge, 0.5 for the anti-alias threshold, 0.5 for
 * the compositor snapping a transformed layer to whole device px, and 0.5 for
 * the column rect's own sub-pixel read. The texel term is there because a
 * preview reuses the raster it started with: zooming 0.1 -> 1 shows a raster
 * drawn at 10%, one backing px of which covers several device px. The centre
 * of a symmetric block is used, so stroke width does not enter.
 *
 * Plants that prove the instrument are recorded in
 * slate-artifacts/1.4.19/fleet3-scroll-column-pixels (HANDBACK.md).
 */
const rest0Index = (r: any): number => r.frames[0].shotIndex;

async function pixelRegime(readable: boolean, infiniteCanvas: boolean, options: { external?: number; riseAt?: number; risePx?: number; leg?: "held-zoom-in"; pauseAt?: number[]; pauseAction?: "stroke" | "resize" | "font" | "watchdog" | "host" } = {}) {
	const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
	try {
		const errors: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		const cdp = await page.context().newCDPSession(page);
		const shots: string[] = [];
		// DEVICE RESOLUTION: clip scale 2 at deviceScaleFactor 2. Scale 1 returned a
		// CSS-px image (measured 1397 px wide for a 1397.5 px clip).
		await page.exposeFunction("__scpShot", async (clip: { x: number; y: number; width: number; height: number }) => {
			const t = Date.now();
			const r = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 2 }, fromSurface: true });
			shots.push(r.data);
			return { ms: Date.now() - t, index: shots.length - 1 };
		});
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		await page.addStyleTag({
			content: css + readFileSync(fileURLToPath(new URL("./noteViewportCamera.css", import.meta.url)), "utf8") + READABLE_LINE_WIDTH_CSS,
		});
		await page.addScriptTag({ content: script });
		const r: any = await page.evaluate(
			a => (window as any).scrollColumnAnchor.runPixelColumn(a.readable, a.infiniteCanvas, a.backing, a.options),
			{ readable, infiniteCanvas, backing: !!process.env.HW_SCPX_BACKING, options: { external: options.external, riseAt: options.riseAt, risePx: options.risePx, pauseAt: options.pauseAt, pauseAction: options.pauseAction } }
		);
		expect(shots.length, "a screenshot behind every frame record").toBeGreaterThanOrEqual(r.frames.length);
		const detect = (b64: string, shift = 0, pad?: number) => page.evaluate(a => (window as any).scrollColumnAnchor.detectMark(a.b64, a.shift, a.pad), { b64, shift, pad });
		// PAINTED STROKE THICKNESS, calibrated once on the rest frame (k = 1): the
		// block's box is its point extent plus one stroke thickness on each axis.
		const restD = await detect(shots[r.frames[0].shotIndex]!, 0);
		const restDpr = restD.w / r.frames[0].clip.width, restScale = r.frames[0].scale;
		const thick = restD.n
			? ((restD.maxX - restD.minX + 1) / restDpr / restScale - 2 * r.note.halfW + (restD.maxY - restD.minY + 1) / restDpr / restScale - 2 * r.note.halfH) / 2
			: 0;
		for (const f of r.frames) {
			const d = await detect(shots[f.shotIndex]!, 0, 80);
			if (f.viewportShotIndex !== undefined) f.outsidePane = await page.evaluate(a => (window as any).scrollColumnAnchor.countMagentaOutside(a.b64, a.rect), { b64: shots[f.viewportShotIndex]!, rect: f.clip });
			const dpr = d.w / f.clip.width;
			const boxW = (2 * r.note.halfW + thick) * f.scale, boxH = (2 * r.note.halfH + thick) * f.scale;
			const area = boxW * boxH * dpr * dpr;
			const bboxW = d.n ? d.maxX - d.minX + 1 : 0, bboxH = d.n ? d.maxY - d.minY + 1 : 0;
			const clipped = !!d.n && (d.minX <= 3 || d.minY <= 3 || d.maxX >= d.w - 4 || d.maxY >= d.h - 4);
			const ey = f.expectedYLine ?? f.expectedY;
			Object.assign(f, {
				dpr, detected: d.n, area: Math.round(area), areaRatio: area > 0 ? d.n / area : null, components: d.components, others: d.others, clipped,
				bboxDevice: [bboxW, bboxH], expectedBboxDevice: [Math.round(boxW * dpr), Math.round(boxH * dpr)],
				// THE WHOLE BOX INSIDE THE PANE, on both axes, from layout.
				inPane: f.expectedX !== null && f.expectedX - boxW / 2 >= f.clip.x + 1 && f.expectedX + boxW / 2 <= f.clip.x + f.clip.width - 1 &&
					ey - boxH / 2 >= f.clip.y + 1 && ey + boxH / 2 <= f.clip.y + f.clip.height - 1,
				// PRESENT: found at roughly its own area and not cut by an image edge.
				present: d.n > 0 && !clipped && d.n >= 0.5 * area && d.n <= 1.6 * area,
				detectedX: d.n ? f.clip.x + (d.minX + d.maxX + 1) / 2 / dpr : null,
				detectedY: d.n ? f.clip.y + (d.minY + d.maxY + 1) / 2 / dpr : null,
				// A text edge at the image edge is the pane cutting the lines, not the column.
				textLeftX: d.textLeft === null || d.textLeft <= 2 ? null : f.clip.x + d.textLeft / dpr,
				tol: 2 + 0.5 * f.texelDevice,
			});
			f.offDevice = f.detectedX === null || f.expectedX === null ? null : (f.detectedX - f.expectedX) * dpr;
			f.offYDevice = f.detectedY === null ? null : (f.detectedY - ey) * dpr;
			f.offYDocTopDevice = f.detectedY === null ? null : (f.detectedY - f.expectedY) * dpr;
			f.textVsLayoutDevice = f.textLeftX === null || f.colX === null ? null : (f.textLeftX - f.colX) * dpr;
			// INK AGAINST THE TEXT, BOTH FROM THE SAME SCREENSHOT, in note px.
			f.inkMinusTextNote = f.textLeftX === null || f.detectedX === null ? null : (f.detectedX - f.textLeftX) / f.scale;
			f.backingOffDevice = f.backing?.rectMappedX == null || f.expectedX === null ? null : (f.backing.rectMappedX - f.expectedX) * dpr;
		}
		// THE DETECTOR'S OWN POSITIVE CONTROL: the rest frame's pixels redrawn
		// 20 device px to the right must read back 20 px to the right.
		const rest = r.frames[0], restShifted = await detect(shots[rest0Index(r)]!, 20);
		const detectorShift = restShifted.n && rest.detected ? (restShifted.minX! + restShifted.maxX! + 1) / 2 - (rest.detectedX - rest.clip.x) * rest.dpr : null;
		for (const f of r.frames) f.textRelOffDevice = f.inkMinusTextNote === null || rest.inkMinusTextNote === null ? null : (f.inkMinusTextNote - rest.inkMinusTextNote) * f.scale * f.dpr;
		const phases = [...new Set(r.frames.map((f: any) => f.phase))] as string[];
		const summary = phases.map(p => {
			const fs = r.frames.filter((f: any) => f.phase === p);
			return {
				phase: p, frames: fs.length, previewFrames: fs.filter((f: any) => f.before.preview).length,
				maxAbsOffDevice: Math.max(...fs.map((f: any) => (f.offDevice === null ? Infinity : Math.abs(f.offDevice)))),
				maxAbsOffYDevice: Math.max(...fs.map((f: any) => (f.offYDevice === null ? Infinity : Math.abs(f.offYDevice)))),
				maxTol: Math.max(...fs.map((f: any) => f.tol)), absent: fs.filter((f: any) => !f.present).length,
				unstable: fs.filter((f: any) => !f.stable).length, maxShotMs: Math.max(...fs.map((f: any) => f.ms)),
				notInPane: fs.filter((f: any) => !f.inPane).length, clipped: fs.filter((f: any) => f.clipped).length,
				areaRatio: [Math.min(...fs.map((f: any) => f.areaRatio ?? 0)), Math.max(...fs.map((f: any) => f.areaRatio ?? 0))].map(v => Math.round(v * 100) / 100),
				maxAttempts: Math.max(...fs.map((f: any) => f.attempts)),
				maxAbsTextRelOffDevice: Math.max(...fs.map((f: any) => (f.textRelOffDevice === null ? -1 : Math.abs(f.textRelOffDevice)))),
				textMissing: fs.filter((f: any) => f.textLeftX === null).length,
				maxAbsBackingRectOffDevice: fs.some((f: any) => f.backing) ? Math.max(...fs.map((f: any) => (f.backingOffDevice === null ? Infinity : Math.abs(f.backingOffDevice)))) : undefined,
				backingCentres: fs.some((f: any) => f.backing) ? [...new Set(fs.map((f: any) => f.backing?.cx))] : undefined,
			};
		});
		const out = { readable, infiniteCanvas, thick, settings: r.settings, note: r.note, strokes: r.strokes, calls: r.calls, gestures: r.gestures, scroll: r.scroll, detectorShift, summary, frames: r.frames, applyStack: r.applyStack, pinchStack: r.pinchStack, writeStack: r.writeStack };
		// One file per cell: readable line length, infinite canvas and the
		// external scale all name it, so no cell overwrites another's record.
		if (process.env.HW_SCPX_OUT) writeFileSync(`${process.env.HW_SCPX_OUT}-${readable ? "rll" : "norll"}-${infiniteCanvas ? "ic1" : "ic0"}-e${options.external ?? 1}-${options.leg ?? "main"}${options.risePx ? `-rise${options.risePx}` : ""}${options.pauseAction ? `-${options.pauseAction}` : ""}.json`, JSON.stringify(out, null, 1));
		// eslint-disable-next-line no-console
		console.log(`SCPX readable=${readable} ic=${infiniteCanvas} thick=${thick.toFixed(2)} gestures=${JSON.stringify(r.gestures)} detectorShift=${detectorShift} calls=${JSON.stringify(r.calls)} scroll=${JSON.stringify(r.scroll)}\n` +
			summary.map(s => "  " + JSON.stringify(s)).join("\n") + "\n" +
			r.frames.map((f: any) => `  ${f.label.padEnd(28)} off=${f.offDevice === null ? "null" : f.offDevice.toFixed(2)} offY=${f.offYDevice === null ? "null" : f.offYDevice.toFixed(2)} tol=${f.tol.toFixed(2)} ` +
				`textRel=${f.textRelOffDevice === null ? "null" : f.textRelOffDevice.toFixed(2)} textVsLayout=${f.textVsLayoutDevice === null ? "null" : f.textVsLayoutDevice.toFixed(2)} ` +
				`n=${f.detected}/${f.area} ratio=${f.areaRatio === null ? "null" : f.areaRatio.toFixed(2)} clipped=${f.clipped} att=${f.attempts} wait=${f.waitedFrames} bbox=${JSON.stringify(f.bboxDevice)}/${JSON.stringify(f.expectedBboxDevice)} comps=${f.components} present=${f.present} inPane=${f.inPane} preview=${f.before.preview} stable=${f.stable} ms=${f.ms}\n` +
				`      colX=${f.colX === null ? "null" : f.colX.toFixed(2)} exp=(${f.expectedX === null ? "null" : f.expectedX.toFixed(2)},${f.expectedY.toFixed(2)}|line ${f.expectedYLine === null ? "null" : f.expectedYLine.toFixed(2)}) det=(${f.detectedX === null ? "null" : f.detectedX.toFixed(2)},${f.detectedY === null ? "null" : f.detectedY.toFixed(2)}) text=${f.textLeftX === null ? "null" : f.textLeftX.toFixed(2)} ` +
				`layer=${JSON.stringify(f.before.layerT)} sizer=${JSON.stringify(f.before.sizerT)} cam=${f.before.cam} sl=${f.before.sl} st=${f.before.st} diag=${JSON.stringify(f.diag)} others=${JSON.stringify(f.others)}` +
				(f.stable ? "" : ` after=${JSON.stringify(f.after)}`) +
				(f.backing ? ` backingCx=${f.backing.cx} backingRectOff=${f.backingOffDevice === null ? "null" : f.backingOffDevice.toFixed(2)}` : "")).join("\n"));

		// LIVENESS first: a fixture that drew nothing, never pinched or never
		// scrolled reports a clean zero.
		expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
		expect(r.strokes, "the mark did not commit").toBe(20 + r.frames.filter((f: any) => f.pause?.action === "stroke").length);
		expect(r.settings.fontZoom, "note px are content layout px only at font zoom 1").toBe(1);
		if (readable) {
			expect(r.settings.paneReadableClass).toBe(true);
			expect(r.settings.columnFromHostLeft, "Readable line length did not centre the column").toBeCloseTo(341.25 * (options.external ?? 1), 0);
		} else expect(Math.abs(r.settings.columnFromHostLeft), "Readable line length off still centred the column").toBeLessThan(5);
		expect(r.gestures.out.pinchNow, "zoom out did not reach 10%").toBeCloseTo(0.1, 3);
		expect(r.gestures.in.pinchNow, "zoom in did not reach 100%").toBeCloseTo(1, 3);
		expect(r.gestures.in2.pinchNow, "zoom in did not reach 200%").toBeCloseTo(2, 3);
		for (const g of ["out", "in", "in2"]) expect(r.gestures[g].applyCalls, `${g}: the production preview offset never ran`).toBeGreaterThan(0);
		// THE CALLER CHAIN, in its two real halves (source: InlinePenRouter.ts
		// updatePinch -> cb.onPinch -> InkOverlay.pinch, which coalesces the move
		// into requestAnimationFrame(() => flushPinch(false)); flushPinch ->
		// applyPinchScale -> applyPreviewInkOffset -> writeInkLayerTransform).
		expect(r.pinchStack, "the router's move did not reach InkOverlay.pinch through updatePinch").toContain("updatePinch");
		for (const fn of ["flushPinch", "applyPinchScale"]) expect(r.applyStack, `preview offset not reached through ${fn}`).toContain(fn);
		expect(r.writeStack, "writeInkLayerTransform never ran from applyPreviewInkOffset").toContain("applyPreviewInkOffset");
		expect(r.scroll.scrollTravel.topPainted, `the 10% scroll moved the note by only ${r.scroll.scrollTravel.topPainted} painted px`).toBeGreaterThan(30);
		// Under an external scale one held step can land a repaint and read as
		// a settled frame; the offset assertions below still run on every
		// preview frame, so one non-preview frame per leg is tolerated there.
		// A pause whose trigger commits the camera in place (resize, font, watchdog) makes its
		// pause frame a settle, not a preview; the count expects those and nothing else.
		const committedPauses = (phase: string) => options.pauseAction && options.pauseAction !== "stroke" ? r.frames.filter((f: any) => f.pause && f.phase === phase).length : 0;
		for (const s of summary.filter(s => ["out", "in", "in2"].includes(s.phase))) expect(s.previewFrames, `${s.phase}: no frame was a pinch preview`).toBeGreaterThanOrEqual((options.external && options.external !== 1 ? s.frames - 1 : s.frames) - committedPauses(s.phase));
		expect(detectorShift, "detector could not see a 20 device px image shift").not.toBeNull();
		expect(Math.abs(detectorShift! - 20), `detector read a 20 px image shift as ${detectorShift}`).toBeLessThanOrEqual(1);

		// THE BEHAVIOUR: present, stable while captured, and on the column.
		//
		// TWO LEGS, TWO ARMS. The held zoom-IN-from-0.1 leg (phase "in") is a
		// separate presentation defect: when a repaint lands during the hold,
		// the camera absorbs the focal pan while the ink layer still carries it,
		// and the mark leaves the pane until the settle (fleet 3 REPRO "Second
		// red"; identical on the unfixed source, with the scroll-latch fix, and
		// with Readable line length OFF). That leg is asserted by its OWN arm
		// below, which runs as `fails` while the defect is open and records the
		// camera and the layer transform on every frame. This arm asserts every
		// other frame, including the settles of that leg, so presence at rest,
		// at settle and on the control stays a liveness check here.
		// THE EXTERNAL-SCALE CELL IS A CONTROL FOR UNITS: the column term and
		// the scroll delta of the preview offset must agree under an ancestor
		// scale. Its zoom-OUT previews check the scroll term; its zoom-IN
		// previews past 1 check the column term (measured 2026-09-13 at 0.8:
		// with the external factor on the scroll term instead, the k 1.6
		// preview carried -49.9 layer px for a 62.4 px column move and the ink
		// read 34 device px off its text). Both are asserted here on every
		// frame the pane geometry keeps inside the pane; the frames the pane
		// clips at 0.8 (k 2.0 and its settle) are recorded (SCPX-EXT-ZOOM-IN).
		// The held zoom-in-from-0.1 leg (phase "in") stays recorded under an
		// external scale: it is its own arm's finding, not this cell's.
		const externalCell = !!(options.external && options.external !== 1);
		const recorded = (f: any): boolean => externalCell && (f.phase === "in" || (String(f.phase).startsWith("in2") && !f.inPane));
		// A PAUSE FRAME IS ASSERTED WHATEVER ITS PHASE: it is the outcome frame of
		// the trigger the arm applied (the in2 pause carries the resize commit
		// at k 2.0 whose leftover translate clipped the mark on e355b259).
		const legFrames = r.frames.filter((f: any) => ((options.leg === "held-zoom-in") === (f.phase === "in") || (options.leg === "held-zoom-in" && !!f.pause)) && !recorded(f));
		for (const f of r.frames.filter(recorded)) {
			// eslint-disable-next-line no-console
			console.log(`SCPX-EXT-ZOOM-IN ${f.label} present=${f.present} off=${f.offDevice === null ? "null" : f.offDevice.toFixed(1)} inkOffset=${f.previewInkOffset} attempts=${f.attempts} stable=${f.stable}`);
		}
		for (const f of legFrames) {
			// A capture the compositor changed under (three attempts exhausted)
			// is recorded rather than asserted in the external cell only; its
			// position read is still asserted below.
			if (externalCell && !f.stable) { console.log(`SCPX-EXT-UNSTABLE ${f.label} ${JSON.stringify(f.after)}`); } else
			if (options.leg === "held-zoom-in") {
				// eslint-disable-next-line no-console
				console.log(`SCPX-HELD-IN ${f.label} present=${f.present} n=${f.detected} off=${f.offDevice === null ? "null" : f.offDevice.toFixed(1)} cam=${JSON.stringify(f.before?.cam ?? null)} layer=${JSON.stringify(f.before?.layerT ?? null)} attempts=${f.attempts}`);
			}
			if (!(externalCell && !f.stable)) expect.soft(f.stable, `${f.label}: state changed during the capture ${JSON.stringify(f.after)}`).toBe(true);
			expect.soft(f.inPane, `${f.label}: layout puts the mark outside the pane`).toBe(true);
			if (f.outsidePane) expect.soft(f.outsidePane.outside, `${f.label}: ink painted outside the pane (${JSON.stringify(f.outsidePane)})`).toBe(0);
			expect.soft(f.present, `${f.label}: ink not found whole on screen (${f.detected} of ${Math.round(f.area)} px, ratio ${f.areaRatio}, clipped ${f.clipped})`).toBe(true);
			const want = f.phase === "control" ? 20 * f.scale * f.dpr : 0;
			expect.soft(f.offDevice === null ? Infinity : Math.abs(f.offDevice - want),
				`${f.label}: ink ${f.offDevice === null ? "not found" : f.offDevice.toFixed(2) + " device px"} from ${want ? "the +20 control position" : "the text column's layout"} (tol ${f.tol.toFixed(2)})`).toBeLessThanOrEqual(f.tol);
		}
		return out;
	} finally {
		await page.close();
	}
}

it("committed ink stays on the text column in composited pixels: zoom out, scroll, zoom in", async () => {
	// Alan's configuration (Readable line length ON) with Infinite Canvas ON
	// and OFF, each with its Readable-OFF control. The held zoom-in-from-0.1
	// leg is asserted by the `fails` arm below, not here.
	await pixelRegime(true, true);
	await pixelRegime(false, true);
	await pixelRegime(true, false);
	await pixelRegime(false, false);
}, 600_000);

// ALAN'S DIRECTION. The reader's scroll RISES while the zoom-out preview is
// held: the content and the ink layer move left together, and the preview
// offset must not move the ink a second time. Unfixed source: the ink sits
// LEFT of its text by the rise times the zoom times the device ratio.
it("committed ink stays on the text column when the scroll rises inside a held zoom-out preview", async () => {
	await pixelRegime(true, true, { riseAt: 0.45, risePx: 60 });
}, 300_000);

// EXTERNAL SCALE. The column measure carries the host's ancestor scale while
// the scroll offset is layout px; the correction scales the scroll term by
// the same factor. At 0.8 the raw delta is wrong by 20% of every scroll change.
it("committed ink stays on the text column at an external scale of 0.8", async () => {
	await pixelRegime(true, true, { external: 0.8 });
}, 300_000);

// THE HELD ZOOM-IN LEG, its own arm, `fails` while the defect is open: with the
// fingers held, a repaint that lands mid-preview absorbs the focal pan into the
// camera while the ink layer keeps carrying it, and the mark leaves the pane
// until the settle. Every frame is asserted for presence and position and its
// camera and layer transform are printed (SCPX-HELD-IN). The day this passes,
// the gate goes red and the guard is flipped to an ordinary arm on purpose.
// PROMOTED FROM it.fails (2026-09-13): with CodeMirror's measuring held for
// the preview (D-NAV), no repaint re-bases the camera under the leg and the
// mark stays. The 300 ms pauses at k 0.2 (far) and k 0.75 (near) lapse the
// pinch quiet window on purpose: whatever resize-driven reallocation the
// deferred repaint runs under a live preview runs there, and the frame after
// each pause records whether it did (`resizes`, `backing`, `cam`) and whether
// the mark survived it.
it("committed ink stays in the pane on every frame of a held zoom-in from 10%", async () => {
	await pixelRegime(true, true, { leg: "held-zoom-in", pauseAt: [2, 7.5] });
	await pixelRegime(true, false, { leg: "held-zoom-in", pauseAt: [2, 7.5] });
}, 600_000);

// THE PAUSE WITH A TRIGGER. A still hold on an unchanged note never arms the
// deferred repaint, so the coverage question (D-COV: a resize-driven repaint
// under the preview reallocates the band from the unpanned viewport and culls
// the panned-in ink) needs the path made to fire: a stroke committed during
// the pause (the pen-up landing as the pinch begins), and a 1 px host resize
// (the plugin's own ResizeObserver). Each pause frame records whether it fired
// (`pause.fired`) and whether the mark survived; the two are read together.
for (const action of ["stroke", "resize", "font", "watchdog", "host"] as const) it(`committed ink stays in the pane through a held zoom-in from 10% with a ${action} during the pauses`, async () => {
	for (const infiniteCanvas of [true, false]) {
		const r = await pixelRegime(true, infiniteCanvas, { leg: "held-zoom-in", pauseAt: [2, 7.5], pauseAction: action });
		for (const f of r.frames.filter((f: any) => f.pause)) {
			const fired = f.pause.fired;
			// eslint-disable-next-line no-console
			console.log(`SCPX-PAUSE ${action} ic=${infiniteCanvas} ${f.label} present=${f.present} off=${f.offDevice === null ? "null" : f.offDevice.toFixed(1)} fired=${JSON.stringify(fired)}`);
			// The trigger must have REACHED the real path (Architect C-6/C-7: executed repaint or
			// reallocation, painted-camera or backing basis, never an entry count). A red here is
			// the "cannot fire" finding for that leg.
			if (action === "stroke") expect.soft(fired.deferArms + fired.repaints, `${f.label}: the stroke commit did not arm or run a repaint`).toBeGreaterThan(0);
			if (action === "resize") expect.soft(fired.resizesPastGuard, `${f.label}: the resize did not pass the quiet-window guard`).toBeGreaterThan(0);
			// The font route: nothing measured inside the dispatch AND the deferred resize actually ran
			// inside the pause (a past-guard handleResize entry), else the 0 is the 0 of nothing having run.
			if (action === "font") { expect.soft(fired.measuresInDispatch, `${f.label}: CodeMirror measured inside its own update`).toBe(0); expect.soft(fired.resizesPastGuard, `${f.label}: the deferred resize never ran inside the pause`).toBeGreaterThanOrEqual(1); expect.soft(fired.heldAfter, `${f.label}: the deferred resize did not release the hold`).toBe(false); }
			// The watchdog settled in place: the hold is off on the pause frame (it returns with the next
			// preview step) and the camera presented a settle; the mark's presence and position on this
			// frame and the steps after are asserted with every other frame of the leg.
			// Route i-a: the host change reached handleResize past the guard; the guard commits nothing and
			// reallocates nothing (basis retained), and the mark's presence and position are asserted as usual.
			if (action === "host") { expect.soft(fired.resizesPastGuard, `${f.label}: the host change never reached handleResize past the guard`).toBeGreaterThanOrEqual(1); expect.soft(fired.heldAfter, `${f.label}: the host change ended the hold`).toBe(true); expect.soft(fired.camChanged || fired.backingChanged, `${f.label}: the basis changed under the hold`).toBe(false); }
			if (action === "watchdog") { expect.soft(fired.heldAfter, `${f.label}: the watchdog left the hold on`).toBe(false); expect.soft(fired.camChanged, `${f.label}: the watchdog did not settle (camera unchanged)`).toBe(true); }
		}
	}
}, 300_000);

// DIAGNOSTIC, env-gated: the preview offset on real-finger timing (one gesture
// step per frame, no capture holds), for the confirmation in
// slate-artifacts/1.4.19/fleet3-scroll-column-pixels/REPRO.md.
it.runIf(!!process.env.HW_SCPX_CONT)("continuous pinch offset trace (diagnostic)", async () => {
	for (const readable of [true, false]) {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
		try {
			const errors: string[] = [];
			page.on("pageerror", e => errors.push(e.message));
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({
				content: css + readFileSync(fileURLToPath(new URL("./noteViewportCamera.css", import.meta.url)), "utf8") + READABLE_LINE_WIDTH_CSS,
			});
			await page.addScriptTag({ content: script });
			const r: any = await page.evaluate(a => (window as any).scrollColumnAnchor.runContinuousOffsetTrace(a.readable, true), { readable });
			if (process.env.HW_SCPX_CONT_OUT) writeFileSync(`${process.env.HW_SCPX_CONT_OUT}-${readable ? "rll" : "norll"}.json`, JSON.stringify(r, null, 1));
			// eslint-disable-next-line no-console
			console.log(`SCPX-CONT readable=${readable} gestures=${JSON.stringify(r.gestures)}\n` + r.summary.map((s: any) => "  " + JSON.stringify(s)).join("\n"));
			expect(errors, errors.join(" | ")).toEqual([]);
			for (const s of r.summary) expect(s.previewFlushes, `${s.sweep}: no preview flushes`).toBeGreaterThan(20);
		} finally {
			await page.close();
		}
	}
}, 300_000);

/**
 * DOES THE ZOOM GO WHERE THE FINGERS ARE?
 *
 * Alan on device, build fed59a8c: "zoom doesn't go to where you're pinching,
 * it zooms centered like, to the right."
 *
 * The arm pinches 1 -> 0.25 through 0.5 with the focal point at 0.75 of the
 * pane's width and half its height, and asks one question every preview frame
 * and once the gesture has settled: is the note-space point that was under the
 * focal point at the start still under it? The oracle is a `.cm-line`'s own
 * `getBoundingClientRect()` carried forward by the painted scale ratio - a DOM
 * position, never a source-text match and never an overlay internal, because
 * every overlay internal is a term in the computation under test.
 *
 * FOUR COMBINATIONS, because the two settings change the geometry and not just
 * the decoration: Readable line length decides whether the column is centred
 * inside the counter-sized host, and Infinite Canvas decides whether the
 * scroller has any extent to scroll into. An anchor that only works when the
 * scroll target happens to be reachable is not an anchor.
 */
it("a pinch holds the note under the focal point, in all four setting combinations", async () => {
	const combos: { label: string; plant: ArmPlant; readable: boolean; top: number; zoomTo: number }[] = [];
	// ZOOM IN AS WELL AS OUT. They are different regimes, not two signs of one:
	// zooming out asks the scroll to go somewhere it cannot (negative), zooming
	// in asks it to go somewhere the granted extent may not reach yet, and above
	// 1 the auto-centred column moves again. A fix that only holds one way is a
	// fix for half the gesture.
	for (const zoomTo of [0.25, 2])
		for (const top of [0, 2000])
			for (const readable of [true, false])
				for (const plant of ["pinchFocal", "pinchFocalIC"] as const)
					combos.push({
						label: `RLL ${readable ? "on " : "off"} IC ${plant === "pinchFocalIC" ? "on " : "off"} top=${String(top).padEnd(4)} k->${String(zoomTo).padEnd(4)}`,
						plant, readable, top, zoomTo,
					});
	const results: any[] = [];
	for (const c of combos) results.push({ ...c, r: await runArm(c.readable, 1, c.plant, false, false, c.top, c.zoomTo) });

	// eslint-disable-next-line no-console
	console.log(
		"\nFOCAL ANCHOR (offX/offY in screen px; 0 = the note stayed under the fingers)\n" +
			results
				.map(
					({ label, r }) =>
						`  ${label} offFrames=${String(r.offFrames).padEnd(3)} maxOffX=${r.maxOffX.toFixed(2).padEnd(9)} maxOffY=${r.maxOffY.toFixed(2).padEnd(9)} ` +
						`preview=${String(r.previewOffFrames).padEnd(3)}/${r.maxPreviewOff.toFixed(2).padEnd(9)} ` +
						`rawY=${r.maxOffYRaw.toFixed(2).padEnd(9)} cmShift=${r.cmEstimateShift.toFixed(2).padEnd(8)} ` +
						`settle=(${(r.settleOffX ?? NaN).toFixed(2)}, ${(r.settleOffY ?? NaN).toFixed(2)}) ` +
						`jump=(${r.settleJumpX === null ? "null" : r.settleJumpX.toFixed(2)}, ${r.settleJumpY === null ? "null" : r.settleJumpY.toFixed(2)}) ` +
						`scrollLefts=${JSON.stringify(r.scrollLefts)} scrollTops=${JSON.stringify(r.scrollTops)}\n` +
						`      host=${JSON.stringify(r.hostTransforms)} sizer=${JSON.stringify(r.sizerTransforms)} band=${JSON.stringify(r.bandTransforms)} hits=${r.hitFrames}/${r.samples}\n` +
						`      frames=${JSON.stringify(r.focalFrames.map((f: any) => [f.phase, f.offX === null ? null : Math.round(f.offX * 100) / 100, f.offY === null ? null : Math.round(f.offY * 100) / 100]))}
` +
						`      trace=${JSON.stringify(r.trace)}`
				)
				.join("\n") +
			"\n"
	);

	for (const { label, r } of results) {
		// LIVENESS, first and separately: a gesture the overlay rejected moves
		// nothing, is off by nothing, and reads exactly like a pass.
		expect(r.markerNulls, `${label}: the marker line left the DOM on ${r.markerNulls} frames, so its zeros mean nothing`).toBe(0);
		expect(r.pinchPreviewFrames, `${label}: no preview frame was entered; the gesture was rejected`).toBeGreaterThan(0);
		expect(r.pinchNow, `${label}: the pinch never took (pinchScaleNow=${r.pinchNow})`).toBeCloseTo(r.zoomTo, 2);
		expect(r.scaleRatioSpread, `${label}: the painted scale never changed (${r.scaleRatioSpread})`).toBeGreaterThan(0.5);
		expect(r.markerMoved, `${label}: the note never moved on screen, so "it stayed under the finger" is vacuous`).toBeGreaterThan(1);
		expect(Math.abs(r.probeSeesX), `${label}: a planted 10px host shift read back as ${r.probeSeesX}; the oracle is blind`).toBeCloseTo(10, 1);
		expect(Math.abs(r.probeSeesY), `${label}: a planted 7px host shift read back as ${r.probeSeesY}; the oracle is blind`).toBeCloseTo(7, 1);

		// THE BEHAVIOUR. Every preview frame AND the settled frame.
		expect(
			r.offFrames,
			`${label}: the zoom left the focal point behind on ${r.offFrames} frames, by up to ` +
				`(${r.maxOffX.toFixed(2)}, ${r.maxOffY.toFixed(2)})px; settled at ` +
				`(${r.settleOffX}, ${r.settleOffY}). Frames: ${JSON.stringify(r.focalFrames.map((f: any) => [f.phase, f.offX, f.offY]))}`
		).toBe(0);
		expect(r.endsOff, `${label}: settled off the focal point by (${r.settleOffX}, ${r.settleOffY})px`).toBe(false);
		// THE SETTLE SIGN. The committed frame must stand where the last preview
		// frame stood: a jump at pinch end is its own defect.
		expect(Math.abs(r.settleJumpX!), `${label}: the note jumped ${r.settleJumpX}px sideways at pinch end`).toBeLessThanOrEqual(1);
		expect(Math.abs(r.settleJumpY!), `${label}: the note jumped ${r.settleJumpY}px vertically at pinch end`).toBeLessThanOrEqual(1);

		// THE PAN GOES ON THE SCROLLER'S CHILDREN. Stated as a property of the
		// DOM rather than of the source, because "which element carries it" is
		// the whole difference between an anchored zoom and a dead hit surface.
		expect(
			r.hostTransforms.some((t: string) => /translate/.test(t)),
			`${label}: the host itself is translated (${JSON.stringify(r.hostTransforms)}); it contains the scroller, so this is the input-death class`
		).toBe(false);
		expect(
			r.bandTransforms.some((t: string) => /translate/.test(t)),
			`${label}: the ink band is translated (${JSON.stringify(r.bandTransforms)}); syncCamera measures that box and would absorb it`
		).toBe(false);
	}
}, 600_000);

/**
 * CAN THE PEN STILL REACH THE NOTE WHERE THE ANCHORING PUT IT?
 *
 * The first attempt at this anchoring wrote the pan on the editor host, which
 * CONTAINS the scroller: the hit surface went with it, and a pointer at a fixed
 * client point landed outside the scroller entirely - measured then as "input
 * outside scroller 710,350" at 0.1 zoom. That is the low-zoom input-death
 * class, and it is not a thing to trade for an anchored zoom.
 *
 * Two questions, and both have to be answered by the DOM rather than by
 * reasoning about it: does a point inside the pane still hit the scroller while
 * the pan is live, and does a pen put down at the note's TRANSLATED position
 * reach the router and commit a stroke.
 */
it("a pen still reaches the note after a focal pan at low zoom", async () => {
	// Existing native scroll supplies legal residual pan at the natural origin.
	const r: any = await runArm(true, 1, "pinchPointer", false, false, 2000, 0.1);
	// eslint-disable-next-line no-console
	console.log(
		`POINTER ARM: sizer=${JSON.stringify(r.previewSizerTransform)} layer=${JSON.stringify(r.previewLayerTransform)} ` +
			`host=${JSON.stringify(r.previewHostTransform)} band=${JSON.stringify(r.previewBandTransform)} ` +
			`hitsScroller=${r.previewHitsScroller} hitFrames=${r.hitFrames}/${r.samples} ` +
			`penHit=${r.penHit} penStrokes=${r.penStrokes} scrollerLefts=${JSON.stringify(r.scrollerLefts)}`
	);
	// LIVENESS. A pan of zero proves nothing about a translated note being
	// reachable, and a gesture the overlay rejected has no pan at all.
	expect(r.pinchPreviewFrames, `no preview frame was entered; the gesture was rejected`).toBeGreaterThan(0);
	expect(r.pinchNow, `the pinch never took (pinchScaleNow=${r.pinchNow})`).toBeCloseTo(0.1, 2);
	expect(
		/translate/.test(r.previewSizerTransform),
		`no pan was written on .cm-sizer during the preview (${JSON.stringify(r.previewSizerTransform)}), so this arm is vacuous`
	).toBe(true);
	// THE HIT SURFACE. The scroller must not have moved and the focal point must
	// still land inside it.
	expect(r.scrollerLefts.length, `the scroller itself moved during the gesture: ${JSON.stringify(r.scrollerLefts)}`).toBe(1);
	expect(r.previewHitsScroller, `the focal point fell outside the scroller while the pan was live`).toBe(true);
	// THE ROUTER. A pen put down where the note now IS commits a stroke.
	expect(r.penHit, `a pen at the note's translated position landed outside the scroller`).toBe(true);
	expect(r.penStrokes, `the router received no stroke at the note's translated position`).toBe(1);
}, 300_000);

for(const mode of ['zoom','traverse','resize','scroll-zoom','scroll-fast','scroll-zero','retained-pan','retained-pan-immediate','retained-pan-bottom','far-mark','far-mark-fling','far-mark-immediate','far-mark-immediate-font'] as const)
// far-mark-immediate (the mark that lands before the band has followed the
// last scroll) is an ordinary arm: the band is carried under the locked frame
// (InkOverlay.carryBandUnderLock). far-mark-fling RUNS AS `fails` WHILE ITS DEFECT IS OPEN, the way the far
// lag arms did: it still executes and prints, and the gate goes red the day it
// passes so the guard is flipped back to an ordinary arm on purpose. What it
// measures on d66978ec: scroll events arriving DURING a contact are refused by
// syncBand (frame locked) and by the router's rect refresh, so the canvas sits
// short of the pane while the pen is down, no wet or committed ink lands at the
// pen, and the stored stroke is displaced by exactly the in-contact scroll
// (mapping error 311 px for 220 px scrolled on each axis). far-mark, the same
// sequence with the scroll settled one frame before the pen lands, stays an
// ordinary arm and is the liveness control.
(mode==='far-mark-fling'?it.fails:it)(`draws across the expanded right viewport: ${mode}`,async()=>{
 const page=await browser.newPage({viewport:{width:2400,height:1000},deviceScaleFactor:2});
 try{
  await page.setContent('<!doctype html><body style="margin:0"></body>');
  if(process.env.HW_DRAW_HOST_CSS)await page.addStyleTag({content:readFileSync(process.env.HW_DRAW_HOST_CSS,'utf8')});
  await page.addStyleTag({content:css+READABLE_LINE_WIDTH_CSS});await page.addScriptTag({content:script});
  const r=await page.evaluate(a=>(window as any).scrollColumnAnchor.runExpandedDrawCoverage(a.mode,true,a.capture,a.host),{mode,capture:!!process.env.HW_DRAW_SCREENSHOT,host:!!process.env.HW_DRAW_HOST_CSS});report.push(r);
  if(process.env.HW_DRAW_SCREENSHOT)await page.screenshot({path:process.env.HW_DRAW_SCREENSHOT+'-'+mode+'.png'});
  if(mode!=='retained-pan-immediate'){
   expect.soft(r.initial.canvas.right,`${mode} canvas covers visible editor right`).toBeGreaterThanOrEqual(r.initial.scroller.right-1);
   expect.soft(r.initial.canvas.bottom,`${mode} canvas covers visible editor bottom`).toBeGreaterThanOrEqual(r.initial.scroller.bottom-1);
  }
  for(const row of r.rows){
   expect.soft(row.during.canvas.right,`${mode} ${row.from} contact coverage right`).toBeGreaterThanOrEqual(row.during.scroller.right-1);
   // AGAINST THE PANE, NOT THE SCROLLER. A scroller left narrower than its
   // pane satisfies the line above while the reader's right-hand strip has
   // no canvas under it at all (Orion 2026-09-13: ink painted to 854 of a
   // 1007 px window, pen captured to 913).
   if(mode.startsWith('far-mark')){
    expect.soft(row.during.canvas.right,`${mode} ${row.from} contact coverage reaches the pane`).toBeGreaterThanOrEqual(row.during.pane.right-1);
    expect.soft(row.after.canvas.right,`${mode} ${row.from} settled coverage reaches the pane`).toBeGreaterThanOrEqual(row.after.pane.right-1);
    expect.soft(row.after.scroller.right,`${mode} ${row.from} scroller reaches the pane`).toBeGreaterThanOrEqual(row.after.pane.right-1);
    // Coverage THROUGHOUT the contact (F2-5), from the second move on: the
    // first move is the one that lands before the carry frame has run.
    for(const m of row.perMove.slice(1))expect.soft(m.right&&m.bottom,`${mode} ${row.from} coverage at move ${m.move}`).toBe(true);
    if(mode==='far-mark-immediate-font')expect.soft(row.fontZoom,`${mode} really ran at a font zoom`).toBeCloseTo(1.25,2);
    // eslint-disable-next-line no-console
    console.log(`CARRY ${mode} ${row.from} fontZoom ${row.fontZoom} calls ${row.carries.length} ms ${row.carries.map((n:number)=>n.toFixed(2)).join(',')}`);
   }
   expect.soft(row.during.canvas.bottom,`${mode} ${row.from} contact coverage bottom`).toBeGreaterThanOrEqual(row.during.scroller.bottom-1);
   expect.soft(row.hits.every((h:any)=>h.inScroller),`${mode} ${row.from} input targets`).toBe(true);
   expect.soft(row.added.length,`${mode} ${row.from} stored strokes`).toBe(1);
   expect.soft(row.savedPoints.length,`${mode} ${row.from} saved strokes`).toBe(1);
   expect.soft(row.mappingError,`${mode} ${row.from} physical note mapping`).not.toBeNull();
   expect.soft(row.mappingError,`${mode} ${row.from} physical note mapping`).toBeLessThan(.1);
   expect.soft(row.wet.reduce((n:number,s:any)=>n+s.pixels,0),`${mode} ${row.from} wet endpoint`).toBeGreaterThan(0);
   expect.soft(row.committed[2].pixels,`${mode} ${row.from} committed endpoint`).toBeGreaterThan(0);
  }
 }finally{await page.close();}
});

for (const readable of [false,true]) for (const infiniteCanvas of [false,true]) {
	for (const scenario of ['ordinary','negative','maximum','lazy','second','delayed','takeover'] as const) {
		it(`persistent focal marker: RLL=${readable} IC=${infiniteCanvas} ${scenario}`,async()=>{
			const page=await browser.newPage({viewport:{width:1800,height:900},deviceScaleFactor:2});
			try {
				await page.setContent('<!doctype html><body style="margin:0"></body>');
				await page.addStyleTag({content:css+READABLE_LINE_WIDTH_CSS});await page.addScriptTag({content:script});
				const r=await page.evaluate(a=>(window as any).scrollColumnAnchor.runFocal(a.readable,a.infiniteCanvas,true,a.scenario),{readable,infiniteCanvas,scenario});report.push({kind:'persistent-focal',...r});
				expect(r.holdRemaining, "settlement did not complete").toBe(false);
				expect(r.settleOutcome).toBe(scenario === "takeover" ? "cancelled" : "converged");
				expect(r.warnings).toEqual([]);
				for (const boundary of r.boundaries) { expect(boundary.afterTop).toBe(boundary.beforeTop); expect(boundary.afterPan).toEqual(boundary.beforePan); if (scenario !== "takeover" && boundary.held) expect(boundary.ready).toBe(true); }
				if (scenario === "delayed" || scenario === "takeover") expect(r.heldMeasures).toBeGreaterThan(0);
				if (scenario === "takeover") expect(r.takeoverDelta).toBeGreaterThan(0);
				for(const sample of r.samples) {
					expect(sample.connected).toBe(true);
					expect.soft(Math.abs(sample.driftX),`${sample.phase} x`).toBeLessThan(.5);
					expect.soft(Math.abs(sample.driftY),`${sample.phase} y`).toBeLessThan(.5);
				}
			} finally { await page.close(); }
		},120000);
	}
}

for (const readable of [false, true]) for (const infiniteCanvas of [false, true]) {
	it(`repeated centroid pan stays reachable: RLL=${readable} IC=${infiniteCanvas}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(a => (window as any).scrollColumnAnchor.runCentroidPan(a.readable, a.infiniteCanvas),
				{ readable, infiniteCanvas }); report.push(r);
			expect(r.unengagedClaimed).toBe(false); expect(r.unengagedDelta).toBe(0);
			expect(r.warnings).toEqual([]);
			for (const s of r.samples) {
				expect.soft(s.scale, s.phase).toBe(.25);
				expect.soft(s.overlapY, `${s.phase}: content left the pane`).toBeGreaterThanOrEqual(23.5);
				expect.soft(s.hitSurface, `${s.phase}: fixed hit surface lost`).toBe(true);
			}
			const phase = (name: string) => r.samples.find((s: any) => s.phase === name);
			expect(Math.abs(phase('down-3-650').contentTop), 'repeated pan exposes space above the note').toBeLessThan(.5);
			expect(phase('down-3-650').textOverlapY, 'no text remains at the vertical bound').toBeGreaterThan(0);
			// More downward gestures must stop accumulating at the same boundary.
			expect(Math.abs(phase('down-3-650').contentTop - phase('down-2-650').contentTop)).toBeLessThan(.5);
			expect(phase('saturated-reverse-75').contentTop - phase('down-3-650').contentTop, 'boundary reversal accumulates blocked movement').toBeCloseTo(-75, 1);
			expect(phase('saturated-recovered').contentTop - phase('down-3-650').contentTop, 'same gesture cannot recover after overshoot').toBeLessThan(-70);
			// A fresh reverse gesture must move immediately and recover usable space.
			expect(phase('reverse-575').contentTop - phase('reverse-start').contentTop).toBeCloseTo(-75, 1);
			expect(phase('reverse-500').contentTop - phase('reverse-start').contentTop).toBeCloseTo(-150, 1);
			for (const release of r.releases) { expect(release.outcome).toBe('converged'); expect(release.held).toBe(false); expect(Math.abs(release.syncJump)).toBeLessThan(.5); expect(Math.abs(release.jump)).toBeLessThan(.5); }
			expect(r.scrollDelta).toBeGreaterThan(100); expect(r.scrollPaintDelta).toBeCloseTo(-r.scrollDelta * .25, 1);
			expect(Math.abs(r.scrollReturnDelta)).toBeLessThan(.5);
			expect(r.penHit).toBe(true); expect(r.penStrokes).toBe(1); expect(r.originalUnchanged).toBe(true);
		} finally { await page.close(); }
	}, 120000);
}

for (const readable of [false, true]) for (const infiniteCanvas of [false, true]) for (const tiny of [false, true]) for (const external of !tiny && readable && infiniteCanvas ? [1, .75, 1.25] : [1]) {
	it(`top boundary preserves natural margin: RLL=${readable} IC=${infiniteCanvas} tiny=${tiny} external=${external}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(a => (window as any).scrollColumnAnchor.runTopBoundary(a.readable, a.infiniteCanvas, a.tiny, a.external), { readable, infiniteCanvas, tiny, external }); report.push(r);
			expect(r.naturalInset).toBeGreaterThanOrEqual(68 * external - .1);
			for (const row of r.rows) expect.soft(row.exposure, row.phase).toBeLessThan(.5);
			const phase = (name: string) => r.rows.find((s: any) => s.phase === name);
			for (const name of ['zoom-out', 'repeat-0-650', 'repeat-1-650', 'repeat-2-650']) expect.soft(Math.abs(phase(name).exposure), `${name}: natural margin changed`).toBeLessThan(.5);
			// A tiny note's minimum lower overlap used to conflict with the top
			// edge, leaving no legal upward movement with the canvas off. Zooming
			// out now grants the write frontier (`writeFrontierApplies`), so the
			// room below the text exists on a tiny note too and the reverse is
			// legal at every size. The top edge itself is still pinned, by the
			// exposure checks above.
			expect(phase('reverse-75').top - phase('repeat-2-650').top).toBeCloseTo(-75, 1);
			for (const release of r.releases) { expect.soft(Math.abs(release.syncJump), release.phase).toBeLessThan(.5); expect.soft(Math.abs(release.jump), release.phase).toBeLessThan(.5); expect(release.held).toBe(false); }
			if (!tiny) { expect(r.reachableDelta).toBeCloseTo(40, 1); expect(r.anchorUnchanged).toBe(true); expect(phase('pending-settled').exposure).toBeCloseTo(-75, 1); }
		} finally { await page.close(); }
	}, 120000);
}

for (const axis of ['left', 'corner'] as const) for (const readable of [false, true]) for (const infiniteCanvas of [false, true]) for (const tiny of [false, true]) for (const external of !tiny && readable && infiniteCanvas ? [1, .75, 1.25] : [1]) {
	it(`natural left/top bounds: ${axis} RLL=${readable} IC=${infiniteCanvas} tiny=${tiny} external=${external}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(a => (window as any).scrollColumnAnchor.runTopBoundary(a.readable, a.infiniteCanvas, a.tiny, a.external, a.axis), { readable, infiniteCanvas, tiny, external, axis }); report.push(r);
			expect(r.naturalLeft).toBeGreaterThanOrEqual((tiny ? 12 : readable ? 300 : 0) * external - .1);
			expect(r.naturalInset).toBeGreaterThanOrEqual(68 * external - .1);
			expect(r.inkUnchanged).toBe(true);
			for (const row of r.rows) {
				expect.soft(row.exposureX, `${row.phase}: left exposure`).toBeLessThan(.5);
				expect.soft(row.exposure, `${row.phase}: top exposure`).toBeLessThan(.5);
			}
			const phase = (name: string) => r.rows.find((s: any) => s.phase === name);
			for (const name of ['zoom-out', 'repeat-0-650', 'repeat-1-650', 'repeat-2-650']) expect.soft(Math.abs(phase(name).exposureX), `${name}: natural left margin changed`).toBeLessThan(.5);
			expect(phase('reverse-75').left - phase('repeat-2-650').left).toBeCloseTo(tiny && !infiniteCanvas ? 0 : -75, 1);
			// Vertically the tiny note now has the zoomed-out write frontier's
			// room below its text, so the reverse is legal at every size; the LEFT
			// bound above is untouched by that grant and keeps its tiny case.
			if (axis === 'corner') expect(phase('reverse-75').top - phase('repeat-2-650').top).toBeCloseTo(-75, 1);
			for (const release of r.releases) {
				for (const key of ['syncJump', 'jump', 'syncJumpX', 'jumpX']) expect.soft(Math.abs(release[key]), `${release.phase}: ${key}`).toBeLessThan(.5);
				expect(release.held).toBe(false);
			}
			if (!tiny) {
				expect(phase('reachable-start').scrollLeft).toBeGreaterThan(100);
				expect(r.reachableX).toBeCloseTo(40, 1); expect(r.anchorUnchanged).toBe(true);
				expect(phase('pending-settled').exposureX).toBeCloseTo(-75, 1);
				if (axis === 'corner') { expect(r.reachableDelta).toBeCloseTo(40, 1); expect(phase('pending-settled').exposure).toBeCloseTo(-75, 1); }
			}
		} finally { await page.close(); }
	}, 120000);
}

for (const target of [.25, 2]) for (const moving of [false, true]) for (const external of [1, .75, 1.25]) {
	it(`pen hover reticle stays under tip during pinch: zoom=${target} moving=${moving} external=${external}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(a => (window as any).scrollColumnAnchor.runPinchReticle(a.target, a.moving, a.external), { target, moving, external }); report.push(r);
			expect(r.strokes).toBe(0);
			for (const row of r.rows.filter((s: any) => s.phase !== 'leave')) {
				expect.soft(row.visible, row.phase).toBe(true);
				expect.soft(Math.abs(row.errorX), row.phase).toBeLessThan(.5); expect.soft(Math.abs(row.errorY), row.phase).toBeLessThan(.5);
			}
			expect(r.rows.at(-1).visible).toBe(false); expect(r.cursorRemoved).toBe(true);
		} finally { await page.close(); }
	}, 120000);
}

for (const readable of [false, true]) for (const infiniteCanvas of [false, true]) for (const zoom of [.1, 1]) for (const mode of ['native', 'pinch'] as const) for (const seeded of mode === 'native' && infiniteCanvas && zoom === .1 ? [false, true] : [false]) for (const cadence of mode === 'pinch' && infiniteCanvas && zoom === .1 && readable ? ['frame', 'pending', 'zero'] : ['frame']) {
	it(`right/down expansion without toggle: RLL=${readable} IC=${infiniteCanvas} zoom=${zoom} ${mode} ink=${seeded} cadence=${cadence}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(a => (window as any).scrollColumnAnchor.runInfiniteTraversal(a.readable, a.infiniteCanvas, a.zoom, a.mode, a.seeded, a.cadence), { readable, infiniteCanvas, zoom, mode, seeded, cadence }); report.push(r);
			expect(r.strokes).toBe(seeded ? 1 : 0); expect(r.inkUnchanged).toBe(true);
			if (seeded) expect(r.rows.at(-1).resizeCalls - r.initial.resizeCalls).toBeGreaterThan(0);
			if (infiniteCanvas) {
				if (mode === 'native') { expect.soft(r.initial.width - r.initial.clientWidth, 'initial horizontal range').toBeGreaterThan(100 / zoom); expect(r.initial.overflowX).toBe('auto'); }
				for (const row of r.rows.filter((s: any) => s.phase.endsWith('-done'))) expect.soft(row.travel, row.phase).toBeGreaterThan(mode === 'pinch' ? 790 : 100);
				if (mode === 'pinch') for (const row of r.rows.filter((s: any) => s.phase.endsWith('-done'))) {
					expect.soft(Math.abs(row.pan.x), `${row.phase}: native X did not absorb pan`).toBeLessThan(.5);
					expect.soft(Math.abs(row.pan.y), `${row.phase}: native Y did not absorb pan`).toBeLessThan(.5);
				}
			} else {
				expect(r.rows.at(-1).grant).toEqual(r.initial.grant);
				if (mode === 'native') expect(r.rows.filter((s: any) => s.phase.startsWith('x-')).every((s: any) => s.left === 0)).toBe(true);
			}
			for (const row of r.rows.filter((s: any) => s.phase.endsWith('-after'))) {
				expect.soft(Math.abs(row.jumpX - row.expectedJumpX), row.phase).toBeLessThan(.5); expect.soft(Math.abs(row.jumpY - row.expectedJumpY), row.phase).toBeLessThan(.5);
			}
		} finally { await page.close(); }
	}, 120000);
}

// Room to write below the text on a note nobody has inked, once it is zoomed
// out. Two document heights: 20 lines is Alan's note, which nearly fits the
// screen at 10%, and 400 is the tall document the rest of this fixture uses.
for (const zoom of [.1, 1]) for (const lines of [20, 400]) {
	it(`zoomed-out write room, unwritten note: zoom=${zoom} lines=${lines}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(a => (window as any).scrollColumnAnchor.runZoomedWriteRoom(a.readable, a.infiniteCanvas, a.zoom, a.lines), { readable: true, infiniteCanvas: false, zoom, lines }); report.push(r);
			expect(r.strokes).toBe(0); expect(r.scale).toBe(zoom);
			if (zoom === 1) {
				// Untouched at 1.0: a typing-only vault keeps the extent it has today.
				expect(r.zoomed.grant).toEqual({ x: 0, y: 0 });
				expect(r.zoomed.range).toBe(r.startup.range);
			} else {
				expect(r.zoomed.grant.y).toBeGreaterThan(0);
				// The room is the write frontier's: 0.75 of a SCREENFUL past the
				// document bottom, and zoomed out the screenful is the
				// counter-sized scroller's own client box - not the takeover
				// pane, which is a tenth of it here and buys ~60 visual px.
				// The 20-line note has no scroll range at all before this.
				expect(r.zoomed.range).toBeGreaterThanOrEqual(.75 * r.zoomed.clientHeight - 2);
				// Granted is not the same as reachable: a native scroll to the end
				// must actually land on it.
				expect(r.scrolled.top).toBe(r.zoomed.range);
			}
		} finally { await page.close(); }
	}, 120000);
}

for (const mode of ['coalesced', 'pending', 'scale', 'mixed', 'corner'] as const) {
	it(`constraint input order: ${mode}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(mode => (window as any).scrollColumnAnchor.runConstraintOrder(mode), mode); report.push(r);
			const phase = (name: string) => r.rows.findLast((s: any) => s.phase === name);
			expect(r.anchorUnchanged).toBe(true); expect(r.release.outcome).toBe('converged'); expect(r.release.held).toBe(false);
			const dy = mode === 'scale' ? -100 : mode === 'mixed' ? -175 : -75;
			expect(phase('immediate').y - r.before.y).toBeCloseTo(dy, 1);
			expect(phase('settled').y - r.before.y).toBeCloseTo(dy, 1);
			expect(r.last.y - r.before.y).toBeCloseTo(mode === 'pending' ? 0 : dy, 1);
			if (mode === 'corner') {
				expect(r.before.x).toBeCloseTo(r.naturalLeftBoundary, 1);
				expect(phase('settled').x - r.before.x).toBeCloseTo(-75, 1);
			}
			for (const row of r.rows) expect(row.scale).toBe(.25);
		} finally { await page.close(); }
	}, 120000);
}

for (const [zoom, scroll, infiniteCanvas, cadence] of [[.1,true,true,'immediate'],[.1,false,true,'immediate'],[1,true,true,'immediate'],[.1,true,true,'frame'],[.1,true,true,'settled'],[.1,true,false,'immediate']] as const) {
	it(`scroll then draw work: zoom=${zoom} scroll=${scroll} IC=${infiniteCanvas} cadence=${cadence}`,async()=>{
		const page=await browser.newPage({viewport:{width:1800,height:1000},deviceScaleFactor:2});
		try{
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({content:css+READABLE_LINE_WIDTH_CSS});await page.addScriptTag({content:script});
			const r=await page.evaluate(a=>(window as any).scrollColumnAnchor.runScrollDraw(a.zoom,a.scroll,a.infiniteCanvas,a.cadence),{zoom,scroll,infiniteCanvas,cadence});report.push(r);
			expect(r.strokes).toBe(r.cycles+r.seedCount);expect(r.savedStrokes).toBe(r.strokes);expect(r.originalUnchanged).toBe(true);expect(r.roundtrip).toBe(true);expect(r.idsUnique).toBe(true);
			for(const p of r.points){expect(p.count).toBeGreaterThan(3);expect(p.finite).toBe(true);expect(new Set(p.pressures).size).toBeGreaterThan(1);}
			// Prove the scroll arm actually moves at the requested zoom.
			for(const row of r.rows)if(scroll)expect.soft(row.scrollAfter-row.scrollBefore,`cycle${row.cycle} live scroll`).toBeGreaterThan(100/zoom);
			expect(r.pendingRaf).toBe(0);expect(r.queued).toBe(false);expect(r.bandSyncDeferred).toBe(false);
			// Fixed viewport band movement must not reallocate canvas backing stores.
			for(const row of r.rows) {
				expect.soft(row.work.reallocations).toBe(0);
				expect.soft(row.frameBlue.inside,`cycle${row.cycle} canvas coverage`).toBe(true);
				for(const pixels of row.frameBlue.thirds)expect.soft(pixels,`cycle${row.cycle} latest stroke segment`).toBeGreaterThan(0);
			}
		}finally{await page.close();}
	},120000);
}

for (const ending of ['abandon','switch','destroy'] as const) {
	it(`deferred scroll band lifecycle: ${ending}`,async()=>{
		const page=await browser.newPage({viewport:{width:1800,height:1000},deviceScaleFactor:2});
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({content:css+READABLE_LINE_WIDTH_CSS});await page.addScriptTag({content:script});
			const r=await page.evaluate(ending=>(window as any).scrollColumnAnchor.runScrollDraw(.1,true,true,'immediate',4,ending),ending);report.push(r);
			expect(r.lifecycle.beforeDeferred).toBe(true);
			expect(r.lifecycle.afterResetDeferred).toBe(false);
			expect(r.lifecycle.afterDeferred).toBe(false);
			expect(r.lifecycle.locked).toBe(false);expect(r.lifecycle.queued).toBe(false);
			expect(r.lifecycle.unchangedMemory).toBe(true);expect(r.lifecycle.unchangedSidecar).toBe(true);
			expect(r.lifecycle.mounted).toBe(ending!=='destroy');
			if(ending!=='destroy')expect(r.lifecycle.covered).toBe(true);
		} finally { await page.close(); }
	},120000);
}

for (const mode of ['destroy', 'remove'] as const) {
	it(`a pinch preview torn down mid-gesture gives CodeMirror its measuring back: ${mode}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(m => (window as any).scrollColumnAnchor.runPinchTeardown(m), mode); report.push(r);
			expect(r.before).toEqual({ requestMeasure: false, measure: false });
			expect(r.preview.pinchPreview, 'no preview was live at teardown').toBe(true);
			expect(r.preview.own, 'the preview did not hold both entries').toEqual({ requestMeasure: true, measure: true });
			expect(r.after.own, `${mode} left the hold on the view`).toEqual({ requestMeasure: false, measure: false });
			if (mode === 'remove') expect(r.measuresAgain, 'CodeMirror did not measure again after the plugin left').toBe(true);
		} finally { await page.close(); }
	}, 120000);
}

for (const readable of [false, true]) for (const infiniteCanvas of [false, true]) for (const external of [1, .75]) {
	it(`frozen column follows resize and theme: RLL=${readable} IC=${infiniteCanvas} external=${external}`, async () => {
		const page = await browser.newPage({ viewport: { width: 2000, height: 1000 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS });
			await page.addScriptTag({ content: script });
			const r = await page.evaluate(a => (window as any).scrollColumnAnchor.runColumnChanges(a.readable, a.infiniteCanvas, a.external), { readable, infiniteCanvas, external });
			report.push(r);
			expect(r.samples.map((s: any) => s.phase)).toEqual(['initial', 'wider', 'theme-cap']);
			for (const s of r.samples) expect.soft(Math.abs(s.actual - s.expected), `${s.phase}: ${JSON.stringify(s)}`).toBeLessThan(.5);
		} finally { await page.close(); }
	});
}

for (const input of ['scrollImmediate','wheel','pen','keyboard','zoom','switch','destroy','pinch'] as const) {
	it(`settle callback is retired by ${input}`, async () => {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(input => (window as any).scrollColumnAnchor.runFocal(true, false, true, 'delayed', input), input); report.push(r);
			expect(r.heldMeasures).toBeGreaterThan(0);
			expect(r.cancellation.heldBefore).toBe(true);
			if (input === "pen") expect(r.strokes).toBeGreaterThan(2);
			if (input !== "scrollImmediate") expect(r.cancellation.revoked).toBe(true);
			expect(r.cancellation.revokedAfter).toBe(true);
			expect(r.cancellation.after).toEqual(r.cancellation.baseline);
			if (['wheel','pen','keyboard'].includes(input)) expect(r.cancellation.baseline.pan).toEqual(r.cancellation.panBefore);
		} finally { await page.close(); }
	}, 120000);
}

for (const external of [1, .75]) it(`aligned flex column uses live fallback: external=${external}`, async () => {
	const page = await browser.newPage({ viewport: { width: 2000, height: 1000 }, deviceScaleFactor: 2 });
	try {
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
		const r = await page.evaluate(external => (window as any).scrollColumnAnchor.runColumnChanges(true, false, external, true), external); report.push(r);
		for (const sample of r.samples) { expect.soft(sample.layoutColumn, sample.phase).toBeNull(); expect.soft(Math.abs(sample.cameraError), sample.phase).toBeLessThan(.5); }
	} finally { await page.close(); }
}, 120000);

it('navigation between settle read and write survives', async () => {
	const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
	try {
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
		const r = await page.evaluate(() => (window as any).scrollColumnAnchor.runFocal(true, false, true, 'ordinary', 'scrollReadWrite')); report.push(r);
		expect(r.readWriteGap).not.toBeNull(); expect(r.readWriteGap.delta).toBeGreaterThan(0);
		expect(r.readWriteGap.after).toEqual(r.readWriteGap.baseline); expect(r.holdRemaining).toBe(false);
	} finally { await page.close(); }
}, 120000);

it('navigation after CM measurement survives queued compensation', async () => {
	const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
	try {
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
		const r = await page.evaluate(() => (window as any).scrollColumnAnchor.runFocal(true, false, true, 'delayed', 'postMeasure')); report.push(r);
		expect(r.postMeasureGap).not.toBeNull(); expect(r.postMeasureGap.delta).toBeGreaterThan(0);
		expect(r.postMeasureGap.after).toEqual(r.postMeasureGap.baseline);
	} finally { await page.close(); }
}, 120000);

for (const input of ['missing','nonfirst'] as const) it(`settle disables late correction when scroll consumer is ${input}`, async () => {
	const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
	try {
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
		const r = await page.evaluate(input => (window as any).scrollColumnAnchor.runFocal(true, false, true, 'delayed', input), input); report.push(r);
		expect(r.consumerFirst).toBe(false); expect(r.heldMeasures).toBe(0);
		expect(r.cancellation.revokedAfter).toBe(true); expect(r.cancellation.after).toEqual(r.cancellation.baseline);
		if (input === 'missing') expect(r.consumerNames).not.toContain('consumeViewportScroll');
		else { expect(r.consumerNames).toContain('consumeViewportScroll'); expect(r.consumerNames[0]).not.toBe('consumeViewportScroll'); }
	} finally { await page.close(); }
}, 120000);

for (const mode of ['unchanged','mapped','foreign','editOnly','deleteWhole','replaceWhole','multiple','newBinding','cancelAfterMap','newInput','foreignAfterMap','clipForeign','staleBounds'] as const) it(`owned public request cancellation gate: ${mode}`, async () => {
	const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
	try {
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
		const r = await page.evaluate(mode => (window as any).scrollColumnAnchor.runOwnedRequestCancellation(mode), mode); report.push(r);
		expect(r.position).toBeGreaterThan(0);
		if (mode === 'staleBounds') { expect(r.refused).toBe(true); return; }
		expect(r.selectionAfter).toEqual(r.selectionBefore);
		for (const check of r.semantics) { expect(check.wrapped).toEqual(check.original); for (const key of ['equal','unchangedIdentity','originalUntagged','samePrototype','extendEqual','mappedOwned']) if (key in check) expect(check[key]).toBe(true); }
		if (mode === "editOnly") { expect(r.observations).toHaveLength(0); expect(Math.abs(r.topAfter - r.topBefore)).toBeLessThan(100); return; }
		expect(r.observations).toHaveLength(1);
		if (mode === 'unchanged') { expect(r.observations[0].originalIdentity).toBe(true); expect(r.topAfter).toBe(r.topBefore); }
		else if (mode === 'foreign' || mode === 'foreignAfterMap' || mode === 'clipForeign') {
			expect(r.observations[0].rangeOwned).toBe(false);
			if (mode === 'foreign') expect(r.observations[0].foreignIdentity).toBe(true);
			if (mode !== 'clipForeign') expect(r.observations[0].mappedShape).toBe(true);
			else expect(r.observations[0].head).toBe(r.docLength);
			expect(Math.abs(r.topAfter - r.topBefore)).toBeGreaterThan(10);
		} else {
			expect(r.observations[0].rangeOwned).toBe(true); expect(r.observations[0].cancelled).toBe(true);
			expect(r.observations[0].head).toBeGreaterThanOrEqual(0); expect(r.observations[0].head).toBeLessThanOrEqual(r.docLength);
			if (mode === 'newInput') expect(r.inputRevoked).toBe(true);
			if (mode === 'newBinding') expect(r.binding).toMatch(/-next\.md$/);
		}
	} finally { await page.close(); }
}, 120000);

for (const input of ['remove','recreate','reconfigureAll','mappedRemove','foreignReplace','setState'] as const) it(`pending owned scroll survives extension ${input}`, async () => {
	const results: any[] = [];
	for (const mode of [input, `${input}Control`]) {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
		try {
			await page.setContent('<!doctype html><body style="margin:0"></body>');
			await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
			const r = await page.evaluate(mode => (window as any).scrollColumnAnchor.runFocal(true, false, true, 'delayed', mode), mode); report.push(r); results.push(r);
			expect(r.heldMeasures).toBeGreaterThan(0); expect(r.cancellation.heldBefore).toBe(true); expect(r.cancellation.revokedAfter).toBe(true);
		} finally { await page.close(); }
	}
	for (const r of results) {
		expect(r.cancellation.consumerAfterCleanup).not.toContain('consumeViewportScroll');
		expect(r.cancellation.extendersAfterCleanup).toBe(0);
	}
	if (input === 'foreignReplace' || input === 'setState') {
		for (const axis of ['left','top']) expect(results[0].cancellation.drained[axis]).toBe(results[1].cancellation.drained[axis]);
		if (input === 'foreignReplace') expect(Math.abs(results[0].cancellation.drained.top - results[0].cancellation.baseline.top)).toBeGreaterThan(100);
	} else {
		// Consuming a canceled target preempts CM's automatic anchor for that
		// cycle. It preserves the current position; the no-target control may
		// apply its own reflow adjustment. Do not label those paths identical.
		expect(results[0].cancellation.drained).toEqual(results[0].cancellation.baseline);
		expect(results[1].cancellation.drained.left).toBe(results[1].cancellation.baseline.left);
		if (input !== 'recreate') expect(results[1].cancellation.consumerBeforeCleanup).not.toContain('consumeViewportScroll');
	}
}, 120000);

it('nonconverging owned geometry terminates as failure', async () => {
	const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
	try {
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		await page.addStyleTag({ content: css + READABLE_LINE_WIDTH_CSS }); await page.addScriptTag({ content: script });
		const r = await page.evaluate(() => (window as any).scrollColumnAnchor.runFocal(true, false, true, 'ordinary', 'nonconverging')); report.push(r);
		expect(r.settleOutcome).toBe('failed'); expect(r.holdRemaining).toBe(false); expect(r.settleAttempts).toBe(4);
		expect(r.warnings).toEqual(['Pinch geometry did not converge']); expect(r.boundaries).toHaveLength(1);
		expect(r.boundaries[0].consumed).toBe(true); expect(r.boundaries[0].afterTop).toBe(r.boundaries[0].beforeTop); expect(r.boundaries[0].afterPan).toEqual(r.boundaries[0].beforePan);
	} finally { await page.close(); }
}, 120000);
