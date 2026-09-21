/**
 * Per-note paper override vs the global (body-level) setting. The per-note
 * size reset (`[data-handwriting-paper]:not([data-handwriting-paper="dots"])
 * :not([data-handwriting-paper="grid"])`) leaves a grid-typed note alone, so
 * the grid rule sets its own untiled `background-size: auto`: without it, a
 * grid note under a global DOTS body would inherit the dots' one-pitch tile on
 * both layers, and a tiled grid drifts off its pitch down a long note and
 * vanishes on a very wide one.
 *
 * Mechanism (read from source, src/inline/NotePaper.ts + styles.css:501-584):
 * a note's frontmatter choice is written as `data-handwriting-paper="<choice>"`
 * on the MarkdownView's `containerEl` - an ancestor of `.markdown-source-view`,
 * not that element itself, which is why the fixture wraps its own host in a
 * new element rather than tagging `.markdown-source-view` directly (the real
 * selector is a 4-level descendant chain and would not match otherwise).
 * The reset rule is scoped `:not(dots):not(grid)` so it never fires for a
 * grid-typed note, and DOES fire to force plain `auto` back for a lines-typed
 * note under a body that would otherwise leave an inherited dots sizing on it.
 *
 * Cells:
 *  (a) note=grid under a global lines body and under a global dots body: the
 *      grid stays untiled on every layer, both mid-preview (no commit) and
 *      after a commit at z 0.1.
 *  (b) note=lines under global body=grid: plain "auto".
 * Plus the plant: drop the grid rule's own `background-size: auto` in a
 * SCRATCH STRING COPY of the stylesheet (never written to disk) and show (a)
 * under global dots breaks - the green above is not a check that cannot fail.
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

/** Mounts the camera fixture under a GLOBAL body class, then wraps the
 * mounted host in a fresh element carrying the PER-NOTE `data-handwriting-
 * paper` attribute - a real intermediate ancestor, matching containerEl's
 * actual position in the DOM (NotePaper.ts:66), not the fixture's own host
 * element (which is `.markdown-source-view` itself and cannot double as the
 * selector's separate `[data-handwriting-paper]` ancestor). `cssText` lets
 * the plant substitute a modified stylesheet string without ever writing to
 * disk. */
async function mountNoteOverride(p: Page, globalKind: "lines" | "grid" | "dots", noteOverride: "lines" | "grid", cssText: string, id = "paper") {
	await p.setContent(`<!doctype html><body class="handwriting-paper-${globalKind}" style="margin:0; background:#ffffff; --background-modifier-border:#777777"></body>`);
	await p.addStyleTag({ content: cssText + OBSIDIAN_CAMERA_CSS });
	await p.addScriptTag({ content: script });
	await p.evaluate(id => (window as any).viewportFixture.setup(id, "far", 1, 1, ""), id);
	await p.evaluate(({ noteOverride }) => {
		const host = document.querySelector(".camera-proof") as HTMLElement;
		const wrapper = document.createElement("div");
		host.parentElement!.insertBefore(wrapper, host);
		wrapper.appendChild(host);
		wrapper.setAttribute("data-handwriting-paper", noteOverride);
	}, { noteOverride });
}

const readBackgroundSize = (p: Page): Promise<string> =>
	p.evaluate(() => getComputedStyle(document.querySelector(".cm-scroller")!).backgroundSize);

/** Same self-contained stepped-pinch-to-0.1-with-no-commit driver as
 * PaperZoomHost.test.ts's PREVIEW ARM (page.evaluate serialises the callback
 * - no outer closure reused, deliberately re-inlined here). */
async function previewToTenPercentNoCommit(p: Page, id: string): Promise<void> {
	await p.evaluate(() => (window as any).edgeAudit.commit("paper", 1));
	await p.evaluate(async ({ id }) => {
		const cx = 300, cy = 250, baseSpread = 300;
		const send = (type: string, pid: number, x: number, y: number) => {
			const target = document.elementFromPoint(x, y);
			if (!target) throw new Error(`pinch point (${x},${y}) outside editor`);
			target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: pid, isPrimary: pid === 701, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1, width: 8, height: 8 }));
		};
		const raf = () => new Promise<void>(r => requestAnimationFrame(() => r()));
		const ratios = Array.from({ length: 60 }, (_, i) => 0.1 ** (i / 59));
		const spreadAt = (ratio: number) => baseSpread * ratio;
		send("pointerdown", 701, cx - spreadAt(ratios[0]!) / 2, cy);
		send("pointerdown", 702, cx + spreadAt(ratios[0]!) / 2, cy);
		await raf();
		for (let i = 1; i < ratios.length; i++) {
			const s = spreadAt(ratios[i]!);
			send("pointermove", 701, cx - s / 2, cy);
			send("pointermove", 702, cx + s / 2, cy);
			await raf();
		}
		// NO pointerup: preview only.
		void id;
	}, { id });
}

/** Every layer untiled: the grid's size, which must not pick up a global dots tile. */
const untiled = (size: string): boolean => size.split(", ").every(layer => layer === "auto");

it.each(["lines", "dots"] as const)("(a) note=grid under a global %s body: the grid stays untiled, mid-preview and after commit", async globalKind => {
	const p = await browser.newPage();
	try {
		await mountNoteOverride(p, globalKind, "grid", css);
		await previewToTenPercentNoCommit(p, "paper");
		const midPreview = await readBackgroundSize(p);
		expect(untiled(midPreview), `[global ${globalKind}] mid-preview backgroundSize is not untiled on every layer: got ${JSON.stringify(midPreview)}`).toBe(true);

		await p.evaluate(() => (window as any).edgeAudit.commit("paper", 0.1));
		const afterCommit = await readBackgroundSize(p);
		expect(untiled(afterCommit), `[global ${globalKind}] post-commit backgroundSize is not untiled on every layer at z 0.1: got ${JSON.stringify(afterCommit)}`).toBe(true);
	} finally {
		await p.close();
	}
});

it("(b) note=lines under a global grid body: the per-note reset undoes the inherited two-layer sizing", async () => {
	const p = await browser.newPage();
	try {
		await mountNoteOverride(p, "grid", "lines", css);
		await p.evaluate(() => (window as any).edgeAudit.commit("paper", 0.1));
		const size = await readBackgroundSize(p);
		expect(size, `expected plain "auto" (the per-note reset), got ${JSON.stringify(size)}`).toBe("auto");
	} finally {
		await p.close();
	}
});

/**
 * PLANT: drop the grid rule's own `background-size: auto`, in a scratch STRING
 * copy of styles.css built here in memory - never written to disk. Proves
 * cell (a)'s green under a global dots body is not a check that cannot fail:
 * under the plant, a grid-typed note inherits the dots' one-pitch tile on both
 * of its layers.
 */
it("PLANT: removing the grid rule's own untiled size breaks case (a) under a global dots body", async () => {
	const anchor = "\tbackground-size: auto;\n\t/* Likewise the position:";
	const source = css.replace(/\r\n/g, "\n");
	expect(source.split(anchor).length, "the grid rule's size line was not found exactly once").toBe(2);
	const planted = source.replace(anchor, "\t/* Likewise the position:");
	const p = await browser.newPage();
	try {
		await mountNoteOverride(p, "dots", "grid", planted);
		await p.evaluate(() => (window as any).edgeAudit.commit("paper", 0.1));
		const size = await readBackgroundSize(p);
		expect(untiled(size), `plant did not redden case (a): backgroundSize is still ${JSON.stringify(size)} (expected the dots' tile on the grid's layers)`).toBe(false);
	} finally {
		await p.close();
	}
});
