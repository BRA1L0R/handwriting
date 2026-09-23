import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { inlineInk, inkOverlayExtension, overlayForPath, setScrollExpansionEnabled } from "../../src/inline/InkOverlay";
import { attachEmbedInk, embedInkChanged, initEmbedInkRefresh, teardownEmbedInk, disarmPrintSwaps } from "../../src/inline/EmbedInk";
import type { InkStroke } from "../../src/ink/Stroke";
import { installObsidianDom } from "./obsidianDom";
import { editorInfoField } from "./iphoneObsidianStub";

installObsidianDom();
inlineInk.attachHost({ readPageId: () => null, claimId: async (_path, pageId) => ({ pageId }),
	loadSidecar: async () => null, scheduleSidecar: () => {}, scheduleSidecarNow: async () => {}, notify: () => {} });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise<void>(r => requestAnimationFrame(() => r())); };
function stroke(id: string, x: number, y: number): InkStroke {
	return { id, tool: "pen", color: "#d00000", width: 6, createdAt: 1,
		points: [{ x, y, pressure: .5, t: 0 }, { x: x + 40, y: y + 20, pressure: .5, t: 20 }],
		bbox: { x: x - 6, y: y - 6, width: 52, height: 32 } };
}
const marks = [stroke("left", -180, 80), stroke("right", 800, 140), stroke("bottom", 100, 900)];

async function editorMargins(canvas: boolean, ownLines = false) {
	setScrollExpansionEnabled(canvas);
	const path = `margin-${canvas}.md`;
	const pane = document.body.appendChild(document.createElement("div"));
	pane.className = "markdown-source-view mod-cm6 is-readable-line-width";
	pane.style.cssText = "position:relative;width:1200px;height:500px;overflow:hidden";
	const theme = document.head.appendChild(document.createElement("style"));
	if (ownLines) theme.textContent = ".markdown-source-view.mod-cm6.is-readable-line-width .cm-sizer,.markdown-source-view.mod-cm6.is-readable-line-width .cm-content{max-width:none !important}.markdown-source-view.mod-cm6 .cm-content > *{max-width:700px;margin-inline:auto !important}";
	const view = new EditorView({ parent: pane, state: EditorState.create({ doc: "Markdown text\nSecond line", extensions: [
		EditorView.lineWrapping,
		editorInfoField.init(() => ({ app: { commands: { executeCommandById: () => false } }, file: { path }, editor: {} })),
		inkOverlayExtension(),
		EditorView.theme({ "&": { width: "100%", height: "500px" }, ".cm-scroller": { overflowX: "hidden", overflowY: "auto" },
			".cm-content": { fontSize: "16px", lineHeight: "24px" } }),
	] }) });
	const sizer = document.createElement("div"); sizer.className = "cm-sizer";
	const content = document.createElement("div"); content.className = "cm-contentContainer";
	view.contentDOM.before(sizer); sizer.appendChild(content); content.appendChild(view.contentDOM);
	await inlineInk.ensureLoaded(path);
	await settle();
	for (const mark of marks) inlineInk.commit(path, mark);
	const overlay = overlayForPath(path) as any;
	overlay.scheduleRepaint("margin-test");
	await settle();
	const scroller = view.scrollDOM;
	const read = () => {
		const sr = scroller.getBoundingClientRect();
		const origin = (overlay.columnLeft() - sr.left) / overlay.cssScale + scroller.scrollLeft;
		const bitmap: HTMLCanvasElement = overlay.committedCanvas;
		const br = bitmap.getBoundingClientRect();
		const x = (overlay.columnLeft() + overlay.panX() - 180 * overlay.scale - br.left) * bitmap.width / br.width;
		const y = (overlay.documentTopUnpanned() + overlay.panY() + 80 * overlay.scale - br.top) * bitmap.height / br.height;
		const bytes = bitmap.getContext("2d")!.getImageData(Math.floor(x - 8), Math.floor(y - 8), 64, 48).data;
		let pixels = 0; for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) pixels++;
		return { origin, left: origin + marks[0]!.bbox.x * overlay.fontZoom,
			pixels, sample: { x, y, canvasWidth: bitmap.width, canvasHeight: bitmap.height, top: scroller.scrollTop, panX: overlay.panX(), panY: overlay.panY() },
			margin: overlay.inkMargin?.x ?? 0, width: scroller.clientWidth, scrollWidth: scroller.scrollWidth,
			overflow: getComputedStyle(scroller).overflowX, zoom: overlay.pinchScaleNow,
			cameraLeft: overlay.camera.snapshot.x, strokes: inlineInk.strokes(path).length };
	};
	try {
		const wide = read();
		pane.style.width = "360px"; view.requestMeasure(); await settle();
		const narrow = read();
		const zooms = [];
		if (canvas) for (const factor of [.5, 2, 2, .5]) {
			if (!overlay.zoomNoteBy(factor)) throw Error(`zoom refused: ${JSON.stringify(overlay.getNoteViewportState())}`);
			await settle();
			scroller.scrollLeft = scroller.scrollTop = 0; await settle();
			zooms.push(read());
		}
		scroller.scrollLeft = scroller.scrollWidth; await settle();
		const right = { scrollLeft: scroller.scrollLeft, reach: scroller.scrollLeft + scroller.clientWidth,
			inkRight: read().origin + 846 };
		scroller.scrollLeft = 0; await settle();
		pane.style.width = "1200px"; view.requestMeasure(); await settle();
		scroller.scrollLeft = 0; await settle();
		const restored = read();
		pane.style.width = "360px"; view.requestMeasure(); await settle();
		for (const mark of marks) inlineInk.takeLive(path, [mark.id]);
		overlay.frontierCache.invalidate(path); overlay.scheduleRepaint("margin-delete"); await settle();
		const empty = read();
		return { wide, narrow, zooms, right, restored, empty };
	} finally { view.destroy(); pane.remove(); theme.remove(); inlineInk.handleDelete(path); }
}

