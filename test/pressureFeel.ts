/**
 * Shared fixtures and measures for the pen-lift hold and pressure-drawn tips
 * (PressureLiftHold.test.ts, PressureTipTaper.test.ts).
 *
 * Two kinds of stroke:
 *
 *   synthetic   committed here, always run. Built from what Alan's 1.4.20
 *               captures measured: 4 ms samples on a 10-bit pressure grid,
 *               a final pre-lift sample at 1/4 of the one before it, and the
 *               speed and pressure spread of a quick handwritten stroke and a
 *               slow light-to-hard push.
 *
 *   captures    Alan's own traces and stored strokes, NEVER committed. The
 *               capture cells run only when HW_PT_CAPTURES names the directory
 *               holding 87828c65.json, 58569933.json and sidecar-96c5e0cf.json;
 *               the gate skips them.
 *
 * The measures are the ones the replay harness reported (end taper removed
 * area and end width at 2 px per world unit, interior width steps), so a
 * cell's number and the harness table's number are the same quantity.
 */

import { readFileSync } from "node:fs";
import { clearInlinePenTrace, TraceCapture } from "../src/inline/InlinePenRouter";
import { normalizeInlinePenPressure } from "../src/inline/PenPressure";
import { PenSample } from "../src/input/PointerRouter";
import { setDiagnosticsEnabled } from "../src/diag/DiagSwitch";
import { flattenStrokeShaped, PEN_SHAPE, shapedHalfWidths, type ShapeParams } from "../src/ink/InkShape";
import { DEFAULT_PEN, EXP7_PEN, type PenStyle, shapeFor } from "../src/ink/PenStyle";
import type { InkPoint, InkStroke } from "../src/ink/Stroke";
import { StrokeBuilder } from "../src/ink/StrokeBuilder";
import { strokeWidthPolicy } from "../src/ink/StrokeWidth";
import { harness, penEvent } from "./routerHarness";

declare const process: { env: Record<string, string | undefined> };

/** The nib of Alan's captures: 2.2 x the 2.98 pen size his stored strokes carry. */
export const CAPTURE_NIB = 2.2 * 2.9818181818;

/** The exp7 style a committed stroke of this nib renders with. */
export function exp7Style(baseWidth = CAPTURE_NIB): PenStyle {
	return strokeWidthPolicy({ ...EXP7_PEN, color: "#000000", baseWidth }, undefined, "exp7").style;
}

/** The legacy (1.4.12) style, no pressure profile. */
export function legacyStyle(baseWidth = CAPTURE_NIB): PenStyle {
	return strokeWidthPolicy({ ...DEFAULT_PEN, color: "#000000", baseWidth }, undefined, undefined).style;
}

/** The style drawStroke derives for a stored stroke. */
export function styleOf(stroke: InkStroke): PenStyle {
	return strokeWidthPolicy(
		{ color: stroke.color, baseWidth: stroke.width, ...shapeFor(false, stroke.pressureProfile) },
		stroke.widthMode,
		stroke.pressureProfile
	).style;
}

// ---- synthetic strokes --------------------------------------------------------

/** Deterministic uniform [0, 1). */
function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const onGrid = (p: number): number => Math.min(1023, Math.max(1, Math.round(p * 1024))) / 1024;

interface SynthSpec {
	n: number;
	/** Nib speed in world units per ms at stroke fraction u. */
	speed: (u: number) => number;
	/** Pressure at stroke fraction u, before jitter. */
	pressure: (u: number) => number;
	/** Peak-to-peak pressure jitter at the pen-down end, fading to none at the lift. */
	jitter: number;
	/** Relative peak-to-peak speed jitter. */
	speedJitter: number;
	seed: number;
	/** The final sample's pressure over the one before it, or undefined for no lift sample. */
	lift?: number;
}

