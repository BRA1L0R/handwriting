import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import { InkOverlayPlugin, inlineInk } from "../../src/inline/InkOverlay";
import { inkApplied, inkEffect, inkHistorySupport, type InkOp } from "../../src/inline/InkHistory";
import { onInkChanged } from "../../src/inline/InkEvents";
import { initEmbedInkRefresh, attachEmbedInk, embedInkChanged, teardownEmbedInk, disarmPrintSwaps } from "../../src/inline/EmbedInk";
import * as embedInk from "../../src/inline/EmbedInk";
import type { InkStroke } from "../../src/ink/Stroke";
import { installObsidianDom } from "./obsidianDom";

installObsidianDom();
function stroke(id: string, y = 10): InkStroke {
	return { id, tool: "pen", color: "#000000", width: 4, createdAt: 0,
		points: [{ x: 10, y, pressure: 0.5, t: 0 }, { x: 90, y: y + 30, pressure: 0.5, t: 8 }],
		bbox: { x: 6, y: y - 4, width: 90, height: 40 } };
}
type Kind = "replace-empty" | "replace-pieces" | "snap" | "add" | "remove" | "move";
export interface Picture { ids: string[]; pixels: number[]; hashes: number[]; notifications: string[][]; ok: boolean; }

function run(kind: Kind): Picture[] {
	const path = `${kind}.md`;
	const original = stroke("original"), piece = stroke("piece", 45);
	const overlay = Object.create(InkOverlayPlugin.prototype) as any;
	Object.assign(overlay, { filePath: () => path, selection: { prune() {} },
		scheduleRepaint() {}, repaintPath() {}, updateExtent() {} });
	const editorHost = document.body.appendChild(document.createElement("div"));
	const view = new EditorView({ parent: editorHost, state: EditorState.create({ doc: "note", extensions: [
		history(), inkHistorySupport(), EditorView.updateListener.of(update => {
			for (const tr of update.transactions) if (!tr.annotation(inkApplied)) {
				for (const effect of tr.effects) if (effect.is(inkEffect)) overlay.applyInkOp(effect.value);
			}
		}),
	] }) });
	overlay.view = view;
	const roots = [0, 1].map(() => {
		const root = document.body.appendChild(document.createElement("div"));
		root.className = "markdown-embed-content";
		root.style.cssText = "width:300px;height:150px;position:relative";
		return root;
	});
	const notifications: string[][] = [];
	initEmbedInkRefresh(p => inlineInk.strokes(p));
	for (const root of roots) attachEmbedInk(root, path, []);
	const off = onInkChanged(p => {
		embedInkChanged(p);
		if (p === path) notifications.push(inlineInk.strokes(path).map(s => s.id));
	});
	const picture = (ok = true): Picture => {
		const canvases = roots.map(root => root.querySelector("canvas"));
		const data = canvases.map(canvas => canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data);
		return { ok, ids: inlineInk.strokes(path).map(s => s.id), notifications: notifications.splice(0),
			pixels: data.map(bytes => { let count = 0; if (bytes) for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) count++; return count; }),
			hashes: data.map(bytes => { let hash = 0; if (bytes) for (let i = 3; i < bytes.length; i += 4) hash = (hash + i * bytes[i]!) >>> 0; return hash; }) };
	};
	try {
		inlineInk.commit(path, original);
		if (kind === "snap" || kind === "add") overlay.dispatchInk({ type: "add", path, strokes: [original] });
		const initial = picture();
		if (kind === "snap") overlay.takeSnapOffer(path, original, piece);
		else if (kind !== "add") {
			let op: InkOp;
			if (kind === "move") {
				inlineInk.moveStrokes(path, [original.id], 0, 35); inlineInk.save(path);
				op = { type: "move", path, strokeIds: [original.id], dx: 0, dy: 35 };
			} else {
				inlineInk.takeLive(path, [original.id]);
				const pieces = kind === "replace-pieces" ? [piece] : [];
				inlineInk.applyAddLive(path, pieces, [0]); inlineInk.save(path);
				op = kind === "remove" ? { type: "remove", path, strokes: [original], indices: [0] }
					: { type: "replace", path, removed: [original], removedAt: [0], inserted: pieces, insertedAt: [0] };
			}
			overlay.dispatchInk(op);
		}
		const forward = picture();
		const undone = picture(undo(view));
		const redone = picture(redo(view));
		const results = [initial, forward, undone, redone];
		if (kind === "snap") {
			results.push(picture(undo(view)), picture(undo(view)));
			overlay.takeSnapOffer(path, original, piece);
			results.push(picture(!undo(view)));
		}
		return results;
	} finally {
		off(); teardownEmbedInk(); disarmPrintSwaps(); view.destroy(); editorHost.remove();
		for (const root of roots) root.remove();
		inlineInk.handleDelete(path);
	}
}
(window as unknown as { embedReplacement: typeof run }).embedReplacement = run;

