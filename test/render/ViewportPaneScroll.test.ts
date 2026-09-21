/**
 * THE OWNED PANE MUST NEVER CARRY A SCROLL OFFSET OF ITS OWN.
 *
 * At 10% the note viewport counter-sizes the editor host to 10x the pane and
 * scales it back down, so the pane's scrollable overflow - the host's LAYOUT
 * box - is 10x the pane on both axes. Under `overflow: hidden` the pane is a
 * scroll container that script and the browser's scroll-into-view walks can
 * still scroll, and one such write shifts the whole editor surface up and
 * left inside the pane: bare pane on the right and bottom with no scroller
 * under the pen, no ink layer, no finger scroll, and a stroke crossing the
 * edge clipped there (the device report of 2026-09-14 at 10% far right and
 * bottom). The stylesheet now makes the owned pane a clip (`overflow: clip`),
 * which nobody can scroll, and `applyViewportBox` resets any offset an engine
 * without `clip` lets through.
 *
 * Pen input here is REAL: CDP `Input.dispatchMouseEvent` with pointerType
 * "pen" at page coordinates, hit-tested by the browser. The first contact is
 * the pane's bottom-right corner, before anything focuses the editor: a focus
 * scroll-into-view of the content resets an offset pane to 0 on its own, and
 * a contact that lands on the editor focuses it, so a contact on the editor
 * first would hide the offset this file is about.
 *
 * Harness engine supports CSS zoom; hostZoom pinned true; the transform
 * fallback in applyViewportBox has no harness coverage.
 *
 * Arms: FIXED (the shipped rule: a written offset reads back 0, the host is
 * the pane, the corner claims, stores and paints, the crossing stroke paints
 * to the end); two REGIME GUARDS under the pre-fix rule restored by an injected
 * stylesheet. They are not a plant and cannot show the fix working: css zoom
 * shrinks the counter-sized host to the pane, so in this cell the pre-fix rule
 * leaves nothing to scroll, and they assert that precondition set. The plant
 * and self-heal that could fail belonged to the transform host and were
 * removed with its arms.
 */
import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import css from "../../styles.css?raw";
import REAL_OBSIDIAN_CSS from "./obsidianReadableWidth";

declare const process: { env: Record<string, string | undefined> };
let browser: Browser, script: string;
const HOST_LEFT = 300;
const FAR = 11482;
const PANE = { w: 1397.5, h: 800 };
const OFFSET = { left: 200, top: 300 };
const PRE_FIX_RULE = ".handwriting-note-viewport-pane { overflow: hidden !important; }";
const farHost = () => !!process.env.HW_DRAW_HOST_CSS;

beforeAll(async () => {
	const b = await build({
		entryPoints: [fileURLToPath(new URL("./scrollColumnAnchorPage.ts", import.meta.url))],
		bundle: true, write: false, format: "iife", platform: "browser",
		alias: { obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)) },
	});
	script = b.outputFiles[0]!.text;
	browser = await chromium.launch({ headless: true });
}, 180_000);

afterAll(async () => { await browser?.close(); });

async function penStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
	const cdp = await page.context().newCDPSession(page);
	const ev = (type: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, y: number) =>
		cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: 1, clickCount: type === "mousePressed" ? 1 : 0, pointerType: "pen", force: 0.5 } as never);
	await ev("mousePressed", from.x, from.y);
	for (let i = 1; i <= steps; i++) {
		await ev("mouseMoved", from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
		await page.waitForTimeout(12);
	}
	await ev("mouseReleased", to.x, to.y);
	await page.waitForTimeout(200);
	await cdp.detach();
}

async function open(plant: boolean) {
	const page = await browser.newPage({ viewport: { width: Math.ceil(HOST_LEFT + PANE.w + 20), height: PANE.h + 100 }, deviceScaleFactor: 2 });
	const errors: string[] = [];
	page.on("pageerror", e => errors.push(e.message));
	await page.setContent('<!doctype html><body style="margin:0"></body>');
	if (farHost()) await page.addStyleTag({ content: readFileSync(process.env.HW_DRAW_HOST_CSS!, "utf8") });
	await page.addStyleTag({ content: css + readFileSync(fileURLToPath(new URL("./noteViewportCamera.css", import.meta.url)), "utf8") + REAL_OBSIDIAN_CSS });
	if (plant) await page.addStyleTag({ content: PRE_FIX_RULE });
	await page.addScriptTag({ content: script });
	const geo = await page.evaluate(a => (window as any).scrollColumnAnchor.runPaneScrollMount(0.1, a.far, a.host), { far: FAR, host: farHost() });
	return { page, errors, geo };
}

