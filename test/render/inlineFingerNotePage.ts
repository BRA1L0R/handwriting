import { InlinePenRouter } from "../../src/inline/InlinePenRouter";

interface Snapshot {
	downs: number;
	ups: number;
	cancels: number;
	raw: number;
	pinches: string[];
	scrollTop: number;
	selection: string;
	touchAction: string;
	downPrevented: boolean;
}

const root = document.createElement("div");
root.style.cssText = "position:relative;width:390px;height:700px;overflow:auto;touch-action:auto";
(root as HTMLElement & { setCssStyles(styles: Partial<CSSStyleDeclaration>): void }).setCssStyles =
	(styles) => Object.assign(root.style, styles);
const editor = document.createElement("div");
editor.contentEditable = "true";
editor.style.cssText = "height:1800px;padding:20px";
editor.textContent = "ordinary note text ".repeat(400);
root.appendChild(editor);
document.body.appendChild(root);

let enabled = true;
let downs = 0;
let ups = 0;
let cancels = 0;
let raw = 0;
const pinches: string[] = [];

new InlinePenRouter(root, root, {
	onPenDown: () => void downs++,
	onPenHover: () => {},
	onPenLeave: () => {},
	onPinch: (phase) => void pinches.push(phase),
	onPenRaw: (samples) => void (raw += samples.length),
	onPenMove: () => {},
	onPenUp: () => void ups++,
	fingerInk: () => enabled,
	onFingerInkCancelled: () => void cancels++,
});

function fire(
	type: string,
	pointerId: number,
	x: number,
	y: number,
	buttons: number
): PointerEvent {
	const ev = new PointerEvent(type, {
		bubbles: true,
		cancelable: true,
		pointerType: "touch",
		pointerId,
		isPrimary: pointerId === 1,
		clientX: x,
		clientY: y,
		buttons,
		pressure: buttons === 0 ? 0 : 0.5,
	});
	editor.dispatchEvent(ev);
	return ev;
}

function selectionText(): string {
	return document.getSelection()?.toString() ?? "";
}

function resetCounts(): void {
	downs = 0;
	ups = 0;
	cancels = 0;
	raw = 0;
	pinches.length = 0;
}

function snapshot(downPrevented: boolean): Snapshot {
	return {
		downs,
		ups,
		cancels,
		raw,
		pinches: [...pinches],
		scrollTop: root.scrollTop,
		selection: selectionText(),
		touchAction: getComputedStyle(root).touchAction,
		downPrevented,
	};
}

const api = {
	draw(): Snapshot {
		resetCounts();
		enabled = true;
		root.scrollTop = 240;
		const range = document.createRange();
		range.selectNodeContents(editor);
		range.setEnd(editor.firstChild!, 8);
		const selection = document.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		const before = selectionText();
		const down = fire("pointerdown", 1, 60, 120, 1);
		fire("pointermove", 1, 90, 150, 1);
		fire("pointerup", 1, 90, 150, 0);
		const out = snapshot(down.defaultPrevented);
		if (selectionText() !== before) throw new Error("finger ink changed the editor selection");
		return out;
	},
	pinch(): Snapshot {
		resetCounts();
		enabled = true;
		const down = fire("pointerdown", 1, 60, 120, 1);
		fire("pointermove", 1, 75, 120, 1);
		fire("pointerdown", 2, 180, 120, 1);
		fire("pointermove", 2, 240, 120, 1);
		fire("pointerup", 2, 240, 120, 0);
		fire("pointerup", 1, 75, 120, 0);
		return snapshot(down.defaultPrevented);
	},
	nativeAfterKeyboard(): Snapshot {
		resetCounts();
		enabled = false;
		const down = fire("pointerdown", 3, 80, 180, 1);
		fire("pointerup", 3, 80, 180, 0);
		return snapshot(down.defaultPrevented);
	},
};

(window as unknown as Window & { inlineFingerNote: typeof api }).inlineFingerNote = api;
