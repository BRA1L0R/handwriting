/**
 * s105 (Architect, case 3), s107 (Alan, ruling on the conflict this cell first exposed). Off-centre pinch-out
 * 100% -> 10%, RLL off, IC off. 100ms into the post-lift glide, a real pen contact: pointerdown, a short move (a
 * stroke), pointerup - on view.scrollDOM, pointerType "pen". InlinePenRouter.pointerDown calls onViewportInput()
 * at its very top (:2502-2504), before any pen/touch classification, so this hits the same cancel path the tap
 * cell covers, and the same resumeStrandedPan resumes it - one method, called from both the touch and the pen
 * lift sites, with no branch on input type. Logs the cancelOverscrollBounce entry (build-time patch, source
 * untouched), viewportPan, leftEdgePx at rest.
 *
 * s107: nothing moves unless the page stands past its bound, then it eases back - no infinite blank forever.
 * This cell's page is well past its bound at the moment of the tap-equivalent pen contact (a 10% zoom-out has
 * plenty of room), so the correct rest here is the bound, same as the touch cells. OverscrollBounce.test.ts's
 * "PEN DOWN MID-BOUNCE" is the paired control for the OTHER regime - a page already inside its room, where a
 * caught-and-drawn stroke has nowhere to ease to and correctly does not move after.
 *
 * No separate floor-bound (-9ish) arm here: resumeStrandedPan clamps identically regardless of what cancelled the
 * ease, and TapDuringGlide.test.ts's floor cell already exercises that clamp end to end. This cell's job is
 * proving the PEN call site reaches resumeStrandedPan at all (it's a distinct wiring point, penUp -> the same
 * method), not re-proving the clamp math a second time.
 */
import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import css from "../../styles.css?raw";
import REAL_OBSIDIAN_CSS from "./obsidianReadableWidth";

declare const process: { env: Record<string, string | undefined> };

