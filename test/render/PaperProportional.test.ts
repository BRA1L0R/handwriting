/**
 * Contract cell 1 (cells 2 and 3, and the "mounted at a zoomed font" /
 * "reload while zoomed" arms, are covered in the other paper files). Written
 * against cc62734a: the paper must scale with
 * the SAME factor as the ink (cssScale x fontZoom) - today the pitch ignores
 * fontZoom entirely (InkOverlay.ts's own comment: "Font size does not scale
 * CSS backgrounds, so the font zoom is not in it").
 *
 * THE RATIO IS paperFontScale = font-size / 16, ABSOLUTE - never line height.
 * Two independent reasons, both real, not just a fixture accident: (1) this
 * harness's own theme pins `.cm-content` line-height to a fixed 24px at every
 * font size (noteViewportCameraPage.ts's `setup()`), so a line-height read
 * here would not move at all; (2) even in real Obsidian, text line-height is
 * 1.5 x font-size (24px at 16px) while the paper's 28px pitch is an
 * independent design constant that never matched either number - so "scale
 * with the text" can only mean the font-SIZE ratio, not a height comparison
 * that was never equal to begin with. Measured the same way the overlay
 * itself measures fontZoom: `fontZoomFactor(fontSize, refFontPx)`
 * (InkOverlay.ts:3632) is fontSize-only, so this cell's proxy for "the text
 * grew" - ten monospace characters' own glyph width - is exactly that ratio,
 * not an approximation of it.
 *
 * Reuses the existing camera fixture - `viewportFixture.setup`/`edgeAudit.
 * commit` drive the real overlay; every assertion here is computed style,
 * never an internal field, so the cell does not depend on how the fix is
 * implemented.
 *
 * 1a: a LIVE font-zoom-only change (16px -> 20px, no pinch) scales lined,
 *     grid and dots paper by exactly that font-size ratio (1.25x: pitch 28
 *     -> 35, rule and dot size x1.25) - the premise (the text itself grew by
 *     that ratio) is asserted first, via glyph width, before any paper claim.
 * 1b: MOUNTED directly at font 1.25 (20px, no live change), commit z 0.5 ->
 *     35 x 0.5 = 17.5 screen px, all three styles. Deliberately mount-time,
 *     not built up from a live change: this is the "mounted at an
 *     already-zoomed font" case, which a mount-relative (rather than
 *     absolute font/16) implementation would get wrong.
 */
import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import css from "../../styles.css?raw";

let browser: Browser, script: string;
const OBSIDIAN_CAMERA_CSS = readFileSync(fileURLToPath(new URL("./noteViewportCamera.css", import.meta.url)), "utf8");

beforeAll(async () => {
	const b = await build({
		entryPoints: [fileURLToPath(new URL("./noteViewportCameraPage.ts", import.meta.url))],
		bundle: true, write: false, format: "iife", platform: "browser",
		alias: { obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)) },
	});
	script = b.outputFiles[0]!.text;
	browser = await chromium.launch({ headless: true });
}, 180_000);

afterAll(async () => { await browser?.close(); });

/** The fixture's own default text (NOT an empty doc): this cell measures
 * glyph WIDTH growth, which needs real characters on the line. `kind` selects
 * the body class; `font` is the mount-time font multiplier `setup` already
 * takes (its own `.cm-content` fontSize is `16 * font`px). One far ink stroke
 * (the "far" kind) so Fit has something to frame, matching the other paper
 * cells' convention - irrelevant to this cell but harmless. */
async function mountPaper(p: Page, kind: "lines" | "grid" | "dots", font = 1, id = "paper") {
	await p.setContent(`<!doctype html><body class="handwriting-paper-${kind}" style="margin:0; background:#ffffff; --background-modifier-border:#777777"></body>`);
	await p.addStyleTag({ content: css + OBSIDIAN_CAMERA_CSS });
	await p.addScriptTag({ content: script });
	await p.evaluate(({ id, font }) => (window as any).viewportFixture.setup(id, "far", font), { id, font });
}