const read = (page: Page, points: { label: string; x: number; y: number }[] = []) => page.evaluate(p => (window as any).scrollColumnAnchor.runPaneScrollRead(p), points);

/** The corner contact and the crossing stroke, with the pane offset written first. */
async function cornerAndCrossing(page: Page) {
	const written = await page.evaluate(o => (window as any).scrollColumnAnchor.runPaneScrollWrite(o.left, o.top), OFFSET);
	const g = await read(page);
	const pr = g.rects.pane;
	const corner = { label: "corner", x: Math.round(pr.r - 25), y: Math.round(pr.b - 25) };
	const pre = await read(page, [corner]);
	await penStroke(page, { x: corner.x, y: corner.y }, { x: corner.x + 15, y: corner.y + 6 });
	const post = await read(page, [corner]);
	const cross = { from: { x: Math.round(pr.r - 140), y: Math.round(pr.t + pr.h * 0.5 + 60) }, to: { x: Math.round(pr.r - 8), y: Math.round(pr.t + pr.h * 0.5 + 60) } };
	const preC = await read(page);
	await penStroke(page, cross.from, cross.to, 14);
	const samples = Array.from({ length: 14 }, (_, i) => ({ label: `x${i}`, x: cross.from.x + Math.round((cross.to.x - cross.from.x) * i / 13), y: cross.from.y }));
	const postC = await read(page, samples);
	return {
		written, geo: g, corner,
		cornerTarget: pre.hits[0].target as string[], cornerInScroller: pre.hits[0].inScroller as boolean,
		cornerDelivered: post.acq.delivered - pre.acq.delivered, cornerClaimed: post.acq.claimed - pre.acq.claimed, cornerStrokes: post.strokes - pre.strokes, cornerInk: post.hits[0].ink as { inside: boolean; pixels: number },
		crossClaimed: postC.acq.claimed - preC.acq.claimed, crossStrokes: postC.strokes - preC.strokes, crossInk: postC.hits.map((h: any) => h.ink.inside ? h.ink.pixels : -1) as number[],
	};
}

it("FIXED: at 10% far right+bottom a scroll offset written onto the owned pane reads back 0, the host is the pane, the corner contact claims, stores and paints, and a stroke crossing toward the edge paints to the end", async () => {
	const { page, errors, geo } = await open(false);
	try {
		expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
		expect(geo.pinchScaleNow, "reached 10% through the pinch").toBeCloseTo(0.1, 6);
		const r = await cornerAndCrossing(page);
		// eslint-disable-next-line no-console
		console.log(`PANESCROLL fixed ${JSON.stringify(r)}`);
		// Behaviour first, mechanism last: on the parent source the red is
		// "the host ends short and the corner is dead", not "the pane is not
		// a clip".
		expect(r.geo.rects.host, "the host box is the pane box after the write").toEqual(r.geo.rects.pane);
		expect(r.cornerInScroller, `corner contact lands on the scroller, not ${r.cornerTarget.join(" > ")}`).toBe(true);
		expect(r.cornerClaimed, "the router claimed the corner contact").toBe(1);
		expect(r.cornerStrokes, "one stroke stored from the corner").toBe(1);
		expect(r.cornerInk.pixels, "committed ink painted at the corner").toBeGreaterThan(0);
		expect(r.crossStrokes, "the crossing stroke stored").toBe(1);
		expect(r.crossInk.every(n => n > 0), `ink along the whole crossing stroke: ${r.crossInk.join(",")}`).toBe(true);
		expect(r.written, "the write is a no-op on a clip").toEqual({ left: 0, top: 0 });
		expect(r.geo.pane.sw, "no scrollable overflow: scrollWidth is the client width").toBe(r.geo.pane.cw);
		expect(geo.supportsClip, "this engine supports overflow: clip").toBe(true);
		expect(geo.paneOverflow, "the owned pane computes as a clip").toBe("clip");
	} finally { await page.close(); }
}, 240_000);