function synth(spec: SynthSpec): InkPoint[] {
	const r = lcg(spec.seed);
	const pts: InkPoint[] = [];
	let x = 0;
	let y = 0;
	let heading = 0;
	for (let i = 0; i < spec.n; i++) {
		const u = i / (spec.n - 1);
		if (i > 0) {
			// Integrated heading, so a sample's travel is exactly its speed times 4 ms.
			const v = spec.speed(u) * (1 + spec.speedJitter * (r() - 0.5));
			heading += 0.02 + 0.04 * (r() - 0.5);
			x += v * 4 * Math.cos(heading);
			y += v * 4 * Math.sin(heading);
		}
		const p = onGrid(spec.pressure(u) + spec.jitter * (1 - u) * (r() - 0.5));
		pts.push({ x, y, pressure: p, t: i * 4 });
	}
	if (spec.lift !== undefined) {
		const last = pts[pts.length - 1]!;
		const prev = pts[pts.length - 2]!;
		last.pressure = prev.pressure * spec.lift;
	}
	return pts;
}

/**
 * A quick handwritten stroke, the shape of 58569933's seven lift strokes:
 * 60 samples over 236 ms; a pen-down pressure jump; pressure still rising
 * into the lift, so the pre-lift sample is the stroke's peak (true on 7 of 7
 * there) at 0.65; speed peaking mid-stroke near 2 units/ms and slowing to
 * ~0.3 at the end; and the quarter-pressure lift sample (ratio 0.25).
 */
export function quickLiftStroke(seed = 7, lift: number | undefined = 0.25): InkPoint[] {
	return synth({
		n: 60,
		speed: (u) => 0.3 + 1.8 * Math.sin(Math.PI * Math.pow(u, 0.8)),
		pressure: (u) => (u === 0 ? 0.12 : 0.3 + 0.35 * Math.pow(u, 1.5)),
		jitter: 0.03,
		speedJitter: 0.5,
		seed,
		lift,
	});
}

/**
 * 87828c65's push: 520 samples over 2.08 s; pressure from 0.004 to the clamp,
 * reached at three quarters of the stroke and held there; a slow nib
 * (0.2-0.6 units/ms) slowing to ~0.15 before the lift; and the
 * quarter-pressure lift sample (ratio 0.249).
 */
export function pushStroke(seed = 11, lift: number | undefined = 0.249): InkPoint[] {
	return synth({
		n: 520,
		speed: (u) => (0.4 + 0.2 * Math.sin(u * 23)) * (u < 0.9 ? 1 : Math.max(0.35, 1 - (u - 0.9) * 6.5)),
		pressure: (u) => Math.min(0.999, 0.004 + Math.pow(u / 0.76, 1.6)),
		jitter: 0.012,
		speedJitter: 0.8,
		seed,
		lift,
	});
}

// ---- measures -----------------------------------------------------------------

export interface EndReading {
	/** Width the end taper takes away inside its zone, px^2 at 2 px per world unit's geometry. */
	removed: number;
	/** The committed ribbon's width at the last point. */
	endWidth: number;
}

/** The harness's armEnd: the taper's removed area over its end zone, and the end width. */
export function endOf(points: readonly InkPoint[], style: PenStyle, params: ShapeParams = PEN_SHAPE): EndReading {
	const tapered = flattenStrokeShaped(points, style, 2, params);
	const flat = flattenStrokeShaped(points, style, 2, { ...params, taperWidths: 0 });
	let total = 0;
	for (let i = 1; i < tapered.length; i++) total += Math.hypot(tapered[i]!.x - tapered[i - 1]!.x, tapered[i]!.y - tapered[i - 1]!.y);
	const taperLen = Math.min(params.taperWidths * style.baseWidth, total * params.taperMaxShare);
	let arc = 0;
	let removed = 0;
	for (let i = 1; i < tapered.length; i++) {
		const d = Math.hypot(tapered[i]!.x - tapered[i - 1]!.x, tapered[i]!.y - tapered[i - 1]!.y);
		arc += d;
		if (total - arc <= taperLen) removed += (flat[i]!.hw - tapered[i]!.hw) * 2 * d;
	}
	return { removed, endWidth: tapered[tapered.length - 1]!.hw * 2 };
}

