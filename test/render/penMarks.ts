/**
 * Pen marks and composite sampling, shared by the highlighter pixel pages.
 *
 * Real PointerEvents at client points, the tool, colour and size set through
 * the production setters, and a screenshot decoder that reads what the
 * compositor produced. See `HighlighterPixels.test.ts` for what is measured.
 */
import { setInlineTool } from "../../src/inline/InkOverlay";
import { setInkColorHex } from "../../src/ink/InkColor";
import { installObsidianDom } from "./obsidianDom";

/** `obsidianDom.ts` plus the two Obsidian helpers the PDF controller also calls. */
export function installHostDom(): void {
	installObsidianDom();
	// Obsidian's `Node.instanceOf`, which the PDF controller's mutation filter
	// calls on every record's target: a realm-safe instanceof.
	(Node.prototype as unknown as Record<string, unknown>).instanceOf = function (
		this: Node,
		type: new () => unknown
	): boolean {
		return this instanceof type;
	};
	// Obsidian's own helper: every key is a CSS property, custom or not.
	(HTMLElement.prototype as unknown as Record<string, unknown>).setCssProps = function (
		this: HTMLElement,
		props: Record<string, string>
	): void {
		for (const [k, v] of Object.entries(props)) {
			const name = k.startsWith("--") ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
			this.style.setProperty(name, v);
		}
	};
}

export const frames = async (n = 8): Promise<void> => {
	for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
};

export const HIGHLIGHTER_HEX = "#ffd60a";

export interface Pt {
	x: number;
	y: number;
}

/** One pen gesture of real PointerEvents at client points, a frame per sample. */
export async function gesture(points: readonly Pt[], pointerId: number, pressure = 0.5): Promise<void> {
	const first = points[0]!;
	const target = document.elementFromPoint(first.x, first.y);
	if (!target) throw new Error(`no element under (${first.x},${first.y})`);
	const fire = (type: string, p: Pt, buttons: number, pressure: number): void => {
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				composed: true,
				pointerType: "pen",
				pointerId,
				isPrimary: true,
				clientX: p.x,
				clientY: p.y,
				buttons,
				button: type === "pointermove" ? -1 : 0,
				pressure,
			})
		);
	};
	fire("pointerdown", first, 1, pressure);
	for (const p of points.slice(1)) {
		await frames(1);
		fire("pointermove", p, 1, pressure);
	}
	await frames(1);
	const last = points[points.length - 1]!;
	fire("pointerup", last, 0, 0);
	await frames(8);
}

export function line(a: Pt, b: Pt, step = 10): Pt[] {
	const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
	return Array.from({ length: n + 1 }, (_, i) => ({
		x: a.x + ((b.x - a.x) * i) / n,
		y: a.y + ((b.y - a.y) * i) / n,
	}));
}

export type Order = "pen-first" | "highlighter-first";

/**
 * The marks, relative to a centre point: a pen word (a horizontal line), one
 * highlighter swipe along it and past its end, and a second swipe crossing
 * the first beyond the pen's end. Returned sample points are client px.
 */
export interface Marks {
	/** Inside the pen line, inside the horizontal swipe. */
	penCore: Pt;
	/** Inside the horizontal swipe only. */
	wash: Pt;
	/** Inside both swipes. */
	overlap: Pt;
	/** Inside the vertical swipe only. */
	crossWash: Pt;
	/** No ink. */
	paper: Pt;
}

