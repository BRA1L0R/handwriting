/**
 * HOW BIG ARE THE INK CANVASES TO THE COMPOSITOR?
 *
 * The five ink canvases live inside the note viewport's counter-sized host:
 * the host is laid out at 1/scale and CSS-scaled back down, so at 10% zoom a
 * canvas covering the band is about 10,000 by 11,000 LAYOUT px while its
 * backing store is only about 3,000 by 2,200 device px (backingScale charges
 * for visual area). The compositor sizes a layer by the element's css box,
 * and it does not always fold the ancestor's scale into that: on the device
 * (Orion, 2026-09-13, DevTools Layers) each canvas read as a 19,900 x 22,380
 * layer, five of them, about 9 GB, 79% of the GPU memory limit, at exactly the
 * far position where every pen frame waits 100-280 ms on the GPU process.
 *
 * This arm reads the layer tree through the DevTools protocol at 10% in
 * Alan's pane, far and near, and asserts each canvas's layer bounds are no
 * bigger than its VISUAL box (band x scale), with a small allowance. On the
 * unfixed source it is red by a factor of ten on both axes. Real GPU when
 * HW_LAG_GPU=1 (the device's regime); the software compositor still reports
 * layers, and the number is printed either way.
 */

import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import css from "../../styles.css?raw";
import REAL_OBSIDIAN_CSS from "./obsidianReadableWidth";

declare const process: { env: Record<string, string | undefined> };
let browser: Browser, script: string;
const report: unknown[] = [];
const GPU_ARGS = ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu-rasterization", "--enable-zero-copy", "--ignore-gpu-blocklist", "--disable-software-rasterizer"];

beforeAll(async () => {
	const b = await build({
		entryPoints: [fileURLToPath(new URL("./scrollColumnAnchorPage.ts", import.meta.url))],
		bundle: true, write: false, format: "iife", platform: "browser",
		alias: { obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)) },
	});
	script = b.outputFiles[0]!.text;
	browser = await chromium.launch(process.env.HW_LAG_GPU === "1" ? { headless: true, args: GPU_ARGS } : { headless: true });
}, 180_000);

afterAll(async () => {
	await browser?.close();
	if (process.env.HW_LAYER_REPORT) writeFileSync(process.env.HW_LAYER_REPORT, JSON.stringify(report, null, 1));
});

type Layer = { layerId: string; parentLayerId?: string; backendNodeId?: number; width: number; height: number; transform?: number[]; drawsContent: boolean; paintCount: number };

