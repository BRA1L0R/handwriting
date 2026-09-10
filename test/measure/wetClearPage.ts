/**
 * The wet-clear pixel instrument: does `WetInkRenderer.clearStroke` really
 * leave NOTHING behind, for every geometry the wet layer can draw?
 *
 * This exists because the box clear shipped gated behind Boox mode with a
 * comment saying everyone else waits "until an e-ink user has confirmed the
 * box on hardware". Nobody on this project has an e-ink device, so that
 * confirmation was never arriving. Pixels replace it.
 *
 * WHAT THIS MEASURES
 *   The real `WetInkRenderer`, in real Chromium, on a real canvas, driven
 *   through the real pen-up sequence (beginStroke -> appendPoint* ->
 *   finishStroke -> clearStroke), then EVERY pixel of the backing store is
 *   read and any non-zero alpha is counted.
 *
 * WHY THE COUNT IS WRITTEN OUT HERE INSTEAD OF CALLING THE ONE THAT EXISTS
 *   `countPaintedPixels` (src/diag/Raster.ts) is STRIDED - it samples about
 *   1e5 reads and multiplies back up. That is right for its job (is there
 *   ink roughly here) and catastrophic for this one: a one-pixel leftover
 *   ring falls between the samples and it returns a confident zero. Two
 *   earlier attempts at this proof went blind on a dozen cases each for
 *   exactly that reason. `countAll` below reads every pixel, no stride, and
 *   nothing here may call the strided one.
 *
 * WHY EVERY CASE CARRIES A CONTROL
 *   A readback that is broken returns zero too. So each case is run twice:
 *   once cleared by the code under test, and once cleared by a box measured
 *   off the ink itself and INSET one CSS pixel, which must leave a rim. A
 *   case whose control is also zero proves the readback is blind, not that
 *   the clear works, and is reported as blind rather than as a pass.
 */

import { CameraState } from "../../src/camera/coordinates";
import { centerlineSmoothed, inkShapingEnabled, setInkShaping } from "../../src/ink/InkShape";
import { DEFAULT_PEN, HIGHLIGHTER_PEN, PenStyle } from "../../src/ink/PenStyle";
import { InkPoint } from "../../src/ink/Stroke";
import { WetInkRenderer } from "../../src/ink/WetInkRenderer";

export type Branch = "unsmoothed" | "raw" | "smoothed" | "shaped";
export type Shape = "straight" | "arc" | "loop" | "zigzag";
export type Tool = "pen" | "highlighter";

export interface WetCase {
	branch: Branch;
	shape: Shape;
	zoom: number;
	dpr: number;
	tool: Tool;
}

export interface WetResult {
	name: string;
	/** The branch `appendPoint` actually took, from the same predicates it reads. */
	branchTaken: Branch;
	/** Non-transparent pixels the stroke painted, before any clear. */
	drawn: number;
	/** Non-transparent pixels left after `clearStroke`. Must be 0. */
	leftover: number;
	/** Non-transparent pixels left by the inset-box control. Must be > 0. */
	control: number;
	/** True when the ink box was too small to inset, so the control says nothing. */
	controlDegenerate: boolean;
	/** Which axes the control could afford to inset: "xy", "x", "y" or "". */
	insetAxes: string;
	/** The ink's own bounding box in DEVICE pixels, or null if nothing painted. */
	inkBox: readonly [number, number, number, number] | null;
}

/** Canvas size, in CSS px. Every path below is built to land well inside it. */
const CSS_W = 320;
const CSS_H = 240;

/**
 * Count non-transparent pixels over the WHOLE backing store. Every pixel,
 * no stride - see this file's header for why that is the entire point.
 */
function countAll(ctx: CanvasRenderingContext2D, deviceW: number, deviceH: number): number {
	const data = ctx.getImageData(0, 0, deviceW, deviceH).data;
	let n = 0;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i]! > 0) n++;
	}
	return n;
}

