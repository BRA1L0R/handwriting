/**
 * A HOST THAT ALREADY CARRIES A ZOOM BEFORE THE VIEWPORT TAKES IT OVER.
 *
 * `zoom` is ONE property. The zoom write path sets it to the requested k, so
 * on a host whose `.cm-editor` already has `zoom: 1.25` from a theme stylesheet
 * (or an inline style), that 1.25 is not composed with - it is replaced. The
 * transform fallback has no such problem: a stylesheet zoom and a scale
 * transform compose, so the fallback arm keeps the theme's factor whatever the
 * overlay writes.
 *
 * That asymmetry is the whole cell. Both arms are asked for the same camera:
 *
 *   theme zoom 1.25, requested k 0.1  ->  effective 0.125 on BOTH paths
 *
 * and the host's own SCREEN box must come out of the takeover the size it went
 * in at, on both. The counter-sized width the overlay writes (`layout.width /
 * k`) is in the host's own unzoomed units, so only a zoom of baseZoom * k
 * returns it to the box it had; a zoom of k alone divides that box by the
 * theme's factor while the camera still believes it is showing all of it.
 *
 * The natural box is MEASURED rather than assumed: a third arm mounts the same
 * fixture at k 1, where no takeover runs, and the two k-0.1 arms are held to
 * the width it reads. The fixture pins `.cm-editor` to an explicit
 * `width: <pane>px` in the editor's own units (its `EditorView.theme`), so a
 * host under `zoom: 1.25` is 1.25 panes wide on screen and clipped - assuming
 * a host that fills the pane would have written the wrong number here.
 *
 * The same-scale control below runs the identical mount with no theme zoom, so
 * a cell that went green by breaking the ordinary case cannot hide here.
 *
 * The transform arm is forced exactly the way `ZoomHitTestParityCells` forces
 * it (stub `CSS.supports` before the bundle loads), and each arm reads the
 * host's computed `zoom` back so a stub that did not take is visible rather
 * than silently comparing a path against itself.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
let browser: Browser, bundle: string;

beforeAll(async () => {
	browser = await chromium.launch({ headless: true });
	bundle = (await build({
		entryPoints: [root + "test/render/scrollColumnAnchorPage.ts"], bundle: true, write: false, format: "iife", platform: "browser",
		alias: { obsidian: root + "test/render/iphoneObsidianStub.ts" },
	})).outputFiles[0]!.text;
}, 180_000);

afterAll(async () => {
	await browser?.close();
});

const PANE = { w: 945, h: 834, dpr: 2 };
const THEME_ZOOM = 1.25;
const K = 0.1;

/**
 * `blocked` is the second shape of a pre-existing host zoom: the host's own
 * factor is INLINE and `!important`, and the sheet declares a competing
 * `zoom: 1 !important`. The overlay's product write is a plain inline one, so
 * it loses to the sheet and the verification refuses - and the fallback is
 * then the only thing standing between the host and the loss of its own 1.25,
 * because clearing `zoom` there exposes the sheet's 1.
 *
 * The stamp is installed before the bundle and applied the moment CodeMirror's
 * `.cm-editor` appears, which is many task boundaries before the pinch that
 * takes the viewport over; it disconnects after one stamp so the overlay's own
 * writes are never overwritten. Both arms read the inline declaration back, so
 * a stamp that did not land is visible rather than quietly making the cell a
 * no-zoom control.
 */
