import { Modal, type App } from "obsidian";
import { installObsidianDom } from "./obsidianDom";
import { SlidesDeck, sectionHash, type SlidesInkHost } from "../../src/slides/SlidesInkSurface";
import { mountSlidesTools } from "../../src/slides/SlidesTools";
import { emptyPage, type PageData } from "../../src/model/PageData";
import type { InkStroke } from "../../src/ink/Stroke";
import { setPenToolsMode, type PenToolsMode } from "../../src/inline/PenToolsMode";
import { setMouseInk } from "../../src/inline/MouseInk";

installObsidianDom();
// Only the Obsidian modal shell is supplied; the production subclass builds
// its actual text/buttons and owns their callbacks.
Modal.prototype.open = function (this: Modal): void {
	this.containerEl = document.body.createDiv({ cls: "presentation-test-modal" });
	this.modalEl = this.containerEl.createDiv();
	this.contentEl = this.modalEl.createDiv();
	this.onOpen();
};
Modal.prototype.close = function (this: Modal): void { this.onClose(); this.containerEl.remove(); };

function stroke(id: string, page: number): InkStroke {
	return { id, page, tool: "pen", color: "#000000", width: 2, createdAt: 1,
		points: [{ x: 80, y: 80, pressure: 0.7, t: 0 }, { x: 100, y: 90, pressure: 0.7, t: 10 }],
		bbox: { x: 79, y: 79, width: 22, height: 12 } };
}

function openPresentation(nestedExit = false, unmatched = false) {
	setPenToolsMode("show");
	setMouseInk(true);
	const note = { text: "Underlying note text", ink: [stroke("note-only", 1)] };
	let saved: PageData = {
		...emptyPage("fixture.slides"), surface: "slides", coordSpace: "slide-logical",
		deck: { width: 960, height: 700 },
		slides: [{ index: 0, hash: sectionHash("Alpha") }, { index: 1, hash: sectionHash("Beta") }],
		strokes: [stroke("saved-first", 1), stroke("saved-second", 2)],
	};
	if (unmatched) {
		saved.strokes.push(stroke("retained-unmatched", 501));
		saved.slides!.push({ index: 500, hash: sectionHash("Removed section") });
	}
	const writes: string[] = [], commands: string[] = [], notices: string[] = [];
	const pointers: { type: string; pointerType: string; prevented: boolean; trusted: boolean; target: string }[] = [];
	let captures = 0, closed = 0, countAtExit: number | null = null;
	const originalCapture = Element.prototype.setPointerCapture;
	Element.prototype.setPointerCapture = function (id: number) { captures++; return originalCapture.call(this, id); };
	for (const type of ["pointerdown", "pointerup"]) document.addEventListener(type, event => {
		const e = event as PointerEvent;
		queueMicrotask(() => pointers.push({ type, pointerType: e.pointerType, prevented: e.defaultPrevented,
			trusted: e.isTrusted, target: (e.target as HTMLElement).id }));
	}, true);
	const container = document.body.createDiv({ cls: "slides-container" });
	const reveal = container.createDiv({ cls: "reveal" });
	const slides = reveal.createDiv({ cls: "slides" });
	const first = slides.createEl("section", { cls: "present", text: "Alpha" });
	const second = slides.createEl("section", { text: "Beta" });
	first.id = "slide-first";
	second.id = "slide-second";
	// Exercise both DOM ownership paths. Actual device host placement is unverified.
	const exit = (nestedExit ? reveal : container).createDiv({ cls: "slides-close-btn", attr: { role: "button", "aria-label": "Exit slides" } });
	exit.createSpan({ text: "Exit", attr: { id: "exit-icon" } });
	const save = (id: string, page: PageData) => { writes.push(id); saved = structuredClone(page); };
	const host: SlidesInkHost = {
		activeFilePath: () => "presentation.md", readSource: async () => "Alpha\n\n---\n\nBeta",
		readPageId: () => "fixture", claimId: async () => ({ pageId: "fixture" }), newPageId: () => "fixture",
		loadSidecar: async () => ({ data: structuredClone(saved), recovered: false }),
		scheduleSidecar: save, saveSidecarNow: async (id, page) => save(id, page),
		nib: () => ({ tool: "pen", color: "#000000", width: 2 }), eraserRadiusPx: () => 10,
		eraseWholeStrokes: () => true, notify: message => notices.push(message), buildId: "presentation-browser-fixture",
		mountTools: (parent, actions) => mountSlidesTools(parent, actions, {} as App, id => commands.push(id), message => notices.push(message)),
	};
	const deck = new SlidesDeck(container, reveal, slides, host);
	exit.addEventListener("click", () => { countAtExit = deck.status().totalCount; closed++; deck.dispose(); container.remove(); });
	let staleUndo: HTMLElement | null = null;
	return {
		status: () => deck.status(),
		setMode: (mode: PenToolsMode) => setPenToolsMode(mode),
		probe: () => ({ status: deck.status(), saved: structuredClone(saved), note: structuredClone(note), writes: [...writes],
			commands: [...commands], notices: [...notices], pointers: [...pointers], captures, closed, countAtExit,
			toolbarCount: document.querySelectorAll(".handwriting-slides-tools").length }),
		resetInput: () => { pointers.length = 0; captures = 0; },
		navigate: (index: number) => { first.classList.toggle("present", index === 0); second.classList.toggle("present", index === 1); },
		holdUndo: () => {
			staleUndo = [...container.querySelectorAll<HTMLElement>("button")].find(el => (el.getAttribute("aria-label") ?? el.dataset.tipLabel) === "Undo") ?? null;
			return staleUndo !== null;
		},
		invokeStale: () => { staleUndo?.click(); return deck.run("clear-current"); },
	};
}

declare global { interface Window { presentation: ReturnType<typeof openPresentation>; openPresentation: typeof openPresentation } }
window.openPresentation = openPresentation;