/** The ink's own bounding box in DEVICE pixels, inclusive, or null. */
function inkBoxOf(
	ctx: CanvasRenderingContext2D,
	deviceW: number,
	deviceH: number
): readonly [number, number, number, number] | null {
	const data = ctx.getImageData(0, 0, deviceW, deviceH).data;
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (let y = 0; y < deviceH; y++) {
		const row = y * deviceW * 4;
		for (let x = 0; x < deviceW; x++) {
			if (data[row + x * 4 + 3]! > 0) {
				if (x < x0) x0 = x;
				if (y < y0) y0 = y;
				if (x > x1) x1 = x;
				if (y > y1) y1 = y;
			}
		}
	}
	if (!Number.isFinite(x0)) return null;
	return [x0, y0, x1, y1] as const;
}

/** World-space sample paths. Each stays inside a 100 x 70 world box. */
function pathFor(shape: Shape): InkPoint[] {
	const pts: InkPoint[] = [];
	const push = (x: number, y: number, i: number): void => {
		// Pressure has to MOVE, or the width law is never exercised and the
		// shaped branch draws a constant ribbon.
		pts.push({ x, y, pressure: 0.2 + 0.7 * Math.abs(Math.sin(i * 0.7)), t: i * 8 });
	};
	if (shape === "straight") {
		for (let i = 0; i <= 24; i++) push((i / 24) * 100, 35, i);
	} else if (shape === "arc") {
		for (let i = 0; i <= 32; i++) {
			const a = Math.PI - (i / 32) * Math.PI;
			push(50 + 30 * Math.cos(a), 35 - 30 * Math.sin(a), i);
		}
	} else if (shape === "loop") {
		// A figure eight: it crosses itself, which is where a shared normal
		// and a self-overlapping fill both have something to get wrong.
		for (let i = 0; i <= 48; i++) {
			const t = (i / 48) * Math.PI * 2;
			push(50 + 35 * Math.sin(t), 35 + 25 * Math.sin(2 * t), i);
		}
	} else {
		// Reversals every three world units: the tightest joins the ribbon
		// ever has to fill, and the case where a per-point normal is worst.
		for (let i = 0; i <= 33; i++) push(i * 3, 35 + (i % 2 === 0 ? -8 : 8), i);
	}
	return pts;
}

interface Config {
	smooth: boolean;
	shape: boolean;
	shaping: boolean;
	flat: boolean;
}

/**
 * The switch positions that reach each `appendPoint` branch.
 *
 * The two `flat: false` entries for the highlighter are not a fudge, they
 * are the code: `centerlineSmoothed` returns true for a flat tool whatever
 * the switch says, and `shapingThisStroke` is `shape && !flat && ...`, so a
 * FLAT tool can reach neither the raw centerline nor the shaped width law.
 * The highlighter axis is therefore its WIDTH LAW (baseWidth 16 against the
 * nib's 2.2) on those two branches, which is the thing that moves the dirty
 * box - and that is the axis this proof needs it for. The PDF surface really
 * does run one wet layer for both tools with `flat` passed per stroke.
 */
function configFor(branch: Branch, tool: Tool): Config {
	const flatTool = tool === "highlighter";
	if (branch === "unsmoothed") {
		return { smooth: false, shape: false, shaping: false, flat: flatTool };
	}
	if (branch === "raw") return { smooth: true, shape: false, shaping: false, flat: false };
	if (branch === "smoothed") {
		return { smooth: true, shape: false, shaping: true, flat: flatTool };
	}
	return { smooth: true, shape: true, shaping: true, flat: false };
}

/** Which branch the renderer will take, read off the predicates it reads. */
function branchOf(cfg: Config): Branch {
	if (!cfg.smooth) return "unsmoothed";
	if (!centerlineSmoothed(cfg.flat)) return "raw";
	return cfg.shape && !cfg.flat && inkShapingEnabled() ? "shaped" : "smoothed";
}

interface Rig {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	renderer: WetInkRenderer;
	deviceW: number;
	deviceH: number;
}

