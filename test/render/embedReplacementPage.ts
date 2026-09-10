import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import { InkOverlayPlugin, inlineInk } from "../../src/inline/InkOverlay";
import { inkApplied, inkEffect, inkHistorySupport, type InkOp } from "../../src/inline/InkHistory";
import { onInkChanged } from "../../src/inline/InkEvents";
import { initEmbedInkRefresh, attachEmbedInk, embedInkChanged, teardownEmbedInk, disarmPrintSwaps } from "../../src/inline/EmbedInk";
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