export async function drawMarks(c: Pt, order: Order, penHex: string, pidBase: number): Promise<Marks> {
	const pen = async (): Promise<void> => {
		setInlineTool("pen");
		setInkColorHex("pen", penHex);
		await gesture(line({ x: c.x - 80, y: c.y }, { x: c.x + 80, y: c.y }), pidBase + 1);
	};
	const swipes = async (): Promise<void> => {
		setInlineTool("highlighter");
		setInkColorHex("highlighter", HIGHLIGHTER_HEX);
		await gesture(line({ x: c.x - 140, y: c.y }, { x: c.x + 180, y: c.y }), pidBase + 2);
		await gesture(line({ x: c.x + 110, y: c.y - 70 }, { x: c.x + 110, y: c.y + 70 }), pidBase + 3);
	};
	if (order === "pen-first") {
		await pen();
		await swipes();
	} else {
		await swipes();
		await pen();
	}
	setInlineTool("pen");
	return {
		penCore: { x: c.x - 20, y: c.y },
		wash: { x: c.x + 150, y: c.y },
		overlap: { x: c.x + 110, y: c.y },
		crossWash: { x: c.x + 110, y: c.y - 48 },
		paper: { x: c.x - 220, y: c.y + 110 },
	};
}

/** Painted alpha of one canvas's BACKING at a client point (0 when off it). */
export function backingAlpha(canvas: HTMLCanvasElement, p: Pt): number {
	const r = canvas.getBoundingClientRect();
	if (r.width === 0 || r.height === 0) return 0;
	const bx = Math.floor(((p.x - r.left) * canvas.width) / r.width);
	const by = Math.floor(((p.y - r.top) * canvas.height) / r.height);
	if (bx < 0 || by < 0 || bx >= canvas.width || by >= canvas.height) return 0;
	return canvas.getContext("2d")!.getImageData(bx, by, 1, 1).data[3]!;
}


export type RGB = [number, number, number];

/**
 * Decode a screenshot and read the median colour of a (2r+1)^2 block at each
 * named client point. `origin` is the clip's client corner; the screenshot
 * is taken at device scale 1, so one image pixel is one css px.
 */
export async function sample(
	b64: string,
	origin: Pt,
	points: Record<string, Pt>,
	r = 2
): Promise<Record<string, RGB>> {
	const img = new Image();
	img.src = `data:image/png;base64,${b64}`;
	await img.decode();
	const c = document.createElement("canvas");
	c.width = img.naturalWidth;
	c.height = img.naturalHeight;
	const g = c.getContext("2d", { willReadFrequently: true })!;
	g.drawImage(img, 0, 0);
	const out: Record<string, RGB> = {};
	for (const [key, p] of Object.entries(points)) {
		const px = Math.round(p.x - origin.x);
		const py = Math.round(p.y - origin.y);
		const data = g.getImageData(px - r, py - r, 2 * r + 1, 2 * r + 1).data;
		const ch: number[][] = [[], [], []];
		for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) ch[k]!.push(data[i + k]!);
		out[key] = ch.map((v) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!) as RGB;
	}
	return out;
}

/**
 * The pixel along a short vertical run that is closest to `target`, for the
 * pen's core: a 6px line's rows are antialiased at the edges, and the
 * question is whether ANY row still shows the ink undimmed.
 */
export async function closestInColumn(
	b64: string,
	origin: Pt,
	at: Pt,
	halfSpan: number,
	target: RGB
): Promise<{ rgb: RGB; dy: number }> {
	const img = new Image();
	img.src = `data:image/png;base64,${b64}`;
	await img.decode();
	const c = document.createElement("canvas");
	c.width = img.naturalWidth;
	c.height = img.naturalHeight;
	const g = c.getContext("2d", { willReadFrequently: true })!;
	g.drawImage(img, 0, 0);
	const px = Math.round(at.x - origin.x);
	let best: { rgb: RGB; dy: number; d: number } | null = null;
	for (let dy = -halfSpan; dy <= halfSpan; dy++) {
		const d = g.getImageData(px, Math.round(at.y - origin.y) + dy, 1, 1).data;
		const rgb: RGB = [d[0]!, d[1]!, d[2]!];
		const dist = Math.max(...rgb.map((v, k) => Math.abs(v - target[k]!)));
		if (!best || dist < best.d) best = { rgb, dy, d: dist };
	}
	return { rgb: best!.rgb, dy: best!.dy };
}