function makeRig(cfg: Config, dpr: number): Rig {
	const canvas = document.createElement("canvas");
	const deviceW = Math.round(CSS_W * dpr);
	const deviceH = Math.round(CSS_H * dpr);
	canvas.width = deviceW;
	canvas.height = deviceH;
	canvas.style.width = `${CSS_W}px`;
	canvas.style.height = `${CSS_H}px`;
	document.body.appendChild(canvas);
	const renderer = new WetInkRenderer(canvas, false);
	renderer.applyDpr(dpr);
	renderer.smooth = cfg.smooth;
	renderer.shape = cfg.shape;
	// Same context object getContext("2d") already handed the renderer, so
	// the readback sees exactly what it painted, transform and all.
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d context for the instrument");
	return { canvas, ctx, renderer, deviceW, deviceH };
}

/** Draw one whole stroke, exactly as a pen-up would have. */
function drawStrokeOn(rig: Rig, cfg: Config, cam: CameraState, style: PenStyle, pts: InkPoint[]): void {
	const first = pts[0];
	if (!first) throw new Error("empty path");
	rig.renderer.beginStroke(first, style, cfg.flat);
	for (let i = 1; i < pts.length; i++) {
		rig.renderer.appendPoint(cam, style, pts[i]!);
	}
	rig.renderer.finishStroke(cam, style);
}

function runCase(c: WetCase): WetResult {
	const cfg = configFor(c.branch, c.tool);
	setInkShaping(cfg.shaping);
	const branchTaken = branchOf(cfg);
	const style = c.tool === "highlighter" ? HIGHLIGHTER_PEN : DEFAULT_PEN;
	const cam: CameraState = { x: -20, y: -20, zoom: c.zoom };
	const pts = pathFor(c.shape);
	const name = `${c.branch}/${c.shape}/z${c.zoom}/d${c.dpr}/${c.tool}`;

	// Run 1: the code under test.
	const a = makeRig(cfg, c.dpr);
	drawStrokeOn(a, cfg, cam, style, pts);
	const drawn = countAll(a.ctx, a.deviceW, a.deviceH);
	a.renderer.clearStroke(CSS_W, CSS_H);
	const leftover = countAll(a.ctx, a.deviceW, a.deviceH);
	a.canvas.remove();

	// Run 2: the control. Same stroke, cleared by a box measured off the ink
	// and inset one CSS px on every side, so a rim of ink MUST survive.
	const b = makeRig(cfg, c.dpr);
	drawStrokeOn(b, cfg, cam, style, pts);
	const box = inkBoxOf(b.ctx, b.deviceW, b.deviceH);
	let control = 0;
	let controlDegenerate = false;
	let insetAxes = "";
	if (!box) {
		controlDegenerate = true;
	} else {
		const cssX0 = box[0] / c.dpr;
		const cssY0 = box[1] / c.dpr;
		const cssX1 = (box[2] + 1) / c.dpr;
		const cssY1 = (box[3] + 1) / c.dpr;
		// Inset PER AXIS. A horizontal pen stroke at zoom 1 is about two
		// device pixels tall, so insetting both axes by a CSS px inverts the
		// rect and the control clears nothing - which is a degenerate control,
		// not a passing case. Insetting only the axis with room still leaves a
		// one-CSS-px rim of ink on that axis, which is exactly the thinnest
		// leftover this readback has to be able to see.
		const insetX = cssX1 - cssX0 > 2 ? 1 : 0;
		const insetY = cssY1 - cssY0 > 2 ? 1 : 0;
		insetAxes = `${insetX ? "x" : ""}${insetY ? "y" : ""}`;
		const w = cssX1 - cssX0 - insetX * 2;
		const h = cssY1 - cssY0 - insetY * 2;
		if (w <= 0 || h <= 0 || insetAxes === "") {
			controlDegenerate = true;
		} else {
			// The context transform is dpr-scaled, so these are CSS px - the
			// same units `clearStroke` clears in.
			b.ctx.clearRect(cssX0 + insetX, cssY0 + insetY, w, h);
			control = countAll(b.ctx, b.deviceW, b.deviceH);
		}
	}
	b.canvas.remove();

	return {
		name,
		branchTaken,
		drawn,
		leftover,
		control,
		controlDegenerate,
		insetAxes,
		inkBox: box,
	};
}

declare global {
	interface Window {
		__wet: { run(cases: readonly WetCase[]): WetResult[] };
	}
}

window.__wet = {
	run(cases: readonly WetCase[]): WetResult[] {
		return cases.map(runCase);
	},
};
