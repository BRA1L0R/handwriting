/**
 * Z4b, DISCRIMINATED: the same pen click's stored world point under the zoom
 * write path and under the forced transform fallback, across four cells -
 * two scales times two scroll positions.
 *
 * The single-cell arm beside this file found world y differing by a fixed
 * amount at one scale and one scroll. One cell cannot say what KIND of term
 * it is, and the three kinds want different fixes:
 *
 *   constant across k and scroll   an unzoomed chrome height (a header, a
 *                                  tools strip, a native scrollbar) reaching
 *                                  a basis that is otherwise zoomed
 *   scales with k or 1/k           a real offset carried in the wrong unit
 *   moves with scroll              scroll mixed between zoomed and unzoomed
 *
 * So each cell also reads the terms a vertical basis is built from - the
 * scroller's client box and scroll offsets, the container's rect and its
 * band, the content's rect and padding - on BOTH arms, and prints them beside
 * the difference. The named term is then the one whose own zoom-vs-transform
 * difference matches the world difference, not a guess from the shape alone.
 *
 * The transform arm is forced the same way the single-cell arm forces it, and
 * the host's computed `zoom` is read back on both arms before any comparison
 * is trusted: a stub that did not take would compare a path against itself.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { penStroke } from "./cdpPen";

declare const process: { env: Record<string, string | undefined> };
const root = fileURLToPath(new URL("../../", import.meta.url));
let browser: Browser, bundle: string;
const report: unknown[] = [];

beforeAll(async () => {
	browser = await chromium.launch({ headless: true });
	bundle = (await build({
		entryPoints: [root + "test/render/scrollColumnAnchorPage.ts"], bundle: true, write: false, format: "iife", platform: "browser",
		alias: { obsidian: root + "test/render/iphoneObsidianStub.ts" },
	})).outputFiles[0]!.text;
}, 180_000);

afterAll(async () => {
	await browser?.close();
	if (process.env.HW_Z4B_CELLS_REPORT) writeFileSync(process.env.HW_Z4B_CELLS_REPORT, JSON.stringify(report, null, 1));
});

const PANE = { w: 945, h: 834, dpr: 2 };

async function arm(forceTransform: boolean, k: number, scroll: number, forceTop: number) {
	const page = await browser.newPage({ viewport: { width: PANE.w, height: PANE.h }, deviceScaleFactor: PANE.dpr });
	try {
		if (forceTransform) {
			await page.evaluate(() => {
				const real = CSS.supports.bind(CSS);
				(CSS as unknown as { supports: typeof CSS.supports }).supports = (...a: Parameters<typeof CSS.supports>) => (typeof a[0] === "string" && a[0] === "zoom" ? false : real(...a));
			});
		}
		await page.addScriptTag({ content: bundle });
		const read = await page.evaluate(([kk, s, pane]) => (window as never as { scrollColumnAnchor: { runTearMount(a: unknown, b: unknown, c: unknown, d: unknown, e: unknown): Promise<Record<string, unknown>> } }).scrollColumnAnchor.runTearMount(kk, s, pane, true, { fx: 0.5, fy: 0.5 }), [k, scroll, { w: PANE.w, h: PANE.h }] as const);
		// SAME SCROLL, NOT THE SAME REQUEST. The mount asks for a scroll and
		// the editor settles wherever its own layout puts it, which is not
		// bound to agree between two arms; a click compared across two
		// different document positions measures the positions, not the
		// mapping. So both arms are driven to one chosen scrollTop here and
		// the achieved value is read back and compared before any world point
		// is trusted. Plain DOM, no overlay internals.
		const settled = await page.evaluate((want: number) => {
			const s = document.querySelector(".cm-scroller") as HTMLElement;
			s.scrollTop = want; s.dispatchEvent(new Event("scroll", { bubbles: true }));
			return new Promise<{ top: number; left: number }>(r => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => r({ top: s.scrollTop, left: s.scrollLeft })), 200)));
		}, forceTop);
		const cdp = await page.context().newCDPSession(page);
		const x = PANE.w * 0.7, y = PANE.h * 0.5;
		await penStroke(cdp, [{ x, y }, { x: x + 3, y }], { pressure: 0.6 });
		await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
		const world = await page.evaluate(() => (window as never as { scrollColumnAnchor: { runTearLastStrokePoint(): { x: number; y: number } | null } }).scrollColumnAnchor.runTearLastStrokePoint());
		// The vertical basis, term by term, straight off the DOM - not values
		// the overlay computed for itself.
		const terms = await page.evaluate(() => {
			const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
			const box = (el: HTMLElement | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; };
			const host = q(".handwriting-note-viewport"), scroller = q(".cm-scroller"), content = q(".cm-content"), container = q(".handwriting-ink-overlay"), layer = q(".handwriting-ink-layer");
			const hs = host ? getComputedStyle(host) : null;
			return {
				host: hs ? { zoom: hs.zoom, transform: hs.transform, rect: box(host), clientH: host!.clientHeight, offsetH: host!.offsetHeight } : null,
				scroller: scroller ? { rect: box(scroller), clientH: scroller.clientHeight, clientW: scroller.clientWidth, offsetH: scroller.offsetHeight, offsetW: scroller.offsetWidth, scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft, scrollH: scroller.scrollHeight, scrollW: scroller.scrollWidth } : null,
				content: content ? { rect: box(content), padTop: getComputedStyle(content).paddingTop, offsetTop: content.offsetTop } : null,
				container: container ? { rect: box(container), offsetH: container.offsetHeight, styleTop: container.style.top, styleLeft: container.style.left } : null,
				layer: layer ? { rect: box(layer), transform: getComputedStyle(layer).transform } : null,
			};
		});
		await page.evaluate(() => (window as never as { scrollColumnAnchor: { runTearTeardown(): void } }).scrollColumnAnchor.runTearTeardown());
		return { forceTransform, k, scroll, settled, cssScale: read.cssScale, band: read.band, rects: read.rects, scrollRead: read.scroll, world, terms, screen: { x, y } };
	} finally {
		await page.close();
	}
}

type Arm = Awaited<ReturnType<typeof arm>>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The forced scrollTop per cell: a position the editor settles at on
// both arms at that scale, near the origin and far down the document.
for (const k of [0.1, 0.3]) for (const [scroll, forceTop] of [[0, 0], [60090, 8000]] as const) {
	it(`the same pen click lands on the same world point under both write paths at k ${k}, scroll ${scroll}`, async () => {
		const zoomArm: Arm = await arm(false, k, scroll, forceTop);
		const transformArm: Arm = await arm(true, k, scroll, forceTop);
		const dy = zoomArm.world && transformArm.world ? zoomArm.world.y - transformArm.world.y : null;
		const dx = zoomArm.world && transformArm.world ? zoomArm.world.x - transformArm.world.x : null;
		// Every vertical term's own difference between the arms, so the cell
		// that names the term does not need a second run to do it.
		const zt = zoomArm.terms, tt = transformArm.terms;
		const diffs = {
			scrollerClientH: num(zt.scroller?.clientH)! - num(tt.scroller?.clientH)!,
			scrollerClientW: num(zt.scroller?.clientW)! - num(tt.scroller?.clientW)!,
			scrollerScrollTop: num(zt.scroller?.scrollTop)! - num(tt.scroller?.scrollTop)!,
			scrollerRectTop: num(zt.scroller?.rect?.top)! - num(tt.scroller?.rect?.top)!,
			containerRectTop: num(zt.container?.rect?.top)! - num(tt.container?.rect?.top)!,
			containerOffsetH: num(zt.container?.offsetH)! - num(tt.container?.offsetH)!,
			contentRectTop: num(zt.content?.rect?.top)! - num(tt.content?.rect?.top)!,
			hostRectTop: num(zt.host?.rect?.top)! - num(tt.host?.rect?.top)!,
			hostClientH: num(zt.host?.clientH)! - num(tt.host?.clientH)!,
			bandTop: num((zoomArm.band as { top?: number } | null)?.top)! - num((transformArm.band as { top?: number } | null)?.top)!,
			bandHeight: num((zoomArm.band as { height?: number } | null)?.height)! - num((transformArm.band as { height?: number } | null)?.height)!,
		};
		const dTop = zoomArm.settled.top - transformArm.settled.top;
		report.push({ k, scroll, forceTop, dx, dy, dTop, diffs, zoomArm, transformArm });
		// eslint-disable-next-line no-console
		console.log(`Z4BCELL k=${k} scroll=${scroll} top=${zoomArm.settled.top}/${transformArm.settled.top} dTop=${dTop} dx=${dx} dy=${dy} dy-dTop=${(dy ?? 0) - dTop} diffs=${JSON.stringify(diffs)}`);
		expect(zoomArm.terms.host?.zoom, "zoom arm's host actually carries zoom").not.toBe("1");
		expect(transformArm.terms.host?.zoom, "forced-transform arm's host carries no zoom").toBe("1");
		expect(transformArm.terms.host?.transform, "forced-transform arm's host carries a scale transform").not.toBe("none");
		// The two arms are driven to one scrollTop, but the zoomed host reads its
		// offset back through a single-precision division, so the settled values
		// can differ by a sliver of a layout px at a far offset (2^-11 at 8000).
		// The parity claim is therefore world y net of that difference.
		expect(Math.abs(dTop), "both arms sit at the same achieved scrollTop before the click, within the engine's float read-back").toBeLessThan(0.01);
		expect(zoomArm.world, "zoom arm stored a point").not.toBeNull();
		expect(transformArm.world, "transform arm stored a point").not.toBeNull();
		expect(Math.abs(dx ?? Infinity), "world x agrees between the write paths").toBeLessThan(2);
		expect(Math.abs((dy ?? Infinity) - dTop), "world y agrees between the write paths, net of the settled scroll difference").toBeLessThan(2);
	}, 240_000);
}