/** The on-screen WIDTH of the first 10 characters of text, read fresh each
 * call (no caching, so a live font change is reflected).
 *
 * NOT the `.cm-line` element's own box, and NOT line HEIGHT:
 *  - the fixture's own theme pins `.cm-content`'s line-height to a fixed
 *    24px regardless of fontSize (noteViewportCameraPage.ts's `setup()`,
 *    `lineHeight:"24px"`, never `${font}`-scaled) - that pin exists for this
 *    fixture's own layout stability and is orthogonal to the paper question,
 *    so asserting on it would fail the premise for a reason that has
 *    nothing to do with the code under test.
 *  - the fixture wraps text at a fixed 640 LAYOUT px content width
 *    (`EditorView.lineWrapping` + the theme's `width:"640px"`), so the
 *    rendered `.cm-line` BOX width stays clamped to that container - a
 *    bigger font fits fewer characters per visual line, not a wider box.
 * A `Range` over the first 10 characters of the (monospace) text sidesteps
 * both: `fontZoom` itself is measured from fontSize alone (InkOverlay.ts's
 * `fontZoomFactor(fontSize, refFontPx)`), and ten monospace characters' own
 * advance width scales with it directly, well inside the wrap width at every
 * font size this cell uses. */
const glyphSpanWidthPx = (p: Page): Promise<number> =>
	p.evaluate(() => {
		const line = document.querySelector(".camera-proof .cm-line")!;
		// Walk to the first real text node rather than assuming `firstChild` is
		// one - robust whether the line renders as a bare text node or wraps it
		// in a span.
		const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
		const textNode = walker.nextNode() as Text | null;
		if (!textNode) throw new Error("no text node found in the first .cm-line - the fixture's default doc changed shape");
		const range = document.createRange();
		range.setStart(textNode, 0);
		range.setEnd(textNode, Math.min(10, textNode.length));
		return range.getBoundingClientRect().width;
	});

/** Lined/grid paper's pitch and rule in LAYOUT px, straight off the custom
 * properties `updatePaperSpacing` writes on `.cm-editor` - never an internal
 * field, just the two CSS variables the gradients themselves consume. */
const readPitchRuleLayout = (p: Page): Promise<{ pitchLayout: number; ruleLayout: number }> =>
	p.evaluate(() => {
		const host = document.querySelector(".cm-editor") as HTMLElement;
		return {
			pitchLayout: Number.parseFloat(host.style.getPropertyValue("--handwriting-paper-pitch")) || 28,
			ruleLayout: Number.parseFloat(host.style.getPropertyValue("--handwriting-paper-rule")) || 1,
		};
	});

/** Dots carry no custom property today (styles.css: `background-size: 28px
 * 28px`, fixed) - the rendering claim is the computed `background-size`
 * itself, in the scroller's own layout px (the zoomed ancestor scales the
 * whole visual result, exactly as it does for the gradient-based styles). */
const readDotsSizeLayout = (p: Page): Promise<{ w: number; h: number }> =>
	p.evaluate(() => {
		const s = getComputedStyle(document.querySelector(".cm-scroller")!).backgroundSize;
		const [w, h] = s.split(" ").map(v => Number.parseFloat(v));
		return { w: w ?? 28, h: h ?? 28 };
	});

const setFontSizePx = (p: Page, px: number): Promise<void> =>
	p.evaluate(px => {
		const el = document.querySelector(".camera-proof .cm-content") as HTMLElement;
		el.style.fontSize = `${px}px`;
	}, px).then(() => p.evaluate(() => (window as any).viewportFixture.settle()));

