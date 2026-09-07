/**
 * The page half of the document-top settle measurement: a REAL CodeMirror
 * `EditorView`, so the two ways `view.documentTop` can move after a stroke
 * is stored are told apart by measurement rather than by reading
 * `@codemirror/view/dist/index.js`.
 *
 * `documentTop` is one sum (view/dist/index.js:8036-8037):
 *
 *     documentTop = contentDOM.getBoundingClientRect().top + viewState.paddingTop
 *
 * and the two terms settle by different mechanisms:
 *
 *   P - `viewState.paddingTop` is 0 from construction (:5929) until the
 *       first measure cycle writes `parseInt(getComputedStyle(contentDOM)
 *       .paddingTop) * scaleY` into it (:6065-6070). That cycle runs from
 *       the rAF the constructor requests (:7617). The CSS padding is in
 *       force the whole time, so the TEXT does not move when P latches -
 *       only the number does.
 *   R - something above `.cm-content` inside the scroller (Obsidian's inline
 *       title, its properties block, a font swap) grows. `.cm-content` and
 *       every line in it move down by the same amount. The rect is read
 *       live, so `documentTop` follows at once; nothing resizes, so no
 *       observer fires.
 *
 * The node half (`UnsettledTopMechanisms.test.ts`) holds the assertions. This
 * file builds the editor, exposes the two knobs, and reports numbers. What
 * is REAL: the editor, its `documentTop`, `documentPadding` and `scaleY`
 * getters, the `Camera` and `visualToNote` the overlay stores and paints
 * through. What STANDS IN: the overlay container is a bare absolutely
 * positioned div in the scroller, at scale 1 and font zoom 1, because the
 * question is about the y anchor and nothing else.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Camera } from "../../src/camera/Camera";
import { visualToNote } from "../../src/inline/ZoomScale";
import { anchorTop } from "../../src/inline/DocumentTop";

export interface TopReading {
	/** `view.documentTop`, client px: the y every stored stroke is measured from. */
	documentTop: number;
	/** `view.documentPadding.top`: what CodeMirror currently BELIEVES the padding is. */
	believedPadding: number;
	/**
	 * CodeMirror's own formula for the padding, evaluated now
	 * (`ViewState.measure`, view/dist/index.js:6065): what the belief will
	 * become at the next measure cycle.
	 */
	declaredPadding: number;
	/** `.cm-content`'s rect top, client px. */
	contentTop: number;
	/** The first `.cm-line`'s rect top, client px: where the text actually is. */
	lineTop: number;
	/** Updates with `geometryChanged` so far: how many measure cycles moved something. */
	geometryUpdates: number;
}

export interface MountOptions {
	/** `.cm-content`'s padding-top, px. Minimal's `0.5em` at 16px is 8. */
	paddingTop: number;
}

interface TopApi {
	/** Build a fresh editor and read it SYNCHRONOUSLY, before any frame has run. */
	mount(o: MountOptions): TopReading;
	read(): TopReading;
	/** Grow the block that sits above `.cm-content` in the scroller. */
	growAbove(px: number): void;
	/** Two frames, then read: CodeMirror's measure is a rAF callback. */
	settle(): Promise<TopReading>;
	/**
	 * What the overlay would STORE for a pen at this client y, right now:
	 * `syncCamera`'s camera from the current `documentTop`, then the router's
	 * `visualToNote` and `camera.screenToWorld`.
	 *
	 * CodeMirror's REPORTED top, which is what `syncCamera` read before
	 * `anchorTop`. Kept as it was so the two mechanism measurements below
	 * still measure the same thing they measured, and so the fixed pair has
	 * something to be compared against inside one run.
	 */
	store(clientY: number): number;
	/** Where a stored world y PAINTS right now, client px: the inverse, through the same camera. */
	paint(worldY: number): number;
	/**
	 * The same two, through the SHIPPED `anchorTop` - the real
	 * `src/inline/DocumentTop.ts`, imported, not a copy of its arithmetic - so
	 * what the acceptance test measures is the function `syncCamera` calls.
	 */
	storeAnchored(clientY: number): number;
	paintAnchored(worldY: number): number;
}

declare global {
	interface Window {
		__hwtop: TopApi;
	}
}

let view: EditorView | null = null;
let above: HTMLElement | null = null;
let overlay: HTMLElement | null = null;
let geometryUpdates = 0;
const camera = new Camera();