for (const far of [true, false]) it(`ink canvas compositor layers are no bigger than their visual box at 0.1, ${far ? "far" : "near"}`, async () => {
	const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
	try {
		await page.setContent('<!doctype html><body style="margin:0"></body>');
		if (process.env.HW_DRAW_HOST_CSS) await page.addStyleTag({ content: readFileSync(process.env.HW_DRAW_HOST_CSS, "utf8") });
		await page.addStyleTag({ content: css + REAL_OBSIDIAN_CSS }); await page.addScriptTag({ content: script });
		const cdp = await page.context().newCDPSession(page);
		let layers: Layer[] = [];
		cdp.on("LayerTree.layerTreeDidChange", (e: { layers?: Layer[] }) => { if (e.layers) layers = e.layers; });
		await cdp.send("DOM.enable"); await cdp.send("LayerTree.enable");
		const geom = await page.evaluate(f => (window as any).scrollColumnAnchor.runLayerBoundsMount(f), far);
		// Let the compositor commit a frame with the mounted canvases.
		await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
		await new Promise(r => setTimeout(r, 250));
		// Match layers to canvases by backend node id.
		const doc = await cdp.send("DOM.getDocument", { depth: -1 });
		const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: "canvas[data-hw-layer-probe]" });
		const nodes: { name: string; backendNodeId: number }[] = [];
		for (const nodeId of nodeIds) {
			const d = await cdp.send("DOM.describeNode", { nodeId });
			const attrs = d.node.attributes ?? [];
			const i = attrs.indexOf("data-hw-layer-probe");
			nodes.push({ name: attrs[i + 1]!, backendNodeId: d.node.backendNodeId });
		}
		const reasons = new Map<string, unknown>();
		for (const l of layers) {
			if (nodes.some(n => n.backendNodeId === l.backendNodeId) || l.width * l.height > 5_000_000) {
				try { reasons.set(l.layerId, await cdp.send("LayerTree.compositingReasons", { layerId: l.layerId })); } catch { reasons.set(l.layerId, "n/a"); }
			}
		}
		const perCanvas = nodes.map(n => {
			const own = layers.filter(l => l.backendNodeId === n.backendNodeId);
			const c = geom.canvases.find((x: any) => x.name === n.name)!;
			return { name: n.name, backing: c.backing, css: c.css, transform: c.transform, rect: c.rect, layers: own.map(l => ({ id: l.layerId, parent: l.parentLayerId ?? null, width: l.width, height: l.height, drawsContent: l.drawsContent, paintCount: l.paintCount, transform: l.transform ?? null, reasons: reasons.get(l.layerId) ?? null })) };
		});
		// The largest layer in the tree, whatever it belongs to: the band
		// container or the scroller if the canvases are not composited alone.
		const biggest = [...layers].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 5).map(l => ({ id: l.layerId, node: l.backendNodeId ?? null, width: l.width, height: l.height, draws: l.drawsContent, transform: l.transform ?? null, reasons: reasons.get(l.layerId) ?? null }));
		const r = { far, geom, perCanvas, biggest, layerCount: layers.length, gpu: process.env.HW_LAG_GPU === "1" };
		report.push(r);
		// eslint-disable-next-line no-console
		console.log(`REASONS ${far ? "far" : "near"} ` + perCanvas.map(p => `${p.name}: ` + p.layers.map(l => `${l.id}<-${l.parent} ${JSON.stringify(l.reasons)} t=${JSON.stringify(l.transform)}`).join(" || ")).join("; ") + ` | biggest ${JSON.stringify(biggest[0])}`);
		// eslint-disable-next-line no-console
		console.log(`LAYERS ${far ? "far" : "near"} scale ${geom.cssScale} band ${geom.band?.width}x${geom.band?.height} ` + perCanvas.map(p => `${p.name}: css ${p.css.w}x${p.css.h} backing ${p.backing.w}x${p.backing.h} layer ${p.layers.map(l => `${l.width}x${l.height}`).join("|") || "none"}`).join("; ") + ` | biggest ${JSON.stringify(biggest[0])}`);
		expect(geom.cssScale, "the pane really is at 0.1").toBeCloseTo(0.1, 3);
		expect(nodes.length, "five ink canvases found").toBe(5);
		// THE CLAIM. A canvas's visual box is its css box times the scale; its
		// layer may not exceed that by more than a device pixel's worth of
		// rounding (the allowance is 2 css px). If the compositor gives a
		// canvas no layer of its own, the layer that paints it is judged
		// instead: the biggest layer must still be no bigger than the pane.
		// The visual box is the BAND's (the container's css box, always laid
		// out in layout px) times the scale. Not the canvas's own css box: the
		// fix makes that box the visual size already, and judging it against
		// itself times the scale would be a claim that cannot pass.
		const visualW = geom.container.css.w * geom.cssScale, visualH = geom.container.css.h * geom.cssScale;
		for (const p of perCanvas) {
			if (p.layers.length === 0) continue;
			for (const l of p.layers) {
				expect.soft(l.width, `${p.name} layer width vs visual ${visualW.toFixed(1)}`).toBeLessThanOrEqual(visualW + 2);
				expect.soft(l.height, `${p.name} layer height vs visual ${visualH.toFixed(1)}`).toBeLessThanOrEqual(visualH + 2);
			}
		}
		if (perCanvas.every(p => p.layers.length === 0)) {
			expect.soft(biggest[0]!.width, "no canvas layer: the biggest layer is no wider than the pane plus band margin").toBeLessThanOrEqual(1500 + 400);
		}
	} finally {
		await page.evaluate(() => (window as any).scrollColumnAnchor.runLayerBoundsTeardown()).catch(() => undefined);
		await page.close();
	}
}, 120_000);