/** Largest relative width step between neighbouring samples, first and last sample excluded, in percent. */
export function interiorMaxStepPct(points: readonly InkPoint[], style: PenStyle, params: ShapeParams = PEN_SHAPE): number {
	const hw = shapedHalfWidths(points, style, params).slice(1, -1);
	let max = 0;
	for (let i = 1; i < hw.length; i++) {
		const rel = Math.abs(hw[i]! - hw[i - 1]!) / Math.max(1e-9, Math.max(hw[i]!, hw[i - 1]!));
		if (rel > max) max = rel;
	}
	return max * 100;
}

/** The final sample's pressure over the one before it. */
export function liftRatio(points: readonly InkPoint[]): number {
	const n = points.length;
	return n > 1 ? points[n - 1]!.pressure / Math.max(1e-9, points[n - 2]!.pressure) : 1;
}

/** The same samples with the last one's pressure set to the one before it. */
export function heldAtPrevious(points: readonly InkPoint[]): InkPoint[] {
	const n = points.length;
	return points.map((p, i) => (i === n - 1 ? { ...p, pressure: points[n - 2]!.pressure } : { ...p }));
}

// ---- captures -------------------------------------------------------------------

export const CAPTURES = process.env.HW_PT_CAPTURES;

function loadTrace(path: string): TraceCapture {
	const text = readFileSync(path, "utf8");
	return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as TraceCapture;
}

const DISPATCHED = new Set(["pointerdown", "pointermove", "pointerrawupdate", "pointerup", "pointercancel"]);

/**
 * A "Bug report: send" trace through the real router and builder, with the
 * overlay's gain (1), clamp, start time and release filter: the committed
 * strokes the note would have stored. Needs installFakeWindow() in force.
 */
export function replayTrace(
	path: string,
	baseWidth = CAPTURE_NIB,
	/** Per contact: every sample the builder accepted (what the wet layer draws), and the committed strokes. */
	onContact?: (accepted: InkPoint[], committed: InkStroke[]) => void
): InkStroke[] {
	const cap = loadTrace(path);
	clearInlinePenTrace();
	setDiagnosticsEnabled(true);
	const h = harness();
	const out: InkStroke[] = [];
	let builder: StrokeBuilder | null = null;
	let accepted: InkPoint[] = [];
	const add = (s: PenSample): void => {
		const point = builder!.add(s.x, s.y, normalizeInlinePenPressure(s.pressure), s.timestamp);
		if (point) accepted.push(point);
	};
	h.rec.cb.onPenDown = (s: PenSample) => {
		builder = new StrokeBuilder("pen", "#000000", baseWidth);
		builder.start(s.timestamp);
		accepted = [];
		add(s);
	};
	h.rec.cb.onPenRaw = (samples: PenSample[]) => {
		for (const s of samples) if (builder) add(s);
	};
	h.rec.cb.onPenUp = () => {
		if (!builder) return;
		const committed = builder.finishReleaseFiltered();
		onContact?.(accepted, committed);
		out.push(...committed);
		builder = null;
	};
	let prevKey = "";
	for (const row of cap.events) {
		if (!DISPATCHED.has(row.type)) continue;
		const key = `${row.type}@${row.t}`;
		if (key === prevKey) continue;
		prevKey = key;
		h.fire(penEvent(row.type, row.t, {
			x: row.x, y: row.y, pressure: row.pressure, buttons: row.buttons, pointerType: row.ptr || "pen",
			tiltX: row.tx, tiltY: row.ty,
			coalescedSamples: row.cs?.map((c) => ({ t: c.t, x: c.x, y: c.y, pressure: c.p })),
		}));
	}
	setDiagnosticsEnabled(false);
	return out;
}