async function arm(forceTransform: boolean, themeZoom: boolean, k: number = K, blocked = false) {
	const page = await browser.newPage({ viewport: { width: PANE.w, height: PANE.h }, deviceScaleFactor: PANE.dpr });
	try {
		if (forceTransform) {
			await page.evaluate(() => {
				const real = CSS.supports.bind(CSS);
				(CSS as unknown as { supports: typeof CSS.supports }).supports = (...a: Parameters<typeof CSS.supports>) => (typeof a[0] === "string" && a[0] === "zoom" ? false : real(...a));
			});
		}
		// BEFORE the bundle: the theme's rule is on the host from the first
		// layout, so the takeover's own capture sees it rather than racing it.
		if (themeZoom) await page.addStyleTag({ content: blocked ? `.cm-editor{zoom:1 !important}` : `.cm-editor{zoom:${THEME_ZOOM}}` });
		if (blocked) await page.evaluate((factor) => {
			const stamp = (): boolean => {
				const el = document.querySelector(".cm-editor") as HTMLElement | null;
				if (!el) return false;
				el.style.setProperty("zoom", String(factor), "important");
				return true;
			};
			const observer = new MutationObserver(() => { if (stamp()) observer.disconnect(); });
			if (!stamp()) observer.observe(document.documentElement, { subtree: true, childList: true });
		}, THEME_ZOOM);
		await page.addScriptTag({ content: bundle });
		await page.evaluate(([kk, pane]) => (window as never as { scrollColumnAnchor: { runTearMount(a: unknown, b: unknown, c: unknown, d: unknown, e: unknown): Promise<Record<string, unknown>> } }).scrollColumnAnchor.runTearMount(kk, 0, pane, true, { fx: 0.5, fy: 0.5 }), [k, { w: PANE.w, h: PANE.h }] as const);
		const read = await page.evaluate(() => {
			const api = (window as never as { scrollColumnAnchor: { runTearRead(): { cssScale: number } } }).scrollColumnAnchor;
			const cssScale = api.runTearRead().cssScale;
			// The class is only on the host once the viewport owns it; the k 1
			// reference arm reads the same element before any takeover.
			const host = (document.querySelector(".handwriting-note-viewport") ?? document.querySelector(".cm-editor")) as HTMLElement | null;
			const pane = document.querySelector(".markdown-source-view") as HTMLElement | null;
			const cs = host ? getComputedStyle(host) : null;
			return {
				cssScale,
				hostRectWidth: host ? host.getBoundingClientRect().width : null,
				paneRectWidth: pane ? pane.getBoundingClientRect().width : null,
				// The host's OWN computed zoom: Chromium reports the element's
				// own factor here, not the cumulative one, which is what makes
				// it comparable against baseZoom * k.
				zoom: cs ? cs.zoom : null,
				transform: cs ? cs.transform : null,
				styleWidth: host ? host.style.width : null,
				computedWidth: cs ? cs.width : null,
				// The host's own INLINE declaration, priority included: what the
				// fallback is meant to have put back.
				inlineZoom: host ? host.style.getPropertyValue("zoom") : null,
				inlinePriority: host ? host.style.getPropertyPriority("zoom") : null,
				owned: host ? host.classList.contains("handwriting-note-viewport") : null,
			};
		});
		await page.evaluate(() => (window as never as { scrollColumnAnchor: { runTearTeardown(): void } }).scrollColumnAnchor.runTearTeardown());
		return read;
	} finally {
		await page.close();
	}
}

type Arm = Awaited<ReturnType<typeof arm>>;

function assertArm(label: string, a: Arm, expectedScale: number, naturalWidth: number, forceTransform: boolean): void {
	// The stub either took or it did not; comparing paths that are the same
	// path measures nothing.
	if (forceTransform) {
		expect(a.zoom, `${label}: forced-transform arm's host carries no zoom the overlay wrote`).not.toBe(String(expectedScale));
		expect(a.transform, `${label}: forced-transform arm's host carries a scale transform`).not.toBe("none");
	} else {
		expect(a.transform, `${label}: zoom arm's host carries no scale transform`).toBe("none");
		expect(a.zoom, `${label}: zoom arm's host actually carries a zoom`).not.toBe("1");
	}
	expect(a.owned, `${label}: the viewport owns the host`).toBe(true);
	expect(Math.abs(a.cssScale - expectedScale), `${label}: the camera's own scale (read ${a.cssScale}, want ${expectedScale})`).toBeLessThan(0.002);
	expect(Math.abs((a.hostRectWidth ?? NaN) - naturalWidth), `${label}: the host's screen box survives the takeover (read ${a.hostRectWidth}, natural ${naturalWidth})`).toBeLessThan(1);
}