it("1a: a live font-zoom-only change scales lined, grid and dots paper by the text's own growth factor", async () => {
	for (const kind of ["lines", "grid", "dots"] as const) {
		const p = await browser.newPage();
		try {
			await mountPaper(p, kind, 1);
			await p.evaluate(() => (window as any).edgeAudit.commit("paper", 1));
			const before = kind === "dots" ? await readDotsSizeLayout(p) : await readPitchRuleLayout(p);
			const lineBefore = await glyphSpanWidthPx(p);

			// LIVE font-zoom change, no pinch: 16px -> 20px (1.25x), a plain
			// style write plus a settle - the same shape a real ctrl+wheel
			// takes (it resizes `.cm-content`, which fires contentResizeObserver
			// into `fontZoomFactor`, InkOverlay.ts:3632).
			await setFontSizePx(p, 20);

			const lineAfter = await glyphSpanWidthPx(p);
			const lineRatio = lineAfter / lineBefore;
			// PREMISE: the text itself really did grow before any paper claim.
			expect(lineRatio, `[${kind}] premise failed - line width did not grow (before=${lineBefore}, after=${lineAfter})`).toBeCloseTo(1.25, 1);

			if (kind === "dots") {
				const after = await readDotsSizeLayout(p);
				const wRatio = after.w / (before as { w: number; h: number }).w;
				const hRatio = after.h / (before as { w: number; h: number }).h;
				expect(wRatio, `[dots] background-size width did not scale with the text (before=${(before as any).w} after=${after.w} lineRatio=${lineRatio})`).toBeCloseTo(lineRatio, 1);
				expect(hRatio, `[dots] background-size height did not scale with the text (before=${(before as any).h} after=${after.h} lineRatio=${lineRatio})`).toBeCloseTo(lineRatio, 1);
			} else {
				const after = await readPitchRuleLayout(p);
				const pitchRatio = after.pitchLayout / (before as { pitchLayout: number; ruleLayout: number }).pitchLayout;
				const ruleRatio = after.ruleLayout / (before as { pitchLayout: number; ruleLayout: number }).ruleLayout;
				expect(pitchRatio, `[${kind}] pitch did not scale with the text (before=${(before as any).pitchLayout} after=${after.pitchLayout} lineRatio=${lineRatio})`).toBeCloseTo(lineRatio, 1);
				expect(ruleRatio, `[${kind}] rule did not scale with the text (before=${(before as any).ruleLayout} after=${after.ruleLayout} lineRatio=${lineRatio})`).toBeCloseTo(lineRatio, 1);
			}
		} finally {
			await p.close();
		}
	}
});

it("1b: combined pinch x font at rest - commit z 0.5 with font already at 1.25x gives 17.5 screen px spacing, all three styles", async () => {
	const z = 0.5, expectedScreen = 17.5; // 28 * 0.5 * 1.25
	for (const kind of ["lines", "grid", "dots"] as const) {
		const p = await browser.newPage();
		try {
			await mountPaper(p, kind, 1.25);
			// Sanity the mount-time font actually landed before trusting the
			// paper claim on top of it.
			const fontSizePx = await p.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector(".camera-proof .cm-content")!).fontSize));
			expect(fontSizePx, `[${kind}] mount-time font did not reach 1.25x (16px base): got ${fontSizePx}px`).toBeCloseTo(20, 0);

			await p.evaluate(z => (window as any).edgeAudit.commit("paper", z), z);

			if (kind === "dots") {
				const { w, h } = await readDotsSizeLayout(p);
				expect(w * z, `[dots] screen background-size width: layout=${w} z=${z}`).toBeCloseTo(expectedScreen, 0);
				expect(h * z, `[dots] screen background-size height: layout=${h} z=${z}`).toBeCloseTo(expectedScreen, 0);
			} else {
				const { pitchLayout } = await readPitchRuleLayout(p);
				const screen = pitchLayout * z;
				expect(screen, `[${kind}] screen pitch: layout=${pitchLayout} z=${z}`).toBeCloseTo(expectedScreen, 0);
			}
		} finally {
			await p.close();
		}
	}
});