function must<T>(v: T | null, what: string): T {
	if (v === null) throw new Error(`${what} is not mounted`);
	return v;
}

function mount(o: MountOptions): TopReading {
	view?.destroy();
	view = null;
	document.head.querySelectorAll("style[data-hwtop]").forEach((s) => s.remove());
	document.body.replaceChildren();
	const style = document.createElement("style");
	style.setAttribute("data-hwtop", "");
	// CodeMirror's base theme sets `.cm-scroller { display: flex !important;
	// align-items: flex-start !important }` (view/dist/index.js:6526-6535),
	// which lays a sibling of `.cm-content` out BESIDE it. A column is what
	// Obsidian's scroller stacks (`.cm-sizer` holds the inline title, the
	// properties block and `.cm-contentContainer` one above the other), and
	// it is the arrangement in which "something above `.cm-content` grew"
	// means anything. Three classes outrank the theme's two.
	style.textContent = [
		"body { margin: 0; }",
		".cm-editor.cm-editor.cm-editor { height: 600px; }",
		".cm-editor.cm-editor.cm-editor .cm-scroller { flex-direction: column !important; align-items: stretch !important; }",
		`.cm-editor.cm-editor.cm-editor .cm-content { padding-top: ${o.paddingTop}px; }`,
		".hw-above { height: 0px; flex: none; }",
		".hw-overlay { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }",
	].join("\n");
	document.head.appendChild(style);
	const host = document.createElement("div");
	document.body.appendChild(host);
	geometryUpdates = 0;
	view = new EditorView({
		state: EditorState.create({
			doc: "one\ntwo\nthree\nfour\nfive",
			extensions: [
				EditorView.updateListener.of((u) => {
					if (u.geometryChanged) geometryUpdates++;
				}),
			],
		}),
		parent: host,
	});
	above = document.createElement("div");
	above.className = "hw-above";
	view.scrollDOM.insertBefore(above, view.contentDOM);
	overlay = document.createElement("div");
	overlay.className = "hw-overlay";
	view.scrollDOM.appendChild(overlay);
	return read();
}

function read(): TopReading {
	const v = must(view, "view");
	const style = getComputedStyle(v.contentDOM);
	const line = v.contentDOM.querySelector(".cm-line");
	if (!(line instanceof HTMLElement)) throw new Error("no .cm-line rendered");
	return {
		documentTop: v.documentTop,
		believedPadding: v.documentPadding.top,
		declaredPadding: (parseInt(style.paddingTop) || 0) * v.scaleY,
		contentTop: v.contentDOM.getBoundingClientRect().top,
		lineTop: line.getBoundingClientRect().top,
		geometryUpdates,
	};
}

function growAbove(px: number): void {
	must(above, "above").style.height = `${px}px`;
}

function settle(): Promise<TopReading> {
	return new Promise((done) => {
		requestAnimationFrame(() => requestAnimationFrame(() => done(read())));
	});
}

/**
 * `InkOverlay.syncCamera` at scale 1, font zoom 1: the y term only.
 *
 * `anchored` picks which document top it builds the camera from - CodeMirror's
 * reported `documentTop`, which is what the overlay read before this slice, or
 * `anchorTop`'s, which is what it reads now. The overlay passes the padding in
 * from the live `getComputedStyle(contentDOM)` object it already holds; here
 * the object is fetched at the call, because this page holds no such cache and
 * the question is the anchor, not what it cost to read.
 */
function sync(anchored: boolean): DOMRect {
	const v = must(view, "view");
	const rect = must(overlay, "overlay").getBoundingClientRect();
	const top = anchored ? anchorTop(v, getComputedStyle(v.contentDOM).paddingTop) : v.documentTop;
	camera.setState(0, visualToNote(rect.top - top, 1), 1);
	return rect;
}

function storeVia(anchored: boolean, clientY: number): number {
	const rect = sync(anchored);
	return camera.screenToWorld(0, visualToNote(clientY - rect.top, 1)).y;
}

function paintVia(anchored: boolean, worldY: number): number {
	const rect = sync(anchored);
	return rect.top + camera.worldToScreen(0, worldY).y;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
	window.__hwtop = {
		mount,
		read,
		growAbove,
		settle,
		store: (clientY) => storeVia(false, clientY),
		paint: (worldY) => paintVia(false, worldY),
		storeAnchored: (clientY) => storeVia(true, clientY),
		paintAnchored: (worldY) => paintVia(true, worldY),
	};
}