const PAGE = `
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { inlineInk, inkOverlayExtension, overlayForPath, setScrollExpansionEnabled } from "../../src/inline/InkOverlay";
import { installObsidianDom } from "./obsidianDom";
import { editorInfoField } from "./iphoneObsidianStub";
import { parsePage, serializePage } from "../../src/model/PageData";

installObsidianDom();
const ids = new Map(), sidecars = new Map();
const save = (id, page) => { sidecars.set(id, serializePage(page)); };
inlineInk.attachHost({ readPageId: p => ids.get(p) ?? null, claimId: async (p, id) => { ids.set(p, id); return { pageId: id }; },
	loadSidecar: async id => (sidecars.has(id) ? parsePage(sidecars.get(id), id) : null), scheduleSidecar: save, scheduleSidecarNow: async (id, p) => save(id, p), notify: () => {} });

const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const rendered = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await frame(); };
const PANE_W = 1397.5, PANE_H = 800, HOST_LEFT = 300;
let rig = null;

function installSizer(view) {
	const sizer = document.createElement("div"); sizer.className = "cm-sizer";
	const container = document.createElement("div"); container.className = "cm-contentContainer";
	view.contentDOM.parentElement.insertBefore(sizer, view.contentDOM); sizer.appendChild(container); container.appendChild(view.contentDOM);
	void view.scrollDOM.clientWidth; return sizer;
}
const r2 = v => Math.round(v * 100) / 100;

function sample(phase) {
	const { view, overlay, pane } = rig;
	const pr = pane.getBoundingClientRect(), cr = view.contentDOM.getBoundingClientRect();
	const bounce = typeof overlay.overscrollBounceReadout === "function" ? overlay.overscrollBounceReadout() : null;
	return { phase, k: overlay.pinchScaleNow, preview: !!overlay.pinchPreview,
		panX: r2((overlay.viewportPan || { x: 0 }).x),
		inkReservePx: r2(Math.max(0, ...inlineInk.strokes(rig.path).map(s => -s.bbox.x)) * overlay.scale),
		scrollPx: r2(view.scrollDOM.scrollLeft * overlay.cssScale),
		leftEdgePx: r2(cr.left - pr.left), bounce };
}

window.penProbe = {
	async mount(tag) {
		// s187 (1) [Architect]: MOUNT WITH THE CANVAS ON. This rig made its hang and its glide with a
		// two-finger pinch through the router while the canvas was OFF - a gesture s179 removed and s185
		// handed to the host, so every premise below read 0 and the cells failed without a product fault.
		setScrollExpansionEnabled(true);
		const path = "pen-probe-" + (tag || "x") + ".md";
		const pane = document.body.appendChild(document.createElement("div"));
		pane.className = "markdown-source-view mod-cm6";
		pane.style.cssText = "position:relative;margin-left:" + HOST_LEFT + "px;width:" + PANE_W + "px;height:" + PANE_H + "px;overflow:hidden";
		const doc = Array.from({ length: 400 }, (_, i) => "line " + i + " alpha beta gamma delta epsilon zeta").join("\\n");
		const view = new EditorView({ parent: pane, state: EditorState.create({ doc, extensions: [history(), EditorView.lineWrapping,
			editorInfoField.init(() => ({ app: { commands: { executeCommandById: () => false } }, file: { path }, editor: {} })), inkOverlayExtension(),
			EditorView.theme({ "&": { width: PANE_W + "px", height: PANE_H + "px" }, ".cm-scroller": { overflowY: "auto", overflowX: "hidden" }, ".cm-content": { fontFamily: "monospace", fontSize: "16px", lineHeight: "24px" } })] }) });
		const sizer = installSizer(view);
		await settle(12);
		const overlay = overlayForPath(path);
		if (!overlay) throw new Error("no overlay for " + path);
		rig = { pane, view, overlay, sizer, path };
		return sample("natural");
	},
	async pinchOutThenPenStroke(to, widthFraction, tag) {
		const { overlay, pane, view } = rig, router = overlay.router;
		const r = pane.getBoundingClientRect(), cx = r.left + r.width * widthFraction, cy = r.top + r.height / 2;
		const spread0 = 300, spread1 = 300 * to / overlay.pinchScaleNow, steps = 30;
		const touch = s => { router.touchPos.set(911, { x: cx - s / 2, y: cy }); router.touchPos.set(912, { x: cx + s / 2, y: cy }); };
		const ev = type => new PointerEvent(type, { pointerId: 912, pointerType: "touch" });
		const rows = [sample(tag + "-before")];
		touch(spread0); router.beginPinch(ev("pointerdown"));
		for (let i = 1; i <= steps; i++) { touch(spread0 + (spread1 - spread0) * i / steps); router.updatePinch(ev("pointermove")); await rendered(); rows.push(sample(tag + "-move-" + i)); }
		router.endPinch(ev("pointerup"), { x: cx, y: cy }); router.touchPos.clear();
		let penned = false;
		for (let j = 1; j <= 60; j++) {
			await rendered();
			if (!penned && j >= 6) {
				penned = true;
				const px = r.left + 20, py = r.top + 20;
				const pen = (type, x, y, buttons) => view.scrollDOM.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "pen", pointerId: 960, isPrimary: true, clientX: x, clientY: y, buttons, pressure: buttons ? 0.5 : 0 }));
				pen("pointerdown", px, py, 1);
				rows.push(sample(tag + "-pendown"));
				for (let s = 1; s <= 4; s++) { pen("pointermove", px + 10 * s, py, 1); await rendered(); }
				rows.push(sample(tag + "-penmove"));
				pen("pointerup", px + 40, py, 0);
				rows.push(sample(tag + "-penup"));
			}
			rows.push(sample(tag + "-post-" + j));
		}
		return rows;
	},
};
`;

let browser: Browser, script: string;
const record: unknown[] = [];

