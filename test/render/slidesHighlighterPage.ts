/** Real SlidesDeck paint, input and history; the Obsidian host and persistence are fixtures. */
import { SlidesDeck, type SlideNib, type SlidesInkHost } from "../../src/slides/SlidesInkSurface";
import { emptyPage, type PageData } from "../../src/model/PageData";
import { setPenToolsMode } from "../../src/inline/PenToolsMode";
import { frames, gesture, installHostDom, line, sample, type Pt } from "./penMarks";

installHostDom();
let deck: SlidesDeck, reveal: HTMLElement, slides: HTMLElement, container: HTMLElement;
let saved: PageData | null = null;
let nib: SlideNib = { tool: "pen", color: "#e6e6e6", width: 8.8 };
let pointer = 1800, live: { target: Element; id: number; last: Pt } | null = null;
let keepAlive: ReturnType<typeof setInterval> | undefined;
let dark = true;
const center = { x: 411, y: 357 };
const points = {
	paper: { x: 191, y: 467 }, wash: { x: 561, y: 357 }, crossing: { x: 451, y: 357 },
	crossWash: { x: 451, y: 327 }, head: { x: 451, y: 431 },
	text: { x: 451, y: 405 }, image: { x: 451, y: 290 },
};
const penColor = () => dark ? "#e6e6e6" : "#1c1f26";
function build() {
	container = document.body.createDiv({ cls: "slides-container" });
	container.style.cssText = `position:absolute;left:31px;top:27px;width:1000px;height:760px;background:${dark ? "#1e1e1e" : "#ffffff"};`;
	reveal = container.createDiv({ cls: "reveal" });
	reveal.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden";
	slides = reveal.createDiv({ cls: "slides" });
	slides.style.cssText = "position:absolute;left:20px;top:30px;width:960px;height:700px;transform:scale(1);transform-origin:0 0";
	const section = slides.createEl("section", { cls: "present" });
	section.style.cssText = "width:960px;height:700px";
	const text = section.createDiv({ text: "H" });
	text.id = "highlight-slide-text";
	text.style.cssText = `position:absolute;left:381px;top:325px;font:bold 48px/48px monospace;color:${penColor()};`;
	const img = section.createEl("img");
	img.id = "highlight-slide-image";
	img.style.cssText = "position:absolute;left:388px;top:225px;width:24px;height:24px";
	img.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#3264c8"/></svg>');
	const save = (_id: string, page: PageData) => { saved = structuredClone(page); };
	const host: SlidesInkHost = {
		activeFilePath: () => "highlighter.md", readSource: async () => "H",
		readPageId: () => "highlight-fixture", claimId: async () => ({ pageId: "highlight-fixture" }), newPageId: () => "highlight-fixture",
		loadSidecar: async () => ({ data: structuredClone(saved ?? emptyPage("highlight-fixture.slides")), recovered: false }),
		scheduleSidecar: save, saveSidecarNow: async (id, page) => save(id, page),
		nib: () => nib, eraserRadiusPx: () => 8, eraseWholeStrokes: () => true,
		notify: () => {}, buildId: "slides-highlighter-fixture",
	};
	deck = new SlidesDeck(container, reveal, slides, host);
}
async function open(isDark = true) {
	clearInterval(keepAlive); live = null; deck?.dispose(); container?.remove(); saved = null; dark = isDark;
	document.body.className = dark ? "theme-dark" : "theme-light";
	setPenToolsMode("show"); build(); await frames(4);
	return { points, clip: { x: 31, y: 27, width: 1000, height: 760 } };
}
async function pen(hold = false) {
	nib = { tool: "pen", color: penColor(), width: 8.8 };
	const path = line({ x: center.x - 80, y: center.y }, { x: center.x + 80, y: center.y });
	if (hold) await startContact(path);
	else await gesture(path, ++pointer, 0.8);
}
async function firstWash() {
	nib = { tool: "highlighter", color: "#ffd60a", width: 32 };
	await gesture(line({ x: center.x - 140, y: center.y }, { x: center.x + 180, y: center.y }), ++pointer, 0.8);
}
function fire(type: string, p: Pt, buttons = 1) {
	if (!live) throw new Error("no live contact");
	live.target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true,
		pointerType: "pen", pointerId: live.id, isPrimary: true, clientX: p.x, clientY: p.y,
		buttons, button: type === "pointermove" ? -1 : 0, pressure: buttons ? 0.8 : 0 }));
}
async function secondWash() {
	nib = { tool: "highlighter", color: "#ffd60a", width: 32 };
	const path = line({ x: 451, y: 267 }, { x: 451, y: 437 }, 5);
	await startContact(path);
}
async function startContact(path: Pt[]) {
	live = { target: document.elementFromPoint(path[0]!.x, path[0]!.y)!, id: ++pointer, last: path[path.length - 1]! };
	fire("pointerdown", path[0]!);
	for (const p of path.slice(1)) { await frames(1); fire("pointermove", p); }
	// Keep this real contact alive while the test asks Chromium for a screenshot.
	// Otherwise the production 300 ms silent-lift timer can commit before sampling.
	keepAlive = setInterval(() => { if (live) fire("pointermove", live.last); }, 50);
}
function lift() {
	clearInterval(keepAlive);
	if (live) fire("pointerup", live.last, 0);
	live = null;
	return state();
}
function state() {
	return { saved: structuredClone(saved), status: deck.status(),
		contactPhase: (deck as unknown as { session: { phase: string } }).session.phase,
		canvases: [...reveal.querySelectorAll("canvas")].map(c => ({ cls: c.className, width: c.width, height: c.height,
			left: c.getBoundingClientRect().left, top: c.getBoundingClientRect().top, opacity: getComputedStyle(c).opacity,
			parent: c.parentElement?.className })),
		wet: live !== null,
	};
}
async function eraseSecond() {
	// Eraser end in a part of the vertical swipe beyond both the pen and first wash.
	live = { target: reveal, id: ++pointer, last: { x: 455, y: 425 } };
	for (const [type, x] of [["pointerdown", 447], ["pointermove", 463], ["pointerup", 463]] as const) {
		reveal.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "pen", pointerId: live.id,
			isPrimary: true, clientX: x, clientY: 425, buttons: type === "pointerup" ? 0 : 32, button: 5, pressure: 0.8 }));
	}
	live = null; await frames(2); return state();
}
async function remount() { deck.dispose(); container.remove(); build(); await frames(4); return state(); }
async function resize() { container.style.width = "1040px"; container.style.height = "800px"; window.dispatchEvent(new Event("resize")); await frames(4); return state(); }
async function repairGroup() { reveal.querySelector(".handwriting-slides-highlight")?.remove(); window.dispatchEvent(new Event("resize")); await frames(4); return state(); }
const api = { open, pen, firstWash, secondWash, lift, state, eraseSecond, remount, resize, repairGroup, frames, sample,
	undo: async () => { const result = await deck.run("undo"); await frames(2); return { result, ...state() }; } };
declare global { interface Window { slidesHighlighter: typeof api } }
window.slidesHighlighter = api;