async function readingMargins(onlyNegative: boolean) {
	let ink = onlyNegative ? [stroke("negative", -180, -80)] : marks;
	const root = document.body.appendChild(document.createElement("div"));
	root.className = "markdown-preview-view";
	root.style.cssText = "position:relative;width:1200px;height:400px;overflow-x:hidden;overflow-y:auto";
	let sizer = root.appendChild(document.createElement("div"));
	sizer.className = "markdown-preview-sizer";
	sizer.style.cssText = "width:700px;max-width:100%;height:120px;margin:0 auto";
	sizer.textContent = "Markdown text";
	initEmbedInkRefresh(() => ink);
	attachEmbedInk(root, "reading-margin.md", ink);
	await settle();
	const read = () => {
		const canvas = root.querySelector("canvas")!;
		const ctx = canvas.getContext("2d")!;
		const bounds = canvas.getBoundingClientRect(), text = sizer.getBoundingClientRect(), viewport = root.getBoundingClientRect();
		const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		let pixels = 0; for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) pixels++;
		return { pixels, left: bounds.left - viewport.left + root.scrollLeft, top: bounds.top - viewport.top + root.scrollTop,
			gap: bounds.left - text.left, width: bounds.width, height: bounds.height,
			range: root.scrollWidth - root.clientWidth, overflow: getComputedStyle(root).overflowX };
	};
	try {
		const wide = read();
		root.style.width = "360px"; await settle(); const narrow = read();
		root.scrollLeft = root.scrollWidth; root.scrollTop = root.scrollHeight; await settle();
		const end = { left: root.scrollLeft, top: root.scrollTop, right: root.scrollLeft + root.clientWidth, bottom: root.scrollTop + root.clientHeight };
		root.scrollLeft = root.scrollTop = 0;
		const replacement = sizer.cloneNode(true) as HTMLDivElement;
		sizer.replaceWith(replacement); sizer = replacement; await settle(); const replaced = read();
		window.dispatchEvent(new Event("beforeprint"));
		const svg = root.querySelector("svg")!;
		const print = { viewBox: svg.getAttribute("viewBox"), left: svg.getBoundingClientRect().left - root.getBoundingClientRect().left };
		window.dispatchEvent(new Event("afterprint"));
		ink = []; embedInkChanged("reading-margin.md"); await settle();
		const erased = { canvas: !!root.querySelector("canvas"), translated: sizer.classList.contains("handwriting-ink-margin"), overflow: getComputedStyle(root).overflowX };
		return { wide, narrow, end, replaced, print, erased };
	} finally { teardownEmbedInk(); disarmPrintSwaps(); root.remove(); }
}
(window as any).marginInk = { editorMargins, readingMargins };
