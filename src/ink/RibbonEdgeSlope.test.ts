/**
 * A LANDING PRESS DRAWS A SHORT LEAD-IN, NOT A BEAD (the start blot, Alan's bug
 * report 28d6c5e4; the same shape as 4a3db156, "tap lightly then draw").
 *
 * The pen-down sample arrives light (p 0.028), the next one 42 ms later at full
 * writing pressure (p 0.523) only 2.94 px away, and the pen then creeps under
 * 1 px a sample. Pressure is settled per sample, so the committed half-width
 * still climbs faster than the path moves, and a mark wider than it is long
 * at its own start reads as a disc. Since 1.4.20 pressure ink has no geometric
 * start taper to hide it.
 *
 * The cure is a bound on how fast the half-width may change per unit of path
 * length, both directions, applied by the shaper to the per-sample half-widths
 * the committed ribbon and the wet layer both draw: |dhw/ds| <= RIBBON_EDGE_SLOPE.
 * It is a cap on the RATE, never a taper to a point: the first sample keeps the
 * pen-down width and a light start stays light. The synthetic quick and push
 * strokes never reach it (cells below), nor do the ordinary contacts of the
 * capture cells in BlotCapture.test.ts; the wet layer's unheld lift sample is
 * where the synthetics meet it. Real firm starts as steep as the blot's are
 * capped too, by design.
 * exp7 pressure ink only, like the lift hold; legacy and pressure-off ink are
 * untouched.
 */

import { afterEach, describe, expect, it } from "vitest";
import { flattenStrokeShaped, IncrementalShaper, PEN_SHAPE, RIBBON_EDGE_SLOPE, shapedHalfWidths, type ShapeParams } from "./InkShape";
import { setPressureSensitivity, widthForPressure, type PenStyle } from "./PenStyle";
import type { InkPoint } from "./Stroke";
import { CAPTURE_NIB, exp7Style, legacyStyle, pushStroke, quickLiftStroke } from "../../test/pressureFeel";

/** The same law with the cap lifted: the plant that restores the bead. */
const UNCAPPED = { ...PEN_SHAPE, edgeSlope: Number.POSITIVE_INFINITY } as ShapeParams;

/** Pen sizes on Alan's slider: bold (1.8) and the maximum (3). */
const BOLD_NIB = 2.2 * 1.8;
const MAX_NIB = 2.2 * 3;

/**
 * 28d6c5e4's last stroke, as the trace measured it: the light pen-down sample,
 * the 42 ms silence, then full pressure 2.94 px on and a creep of 0.93-1.86 px
 * a sample, pressure peaking at #8 and easing off after.
 */
function landingPress(): InkPoint[] {
	const strides = [0, 2.94, 0.93, 0.93, 1.47, 0.93, 0.93, 1.86, 0.93, 0.93, 1.86, 0.93, 1.86, 0.93, 1.47, 1.47, 1.47, 1.47, 1.86, 1.47, 2.37, 2.37, 1.86, 2.79, 2.79];
	const pressures = [0.0283, 0.5234, 0.5254, 0.5273, 0.5303, 0.5322, 0.5342, 0.5371, 0.5391, 0.5283, 0.5176, 0.5078, 0.4971, 0.4863, 0.4756, 0.4658, 0.4551, 0.4443, 0.4336, 0.4229, 0.4121, 0.4014, 0.3906, 0.3799, 0.3691];
	const times = [0, 42, 46.3, 51.4, 54.3, 57.7, 61.4, 66.2, 69.4, 71.8, 76.4, 81.3, 84.5, 87.6, 91.6, 96.2, 99.5, 101.7, 106.5, 111.7, 114.8, 117.6, 121.8, 126.4, 129.6];
	let x = 0;
	return strides.map((s, i) => {
		x += s;
		return { x, y: 0, pressure: pressures[i]!, t: times[i]! };
	});
}

function steps(points: readonly InkPoint[], hw: readonly number[]): { slope: number; at: number }[] {
	const out: { slope: number; at: number }[] = [];
	for (let i = 1; i < points.length; i++) {
		const d = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
		out.push({ slope: Math.abs(hw[i]! - hw[i - 1]!) / d, at: i });
	}
	return out;
}

const maxSlope = (points: readonly InkPoint[], hw: readonly number[]): number => Math.max(...steps(points, hw).map((s) => s.slope));

function wetHalfWidths(points: readonly InkPoint[], style: PenStyle, params: ShapeParams = PEN_SHAPE): number[] {
	const shaper = new IncrementalShaper(params);
	shaper.reset(points[0], style);
	return [shaper.last(), ...points.slice(1).map((p) => shaper.push(style, p))];
}

afterEach(() => setPressureSensitivity(true));