it("REGIME GUARD, pre-fix rule restored: at 10% far right+bottom the zoom host leaves the pane nothing to scroll, so the write is a no-op and the corner contact is still claimed (not a plant)", async () => {
	const { page, errors, geo } = await open(true);
	try {
		expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
		expect(geo.paneOverflow, "the injected rule restored the scroll container").toBe("hidden");
		// The zoom host is the form under test: the harness engine has css zoom and the overlay's gate agrees with it (file header).
		expect(geo.engineZoom, "the harness engine supports css zoom").toBe(true);
		expect(geo.hostZoom, "the overlay's host-form gate agrees with the engine").toBe(geo.engineZoom);
		const r = await cornerAndCrossing(page);
		// eslint-disable-next-line no-console
		console.log(`PANESCROLL regime-guard ${JSON.stringify(r)}`);
		// css zoom shrinks the counter-sized host to the pane, so even with the scroll container restored there is nothing to scroll
		// and the pre-fix defect cannot occur. This cannot show the fix working. It asserts the whole precondition set that makes the
		// fix redundant, in this one cell only (10%, the far host, this pane size): it goes red if the zoom host overflows this pane
		// under the pre-fix rule, and says nothing about other scales or panes. If it does go red, the zoom host needs a real plant.
		expect(r.geo.paneOverflow, "regime guard: the pre-fix rule is in force").toBe("hidden");
		expect(r.geo.pane.sw, "regime guard: no horizontal overflow under the pre-fix rule").toBe(r.geo.pane.cw);
		expect(r.geo.pane.sh, "regime guard: no vertical overflow under the pre-fix rule").toBe(r.geo.pane.ch);
		expect(r.geo.rects.host, "regime guard: the host box is the pane box").toEqual(r.geo.rects.pane);
		expect(r.written, "regime guard: the write is a no-op, nothing to scroll").toEqual({ left: 0, top: 0 });
		expect(r.cornerInScroller, `regime guard: corner contact lands on the scroller, not ${r.cornerTarget.join(" > ")}`).toBe(true);
		expect(r.cornerClaimed, "regime guard: the router claimed the corner contact").toBe(1);
	} finally { await page.close(); }
}, 240_000);

it("REGIME GUARD, pre-fix rule restored: through a box application the zoom host pane stays at 0 with nothing to scroll, so there is no offset to heal (not a self-heal)", async () => {
	const { page, errors, geo } = await open(true);
	try {
		expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
		// The zoom host is the form under test (file header).
		expect(geo.engineZoom, "the harness engine supports css zoom").toBe(true);
		expect(geo.hostZoom, "the overlay's host-form gate agrees with the engine").toBe(geo.engineZoom);
		const written = await page.evaluate(o => (window as any).scrollColumnAnchor.runPaneScrollWrite(o.left, o.top), OFFSET);
		const before = await read(page);
		// Under the pre-fix rule the pane has no overflow to carry an offset (see the first regime guard); the same precondition set,
		// held through a box application, in this one cell only.
		expect(before.paneOverflow, "regime guard: the pre-fix rule is in force").toBe("hidden");
		expect(before.pane.sw, "regime guard: no horizontal overflow under the pre-fix rule").toBe(before.pane.cw);
		expect(before.pane.sh, "regime guard: no vertical overflow under the pre-fix rule").toBe(before.pane.ch);
		expect(before.rects.host, "regime guard: the host box is the pane box").toEqual(before.rects.pane);
		expect(written, "regime guard: the write is a no-op").toEqual({ left: 0, top: 0 });
		const still = await page.evaluate(() => (window as any).scrollColumnAnchor.runPaneScrollNudge());
		// eslint-disable-next-line no-console
		console.log(`PANESCROLL regime-guard box-application pane=${JSON.stringify(still.pane)} host=${JSON.stringify(still.rects.host)}`);
		expect(still.pane.left, "regime guard: pane scrollLeft stays 0 through the box application").toBe(0);
		expect(still.pane.top, "regime guard: pane scrollTop stays 0 through the box application").toBe(0);
		expect(still.rects.host, "regime guard: the host box is still the pane box after the box application").toEqual(still.rects.pane);
	} finally { await page.close(); }
}, 240_000);