async function readingRecovery(popout: boolean) {
	const frame = popout ? document.body.appendChild(document.createElement("iframe")) : null;
	const doc = frame?.contentDocument ?? document;
	const win = doc.defaultView!;
	const realm = win as Window & typeof globalThis;
	const NativeRO = realm.ResizeObserver, NativeMO = realm.MutationObserver;
	const observers: Array<{ stopped: boolean; targets: Set<Node>; kind: string }> = [];
	realm.ResizeObserver = class extends NativeRO {
		readonly record = { stopped: false, targets: new Set<Node>(), kind: "resize" };
		constructor(callback: ResizeObserverCallback) { super(callback); observers.push(this.record); }
		observe(target: Element, options?: ResizeObserverOptions): void {
			this.record.targets.add(target); super.observe(target, options);
		}
		unobserve(target: Element): void { this.record.targets.delete(target); super.unobserve(target); }
		disconnect(): void { this.record.stopped = true; this.record.targets.clear(); super.disconnect(); }
	};
	realm.MutationObserver = class extends NativeMO {
		readonly record = { stopped: false, targets: new Set<Node>(), kind: "mutation" };
		constructor(callback: MutationCallback) { super(callback); observers.push(this.record); }
		observe(target: Node, options?: MutationObserverInit): void {
			this.record.targets.add(target); super.observe(target, options);
		}
		disconnect(): void { this.record.stopped = true; this.record.targets.clear(); super.disconnect(); }
	};
	if (frame) {
		for (const style of document.querySelectorAll("style")) doc.head.appendChild(style.cloneNode(true));
		const proto = (win as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement.prototype;
		proto.createEl = HTMLElement.prototype.createEl;
		proto.setCssStyles = HTMLElement.prototype.setCssStyles;
	}
	const view = doc.body.appendChild(doc.createElement("div"));
	view.className = "markdown-preview-view";
	view.style.cssText = "position:relative;width:600px;height:200px;overflow:auto;padding:0";
	const makeSizer = (width: number, top: number) => {
		const el = doc.createElement("div");
		el.className = "markdown-preview-sizer";
		el.style.cssText = `width:${width}px;height:800px;margin:${top}px auto 0;padding:0;max-width:none`;
		el.appendChild(doc.createElement("p")).textContent = "reading view content";
		return el;
	};
	let sizer = view.appendChild(makeSizer(400, 24));
	let reads = 0;
	const ink = [{ ...stroke("reading"), color: "#ffffff" }];
	const strokes = () => { reads++; return ink; };
	initEmbedInkRefresh(strokes);
	const settle = async () => {
		for (let i = 0; i < 3; i++) await new Promise<void>(resolve => win.requestAnimationFrame(() => resolve()));
	};
	const watchCount = () => (embedInk as unknown as { embedInkAnchorWatchCount?(): number }).embedInkAnchorWatchCount?.() ?? -1;
	const gap = (el: Element | null) => {
		if (!el) return null;
		const a = el.getBoundingClientRect(), b = sizer.getBoundingClientRect();
		return [a.left - b.left, a.top - b.top];
	};
	try {
		embedInk.attachEmbedInkOnceReady(sizer.firstElementChild as HTMLElement, view, "reading.md", strokes);
		await settle();
		const canvas = view.querySelector("canvas");
		const initial = { parent: canvas?.parentElement?.className, gap: gap(canvas), watches: watchCount() };
		// Obsidian owns the sizer's children. No second postprocessor call.
		sizer.replaceChildren(doc.createElement("p"));
		await settle();
		const survivedEviction = canvas !== null && canvas.isConnected;
		const replacement = makeSizer(300, 40);
		sizer.replaceWith(replacement); sizer = replacement;
		await settle();
		const replacementGap = gap(canvas);
		// Root stays 600px wide: only the new sizer emits this ResizeObserver event.
		sizer.style.width = "200px";
		await settle();
		const resizeGap = gap(canvas);
		const readsAfterResize = reads;
		const currentSizerObserved = observers.some(o => o.kind === "resize" && o.targets.has(sizer));
		view.scrollTop = 80;
		await settle();
		const scrollGap = gap(canvas);
		view.style.display = "none";
		await settle();
		view.style.display = "block"; view.style.width = "700px";
		await settle();
		const modeGap = gap(canvas);
		const pixels = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
		const painted = pixels?.some((value, i) => i % 4 === 3 && value > 0) ?? false;
		const nested = sizer.appendChild(doc.createElement("div"));
		nested.className = "markdown-embed-content";
		nested.style.cssText = "position:relative;width:250px;height:100px";
		const innerView = nested.appendChild(doc.createElement("div"));
		innerView.className = "markdown-preview-view";
		const innerSizer = innerView.appendChild(makeSizer(180, 0));
		embedInk.attachEmbedInkOnceReady(innerSizer.firstElementChild as HTMLElement, innerView, "nested.md", () => ink);
		const nestedParent = nested.querySelector("canvas")?.parentElement === nested;
		win.dispatchEvent(new (win as unknown as { Event: typeof Event }).Event("beforeprint"));
		await settle();
		const svg = view.querySelector(":scope > svg.handwriting-embed-ink");
		const printGap = gap(svg);
		const printFill = svg?.querySelector("path")?.getAttribute("fill");
		sizer.style.width = "260px";
		await settle();
		const resizedPrintGap = gap(svg);
		win.dispatchEvent(new (win as unknown as { Event: typeof Event }).Event("afterprint"));
		const printRestored = !view.querySelector(":scope > svg") && canvas?.style.display !== "none";
		view.remove();
		await settle();
		const detachedWatches = watchCount();
		const detachedObserversStopped = observers.every(o => o.stopped);
		doc.body.appendChild(view);
		embedInk.attachEmbedInkOnceReady(sizer.firstElementChild as HTMLElement, view, "reading.md", strokes);
		sizer.style.width = "320px";
		await settle();
		const reenteredGap = gap(canvas);
		const reenteredWatches = watchCount();
		teardownEmbedInk(); disarmPrintSwaps();
		const stoppedWatches = watchCount();
		const allObserversStopped = observers.length > 0 && observers.every(o => o.stopped);
		const layersRemoved = view.querySelector("canvas.handwriting-embed-ink, svg.handwriting-embed-ink") === null;
		return { initial, survivedEviction, replacementGap, resizeGap, readsAfterResize,
			scrollGap, modeGap, painted, nestedParent, printGap, printFill, resizedPrintGap,
			printRestored, detachedWatches, stoppedWatches, currentSizerObserved,
			detachedObserversStopped, reenteredGap, reenteredWatches, allObserversStopped, layersRemoved };
	} finally {
		teardownEmbedInk(); disarmPrintSwaps(); view.remove(); frame?.remove();
		realm.ResizeObserver = NativeRO; realm.MutationObserver = NativeMO;
	}
}
(window as unknown as { readingRecovery: typeof readingRecovery }).readingRecovery = readingRecovery;