describe("a landing press widens no faster than RIBBON_EDGE_SLOPE per unit of travel", () => {
	it.each([
		["bold", BOLD_NIB],
		["maximum", MAX_NIB],
	])("at the %s pen size: uncapped it outruns the cap, capped every step is within it, committed and wet alike", (_name, nib) => {
		setPressureSensitivity(true);
		const points = landingPress();
		const style = exp7Style(nib);
		expect(maxSlope(points, shapedHalfWidths(points, style, UNCAPPED)), "the bead is real: uncapped slope").toBeGreaterThan(RIBBON_EDGE_SLOPE);
		const committed = shapedHalfWidths(points, style);
		for (const { slope, at } of steps(points, committed)) {
			expect(slope, `committed #${at - 1} -> #${at}`).toBeLessThanOrEqual(RIBBON_EDGE_SLOPE + 1e-9);
		}
		expect(wetHalfWidths(points, style), "the wet layer draws the same capped widths").toEqual(committed);
	});

	it("keeps the pen-down width, so a light start stays light, and never widens a sample past its uncapped width on the way up", () => {
		const points = landingPress();
		const style = exp7Style(MAX_NIB);
		const capped = shapedHalfWidths(points, style);
		const uncapped = shapedHalfWidths(points, style, UNCAPPED);
		expect(capped[0], "the first half-width is the pen-down pressure's").toBe(widthForPressure(style, points[0]!.pressure) / 2);
		for (let i = 0; i <= 8; i++) expect(capped[i]!, `#${i}`).toBeLessThanOrEqual(uncapped[i]! + 1e-12);
		expect(Math.max(...capped), "the stroke still reaches its full width").toBeCloseTo(Math.max(...uncapped), 1);
	});

	it("caps a sudden thinning inside a stroke the same way", () => {
		const style = exp7Style(MAX_NIB);
		const points: InkPoint[] = [];
		for (let i = 0; i < 12; i++) points.push({ x: 2 * i, y: 0, pressure: 0.6, t: 4 * i });
		for (let i = 12; i < 20; i++) points.push({ x: 2 * 11 + 0.5 * (i - 11), y: 0, pressure: 0.03, t: 4 * i });
		for (let i = 20; i < 30; i++) points.push({ x: 26 + 2 * (i - 19), y: 0, pressure: 0.3, t: 4 * i });
		expect(maxSlope(points, shapedHalfWidths(points, style, UNCAPPED)), "uncapped, the thinning is abrupt").toBeGreaterThan(RIBBON_EDGE_SLOPE);
		expect(maxSlope(points, shapedHalfWidths(points, style))).toBeLessThanOrEqual(RIBBON_EDGE_SLOPE + 1e-9);
	});

	it("draws the committed ribbon's start no wider than its own length", () => {
		const points = landingPress();
		const style = exp7Style(MAX_NIB);
		const ribbon = flattenStrokeShaped(points, style, 2);
		let arc = 0;
		for (let i = 1; i < ribbon.length; i++) {
			arc += Math.hypot(ribbon[i]!.x - ribbon[i - 1]!.x, ribbon[i]!.y - ribbon[i - 1]!.y);
			// From the pen-down half-width, the widest the ribbon may be after `arc` of travel.
			expect(ribbon[i]!.hw, `ribbon point ${i} at arc ${arc.toFixed(2)}`).toBeLessThanOrEqual(ribbon[0]!.hw + RIBBON_EDGE_SLOPE * arc + 1e-9);
		}
	});
});

describe("the quick and push synthetics never reach the cap", () => {
	it.each([
		["quick handwritten stroke", quickLiftStroke()],
		["slow light-to-hard push", pushStroke()],
	])("%s: committed half-widths are identical with and without the cap at every pen size, and wet ones up to the lift sample", (_name, points) => {
		for (const nib of [2.2 * 0.3, 2.2, BOLD_NIB, CAPTURE_NIB, MAX_NIB]) {
			const style = exp7Style(nib);
			expect(shapedHalfWidths(points, style), `committed, nib ${nib}`).toEqual(shapedHalfWidths(points, style, UNCAPPED));
			// The quarter-pressure lift sample is the one place ordinary writing meets the cap, and only on the
			// wet layer: the committed ribbon holds it at the pressure before (shapedHalfWidths), but the wet layer
			// cannot know a sample is the last, so it drops there, and the cap bounds that drop. The committed
			// repaint replaces the wet tail at lift either way.
			const wet = wetHalfWidths(points, style);
			const uncappedWet = wetHalfWidths(points, style, UNCAPPED);
			expect(wet.slice(0, -1), `wet before the lift sample, nib ${nib}`).toEqual(uncappedWet.slice(0, -1));
			expect(wet.at(-1)!, `wet lift sample, nib ${nib}: bounded, never thinner than uncapped`).toBeGreaterThanOrEqual(uncappedWet.at(-1)!);
		}
	});

	it("leaves legacy ink uncapped and caps exp7 independently of the capture preference", () => {
		const points = landingPress();
		const legacy = legacyStyle(MAX_NIB);
		expect(shapedHalfWidths(points, legacy)).toEqual(shapedHalfWidths(points, legacy, UNCAPPED));
		expect(flattenStrokeShaped(points, legacy, 2)).toEqual(flattenStrokeShaped(points, legacy, 2, UNCAPPED));
		const style = exp7Style(MAX_NIB);
		const before = shapedHalfWidths(points, style);
		setPressureSensitivity(false);
		expect(shapedHalfWidths(points, style)).toEqual(before);
		expect(before).not.toEqual(shapedHalfWidths(points, style, UNCAPPED));
	});
});