async function cell(label: string, themeZoom: boolean): Promise<void> {
	// k 1 does not pinch, so no takeover runs: this is the host's own box.
	const natural: Arm = await arm(false, themeZoom, 1);
	const zoomArm: Arm = await arm(false, themeZoom);
	const transformArm: Arm = await arm(true, themeZoom);
	// eslint-disable-next-line no-console
	console.log(`ZHPZ ${label} k=${K} natural=${JSON.stringify(natural)} zoomArm=${JSON.stringify(zoomArm)} transformArm=${JSON.stringify(transformArm)}`);
	const factor = themeZoom ? THEME_ZOOM : 1;
	// The style tag took (or, in the control, was never added).
	expect(Number.parseFloat(natural.zoom ?? "NaN"), `${label}: the host's own zoom before any takeover`).toBeCloseTo(factor, 12);
	expect(natural.owned, `${label}: k 1 leaves the viewport untaken`).toBe(false);
	const naturalWidth = natural.hostRectWidth!;
	const effective = factor * K;
	assertArm(`${label}, zoom path`, zoomArm, effective, naturalWidth, false);
	assertArm(`${label}, transform path`, transformArm, effective, naturalWidth, true);
	// The zoom the host ends up carrying IS the product on the zoom path: the
	// theme's factor was composed with, not replaced.
	expect(Number.parseFloat(zoomArm.zoom ?? "NaN"), `${label}: the written zoom is baseZoom * k`).toBeCloseTo(effective, 6);
}

it(`a theme zoom on the host composes with the requested camera scale on both write paths`, async () => {
	await cell("theme zoom", true);
}, 240_000);

it(`the same mount with no theme zoom is unchanged on both write paths`, async () => {
	await cell("no theme zoom", false);
}, 240_000);

/**
 * THE HOST'S OWN ZOOM IS INLINE AND `!important`, AND A SHEET COMPETES.
 *
 * The overlay's product write inherits the saved declaration's priority, so on
 * the zoom arm it out-specifies `.cm-editor{zoom:1 !important}` and the zoom
 * form holds: the host ends at 1.25 * k with no transform. The forced arm never
 * writes a zoom at all and its fallback must replay the host's own declaration
 * rather than clearing it. Either way the failure is the same and visible in
 * one number: expose the sheet's 1 and the host is at k, not 1.25 * k, and its
 * screen box comes out of the takeover narrower than it went in.
 *
 * The fixture's pinch begins at 1 and ends at k, so the zoom arm's first write
 * is a unity one - the write that is exempt from the read-back, and therefore
 * the one that must not demote the host's own declaration on its way past.
 */
it(`an inline zoom the host carried is put back when a stylesheet blocks the write`, async () => {
	const natural: Arm = await arm(false, true, 1, true);
	const zoomArm: Arm = await arm(false, true, K, true);
	const transformArm: Arm = await arm(true, true, K, true);
	// eslint-disable-next-line no-console
	console.log(`ZHPZ blocked k=${K} natural=${JSON.stringify(natural)} zoomArm=${JSON.stringify(zoomArm)} transformArm=${JSON.stringify(transformArm)}`);
	// The stamp landed and wins the cascade before any takeover runs.
	expect(natural.inlineZoom, "the inline stamp is on the host").toBe(String(THEME_ZOOM));
	expect(natural.inlinePriority, "with the priority that beats the sheet").toBe("important");
	expect(Number.parseFloat(natural.zoom ?? "NaN"), "the host's own computed zoom before any takeover").toBeCloseTo(THEME_ZOOM, 12);
	expect(natural.owned, "k 1 leaves the viewport untaken").toBe(false);
	const naturalWidth = natural.hostRectWidth!;
	const effective = THEME_ZOOM * K;
	assertArm("blocked, zoom path", zoomArm, effective, naturalWidth, false);
	assertArm("blocked, transform path", transformArm, effective, naturalWidth, true);
	// The zoom arm: the product write carried the inline priority, so it beat
	// the sheet and the host is at the product.
	expect(Number.parseFloat(zoomArm.zoom ?? "NaN"), `zoom path: the written zoom is baseZoom * k (read ${zoomArm.zoom})`).toBeCloseTo(effective, 6);
	expect(zoomArm.inlinePriority, "zoom path: the product inherited the inline priority").toBe("important");
	// The forced arm: no zoom was ever written, so the host's own declaration
	// is the one the fallback put back, priority and all.
	expect(Number.parseFloat(transformArm.zoom ?? "NaN"), `transform path: the host kept its own factor (read ${transformArm.zoom})`).toBeCloseTo(THEME_ZOOM, 6);
	expect(transformArm.inlineZoom, "transform path: the host's own inline declaration is back").toBe(String(THEME_ZOOM));
	expect(transformArm.inlinePriority, "transform path: with its priority").toBe("important");
}, 240_000);