beforeAll(async () => {
	const from = "if (!offset || (!state && offset.x === 0 && offset.y === 0)) return;";
	const to = 'if (offset && state) console.log("CANCEL-BOUNCE-ACTIVE", JSON.stringify({x:offset.x,y:offset.y}), new Error().stack);\n\t\tif (!offset || (!state && offset.x === 0 && offset.y === 0)) return;';
	let planted = 0;
	const b = await build({ stdin: { contents: PAGE, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts", sourcefile: "penProbePage.ts" },
		bundle: true, write: false, format: "iife", platform: "browser", alias: { obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)) },
		plugins: [{ name: "s105-cancel-log", setup(builder) {
			builder.onLoad({ filter: /src[\\/]inline[\\/]InkOverlay\.ts$/ }, args => {
				const text = readFileSync(args.path, "utf8");
				if (text.split(from).length !== 2) throw new Error("s105 pen probe: cancelOverscrollBounce anchor not found once");
				planted++;
				return { loader: "ts", contents: text.replace(from, to) };
			});
		} }] });
	if (!planted) throw new Error("s105 pen probe: patch never applied");
	script = b.outputFiles[0]!.text;
	browser = await chromium.launch({ headless: true });
}, 180_000);
afterAll(async () => {
	await browser?.close();
	if (process.env.HW_PEN_OUT) writeFileSync(process.env.HW_PEN_OUT, JSON.stringify(record, null, 1));
});

const call = (p: Page, method: string, ...args: unknown[]) => p.evaluate(([m, a]) => (window as any).penProbe[m](...a), [method, args] as const);

async function withPage(fn: (p: Page, logs: string[]) => Promise<void>) {
	const p = await browser.newPage({ viewport: { width: 1800, height: 900 }, hasTouch: true });
	const logs: string[] = [];
	p.on("console", m => { if (m.text().startsWith("CANCEL-BOUNCE-ACTIVE")) logs.push(m.text()); });
	const errors: string[] = [];
	p.on("pageerror", e => errors.push(String(e.message).slice(0, 200)));
	await p.setContent('<!doctype html><body style="margin:0"></body>');
	await p.addStyleTag({ content: css + REAL_OBSIDIAN_CSS });
	await p.addScriptTag({ content: script });
	await fn(p, logs);
	if (errors.length) record.push({ pageErrors: errors });
	await p.close();
}

it("a pen stroke landing during the post-lift glide does not strand the page: rest reaches the bound after pen-up", async () => {
	let rest: any, penup: any, cancelLogs: string[] = [];
	await withPage(async (p, logs) => {
		await call(p, "mount", "p");
		const rows = await call(p, "pinchOutThenPenStroke", 0.10, 0.6, "p") as any[];
		rest = rows.at(-1);
		penup = rows.find(r => r.phase.endsWith("-penup"));
		cancelLogs = logs;
		record.push({ rows, cancelLogs: logs, rest, penup });
	});
	// s189: THE EASE IS BACK UNDER THE CANVAS, so this premise is the original one again. s188 had it pinned
	// the other way - nothing played, so nothing could be cancelled - because the true-travel capture ran
	// canvas-off only. With s189's capture the lift eases under the canvas too and a contact cancels it,
	// which is what this cell has always been about.
	expect(cancelLogs.length, "premise: the pen contact really did cancel a playing ease").toBeGreaterThan(0);
	// THE EASE ITSELF, not just where it ends up (Reviewer, s107): two endpoints, right after the lift and at
	// rest - a mere park (the page silently placed at its bound with no ease) would pass a rest-only check.
	// s107's own clause, back with the ease: two endpoints, right after the lift and at rest, so a silent
	// park cannot pass a rest-only check.
	expect(Math.abs(penup.bounce.x), "the resume actually started an ease: offset non-zero right after the lift").toBeGreaterThan(0.5);
	expect(rest.bounce.active, "the ease finished by the time the page is read at rest").toBe(false);
	expect(Math.abs(rest.bounce.x), "the offset decayed to 0, not left standing").toBeLessThanOrEqual(0.5);
	expect(Math.abs(rest.panX), `pan resumed to its bound instead of freezing where the pen landed (rest ${JSON.stringify(rest)})`).toBeLessThanOrEqual(0.5);
	// Negative-X ink earns native scroll room. Rest may scroll within that
	// room; it must not expose blank space beyond the saved ink's left bound.
	expect(rest.leftEdgePx).toBeGreaterThanOrEqual(-0.5);
	expect(rest.leftEdgePx).toBeLessThanOrEqual(rest.inkReservePx + 0.5);
	expect(Math.abs(rest.leftEdgePx + rest.scrollPx - rest.inkReservePx), "native scroll can reach the ink bound without surplus blank space").toBeLessThanOrEqual(0.5);
}, 60_000);
