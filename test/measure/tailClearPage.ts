/**
 * The tail-clear pixel instrument: what does `TailRenderer.clear()` actually
 * erase, in each of the three states the dirty box can be in?
 *
 * Companion to `wetClearPage.ts`, and it exists because the wet layer's proof
 * says NOTHING about this class. The two are not symmetric:
 * `WetInkRenderer.clearStroke` falls back to a whole-canvas clear when it has
 * no box, where `TailRenderer.clear()` simply RETURNED - and `drawLasso`,
 * `drawSelectionBox` and `drawSpaceDivider` all paint and then null the box
 * without leaving one behind.
 *
 * Three states, each at both zooms and both device pixel ratios, each run
 * twice: once cleared by `clear()` and once by `clearAll()` as the CONTROL
 * ARM. The control is what makes a zero mean something - it has to erase the
 * canvas in every configuration, or the readback is blind rather than the
 * clear being clean.
 *
 * The count is exhaustive - every pixel, no stride - for the same reason
 * `wetClearPage.ts` says: the repo's own `countPaintedPixels` samples about
 * 1e5 reads and scales up, which steps straight over a thin leftover and
 * returns a confident zero.
 */

import { CameraState } from "../../src/camera/coordinates";
import { PenSample } from "../../src/input/PointerRouter";
import { DEFAULT_PEN } from "../../src/ink/PenStyle";
import { TailRenderer } from "../../src/ink/TailRenderer";

/** head only | head + predicted tail | a box nulled by the selection UI. */
export type TailState = "head" | "head-plus-prediction" | "dirty-null";
/** Which method the case erases with. `clearAll` is the control arm. */
export type Arm = "clear" | "clearAll";

export interface TailCase {
	state: TailState;
	zoom: number;
	dpr: number;
	arm: Arm;
	/** Pass the css size to `clear()`, i.e. exercise the fallback. */
	withSize: boolean;
}

export interface TailResult {
	name: string;
	/** Non-transparent pixels painted, before the erase. */
	drawn: number;
	/** Non-transparent pixels left after the erase. */
	leftover: number;
}

const CSS_W = 320;
const CSS_H = 240;

/** Every pixel of the backing store. No stride - that is the whole point. */
function countAll(ctx: CanvasRenderingContext2D, deviceW: number, deviceH: number): number {
	const data = ctx.getImageData(0, 0, deviceW, deviceH).data;
	let n = 0;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i]! > 0) n++;
	}
	return n;
}

interface Rig {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	tail: TailRenderer;
	deviceW: number;
	deviceH: number;
}

function makeRig(dpr: number): Rig {
	const canvas = document.createElement("canvas");
	const deviceW = Math.round(CSS_W * dpr);
	const deviceH = Math.round(CSS_H * dpr);
	canvas.width = deviceW;
	canvas.height = deviceH;
	canvas.style.width = `${CSS_W}px`;
	canvas.style.height = `${CSS_H}px`;
	document.body.appendChild(canvas);
	const tail = new TailRenderer(canvas);
	tail.applyDpr(dpr);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d context for the tail instrument");
	return { canvas, ctx, tail, deviceW, deviceH };
}

/** Screen-space predicted samples, which is what `draw` takes. */
function predicted(cam: CameraState): PenSample[] {
	const out: PenSample[] = [];
	for (let i = 1; i <= 6; i++) {
		out.push({
			x: (60 + i * 6 - cam.x) * cam.zoom,
			y: (40 + i * 3 - cam.y) * cam.zoom,
			pressure: 0.6,
			timestamp: i * 8,
			tiltX: 0,
			tiltY: 0,
		});
	}
	return out;
}

function runCase(c: TailCase): TailResult {
	const rig = makeRig(c.dpr);
	const cam: CameraState = { x: -20, y: -20, zoom: c.zoom };
	const name = `${c.state}/z${c.zoom}/d${c.dpr}/${c.arm}${c.withSize ? "+size" : ""}`;

	if (c.state === "dirty-null") {
		// The selection UI: it PAINTS and then nulls the box. `drawLasso` is
		// the one that says so in its own comment; the box and the divider do
		// the same thing on the next two methods.
		rig.tail.drawLasso(
			cam,
			[
				{ x: 20, y: 20 },
				{ x: 90, y: 25 },
				{ x: 85, y: 70 },
				{ x: 25, y: 65 },
			],
			"#c81e1e"
		);
		rig.tail.drawSelectionBox(cam, { x: 30, y: 30, width: 40, height: 25 }, "#1e6ec8");
		rig.tail.drawSpaceDivider(cam, 90, "#1e9e5e", CSS_W);
	} else {
		rig.tail.drawHead(
			cam,
			DEFAULT_PEN,
			{ x: 30, y: 40 },
			{ x: 60, y: 55 },
			0.7,
			DEFAULT_PEN.baseWidth / 2
		);
		if (c.state === "head-plus-prediction") {
			const pts = predicted(cam);
			const first = pts[0]!;
			rig.tail.draw(
				(60 - cam.x) * cam.zoom,
				(55 - cam.y) * cam.zoom,
				pts,
				DEFAULT_PEN.color,
				DEFAULT_PEN.baseWidth * cam.zoom
			);
			// Referenced so the sample list cannot be silently empty.
			if (!Number.isFinite(first.x)) throw new Error("bad predicted sample");
		}
	}

	const drawn = countAll(rig.ctx, rig.deviceW, rig.deviceH);
	if (c.arm === "clearAll") rig.tail.clearAll(CSS_W, CSS_H);
	else if (c.withSize) rig.tail.clear(CSS_W, CSS_H);
	else rig.tail.clear();
	const leftover = countAll(rig.ctx, rig.deviceW, rig.deviceH);
	rig.canvas.remove();

	return { name, drawn, leftover };
}

declare global {
	interface Window {
		__tail: { run(cases: readonly TailCase[]): TailResult[] };
	}
}

window.__tail = {
	run(cases: readonly TailCase[]): TailResult[] {
		return cases.map(runCase);
	},
};
