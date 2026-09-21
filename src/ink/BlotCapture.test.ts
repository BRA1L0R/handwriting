/**
 * THE START BLOT ON ALAN'S TRACES (bug report 28d6c5e4; RibbonEdgeSlope.test.ts
 * holds the committed synthetic of the same stroke).
 *
 * Alan's traces are never committed (public repository), so these cells run only
 * when HW_BLOT_TRACE names 28d6c5e4.json (and, for the second control,
 * HW_INK_LOSS_TRACE names d1c16bdb.json); the gate skips them.
 *
 * The traces do not record the zoom or the pen size, so every cell runs the
 * grid the read measured: world = the trace's CSS px divided by 1, 2 and 4,
 * and the slider's 0.3, 1, 1.8 and 3 sizes. Dividing after the replay keeps
 * the builder's sample dedupe at 100 percent, which is a small difference from
 * a stroke written at that zoom, not a difference in any sample's pressure.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { installFakeWindow } from "../../test/routerHarness";
import { exp7Style, replayTrace } from "../../test/pressureFeel";
import { IncrementalShaper, PEN_SHAPE, RIBBON_EDGE_SLOPE, shapedHalfWidths, type ShapeParams } from "./InkShape";
import { setPressureSensitivity } from "./PenStyle";
import type { InkPoint } from "./Stroke";

declare const process: { env: Record<string, string | undefined> };
const BLOT = process.env.HW_BLOT_TRACE;
const INK_LOSS = process.env.HW_INK_LOSS_TRACE;

const UNCAPPED = { ...PEN_SHAPE, edgeSlope: Number.POSITIVE_INFINITY } as ShapeParams;
const SCALES = [1, 2, 4];
const NIBS = [2.2 * 0.3, 2.2, 2.2 * 1.8, 2.2 * 3];

function contacts(path: string): InkPoint[][] {
	const out: InkPoint[][] = [];
	replayTrace(path, undefined, (_accepted, committed) => {
		for (const stroke of committed) out.push(stroke.points);
	});
	return out;
}

const atScale = (points: readonly InkPoint[], s: number): InkPoint[] => points.map((p) => ({ ...p, x: p.x / s, y: p.y / s }));

function maxSlope(points: readonly InkPoint[], hw: readonly number[]): number {
	let max = 0;
	for (let i = 1; i < points.length; i++) {
		const d = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
		max = Math.max(max, Math.abs(hw[i]! - hw[i - 1]!) / d);
	}
	return max;
}

describe.skipIf(!BLOT || !existsSync(BLOT))("28d6c5e4: the landing press is capped, the ordinary strokes are untouched", () => {
	let uninstall: () => void;
	let strokes: InkPoint[][] = [];
	beforeAll(() => {
		uninstall = installFakeWindow();
		setPressureSensitivity(true);
		strokes = contacts(BLOT!);
	});
	afterAll(() => uninstall());

	it("contact 5 outruns the cap uncapped at the bold and maximum sizes, and stays within it capped at every zoom and size", () => {
		expect(strokes, "five pen contacts, no release split").toHaveLength(5);
		const blot = strokes[4]!;
		expect(blot[0]!.pressure, "the light pen-down sample").toBeCloseTo(0.0283, 4);
		expect(blot[1]!.pressure, "full pressure on the next").toBeCloseTo(0.5234, 4);
		for (const s of SCALES) {
			for (const nib of NIBS) {
				const pts = atScale(blot, s);
				const style = exp7Style(nib);
				const capped = shapedHalfWidths(pts, style);
				expect(maxSlope(pts, capped), `scale ${s}, nib ${nib}`).toBeLessThanOrEqual(RIBBON_EDGE_SLOPE + 1e-9);
				if (nib >= 2.2 * 1.8) {
					expect(maxSlope(pts, shapedHalfWidths(pts, style, UNCAPPED)), `uncapped outruns it, scale ${s}, nib ${nib}`).toBeGreaterThan(RIBBON_EDGE_SLOPE);
				}
				// The wet layer draws the same capped widths; only a held lift sample differs, by design.
				const shaper = new IncrementalShaper();
				shaper.reset(pts[0], style);
				const wet = [shaper.last(), ...pts.slice(1).map((p) => shaper.push(style, p))];
				expect(wet.slice(0, -1), `wet, scale ${s}, nib ${nib}`).toEqual(capped.slice(0, -1));
			}
		}
	});

	it("contacts 1 to 3 draw byte-identical half-widths with and without the cap, at every zoom and size", () => {
		for (const k of [0, 1, 2]) {
			for (const s of SCALES) {
				for (const nib of NIBS) {
					const pts = atScale(strokes[k]!, s);
					const style = exp7Style(nib);
					expect(shapedHalfWidths(pts, style), `contact ${k + 1}, scale ${s}, nib ${nib}`).toEqual(shapedHalfWidths(pts, style, UNCAPPED));
				}
			}
		}
	});
});

describe.skipIf(!INK_LOSS || !existsSync(INK_LOSS))("d1c16bdb: the light-then-hard stroke is untouched by the cap", () => {
	let uninstall: () => void;
	beforeAll(() => {
		uninstall = installFakeWindow();
		setPressureSensitivity(true);
	});
	afterAll(() => uninstall());

	it("draws byte-identical half-widths with and without the cap, at every zoom and size", () => {
		const strokes = contacts(INK_LOSS!);
		expect(strokes, "one stroke, kept whole by the release ceiling").toHaveLength(1);
		for (const s of SCALES) {
			for (const nib of NIBS) {
				const pts = atScale(strokes[0]!, s);
				const style = exp7Style(nib);
				expect(shapedHalfWidths(pts, style), `scale ${s}, nib ${nib}`).toEqual(shapedHalfWidths(pts, style, UNCAPPED));
			}
		}
	});
});
