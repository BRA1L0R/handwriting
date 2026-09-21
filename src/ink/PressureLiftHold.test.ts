import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePage } from "../model/PageData";
import { installFakeWindow } from "../../test/routerHarness";
import {
	CAPTURES,
	endOf,
	exp7Style,
	heldAtPrevious,
	legacyStyle,
	liftRatio,
	pushStroke,
	quickLiftStroke,
	replayTrace,
	styleOf,
} from "../../test/pressureFeel";
import { flattenStrokeShaped, IncrementalShaper, PEN_SHAPE, shapedHalfWidths, type ShapeParams } from "./InkShape";
import { setPressureSensitivity, type PenStyle } from "./PenStyle";
import type { InkPoint, InkStroke } from "./Stroke";

/**
 * THE PEN'S LIFT SAMPLE (Z17).
 *
 * The pen reports one last sample before lift at a quarter of the pressure
 * of the one before it: ratio 0.248-0.251 on 10 of 12 of Alan's stored
 * strokes and on every lift stroke in his 1.4.20 captures. Drawn as it stands,
 * it pulls the stroke's last half-width to about 70% of the line leading into
 * it. Under the pre-1.4.20 exp7 tip taper, whose floor was the last half-width
 * over the stroke's widest, that one sample then shaved the whole end zone:
 * 21-54 px^2 per stroke. That is "the taper deletes ink".
 *
 * The rule: a final sample at or below 0.35x the one before it is drawn at
 * the one before's pressure. It keeps its position, so the ink still reaches
 * the pen-up point. Committed geometry only; the wet layer cannot know which
 * sample is last.
 *
 * Since 1.4.20 pressure ink has no geometric tip taper (PressureTipTaper.test.ts),
 * so the product acceptance here is on the law in force: the hold fires on every
 * lift stroke, and the end is drawn at the held width, pinned per stroke on
 * Alan's captures. The taper-era numbers stay as CALIBRATION cells, read through
 * the `exp7TipTaper` plant that restores the pre-1.4.20 taper; on a tree without
 * that field the plant is simply the law in force.
 *
 * The hold's own plant is the threshold at 0 (`liftHoldRatio: 0`).
 */

const NO_HOLD = { ...PEN_SHAPE, liftHoldRatio: 0 } as ShapeParams;
const TIP_TAPER = { ...PEN_SHAPE, exp7TipTaper: true } as ShapeParams;
// The two "as reported" references predate the edge slope cap (RIBBON_EDGE_SLOPE) and lift it: with the
// hold off, the cap would bound the quarter-pressure drop at the lift, and the end drawn as reported, which
// these cells measure against (and SHIPPED_END pins from 714cacb4), would no longer be drawn. The held
// ribbon has no drop at its end for the cap to bound, so the law in force is compared as it is.
const TIP_TAPER_NO_HOLD = { ...TIP_TAPER, liftHoldRatio: 0, edgeSlope: Number.POSITIVE_INFINITY } as ShapeParams;
const AS_REPORTED = { ...NO_HOLD, edgeSlope: Number.POSITIVE_INFINITY } as ShapeParams;

afterEach(() => setPressureSensitivity(true));

const STROKES: ReadonlyArray<readonly [string, (lift?: number) => InkPoint[]]> = [
	["quick lift stroke", (lift = 0.25) => quickLiftStroke(7, lift)],
	["push stroke", (lift = 0.249) => pushStroke(11, lift)],
];

/**
 * The unheld stroke's end under the pre-1.4.20 tip taper, measured on 714cacb4
 * (the shipped width law), so the calibration plant is known to BE that stroke.
 */
const SHIPPED_END: Record<string, { removed: number; endWidth: number }> = {
	"quick lift stroke": { removed: 27.62, endWidth: 5.87 },
	"push stroke": { removed: 52.48, endWidth: 9.61 },
};

/** The committed end width over the same stroke's with the lift sample drawn as reported: the last point's half-widths. */
function endRatio(pts: readonly InkPoint[], style: PenStyle, params: ShapeParams = PEN_SHAPE, unheld: ShapeParams = AS_REPORTED): number {
	const held = flattenStrokeShaped(pts, style, 2, params);
	const raw = flattenStrokeShaped(pts, style, 2, unheld);
	return held[held.length - 1]!.hw / raw[raw.length - 1]!.hw;
}

describe("the pen's quarter-pressure lift sample is drawn at the previous pressure", () => {
	it.each(STROKES)("%s: the committed ribbon is the held stroke's ribbon", (name, make) => {
		const pts = make();
		const style = exp7Style();
		expect(liftRatio(pts)).toBeLessThanOrEqual(0.35);
		const product = flattenStrokeShaped(pts, style, 2);
		expect(product, `${name}: the product still draws the lift sample`).toEqual(flattenStrokeShaped(heldAtPrevious(pts), style, 2, NO_HOLD));
		expect(product).not.toEqual(flattenStrokeShaped(pts, style, 2, NO_HOLD));
	});

	it.each(STROKES)("%s: the end is drawn at the held width, well above the lift sample's", (name, make) => {
		const ratio = endRatio(make(), exp7Style());
		// eslint-disable-next-line no-console
		console.log(`${name}: end width held / as reported ${ratio.toFixed(4)}`);
		expect(ratio).toBeGreaterThanOrEqual(1.3);
	});

	it.each(STROKES)("%s, under the pre-1.4.20 tip taper (calibration): the end taper removes at most 30% of what it removed, and the end is no longer halved", (name, make) => {
		const pts = make();
		const style = exp7Style();
		const shipped = endOf(pts, style, TIP_TAPER_NO_HOLD);
		const held = endOf(pts, style, TIP_TAPER);
		// eslint-disable-next-line no-console
		console.log(`${name}: removed ${shipped.removed.toFixed(3)} -> ${held.removed.toFixed(3)} px2, end width ${shipped.endWidth.toFixed(3)} -> ${held.endWidth.toFixed(3)}`);
		expect(shipped.removed).toBeCloseTo(SHIPPED_END[name]!.removed, 1);
		expect(shipped.endWidth).toBeCloseTo(SHIPPED_END[name]!.endWidth, 1);
		expect(held.removed, `${name}: taper removal`).toBeLessThanOrEqual(0.3 * shipped.removed);
		expect(held.endWidth, `${name}: end width`).toBeGreaterThanOrEqual(1.5 * shipped.endWidth);
	});

	it.each(STROKES)("%s: every sample before the last keeps its width", (_name, make) => {
		const pts = make();
		const style = exp7Style();
		expect(shapedHalfWidths(pts, style).slice(0, -1)).toEqual(shapedHalfWidths(pts, style, NO_HOLD).slice(0, -1));
	});

	it.each(STROKES)("%s without a lift sample renders exactly as before", (_name, make) => {
		const pts = make(0.9);
		const style = exp7Style();
		expect(flattenStrokeShaped(pts, style, 2)).toEqual(flattenStrokeShaped(pts, style, 2, NO_HOLD));
	});

	it("holds a final sample at 0.34x and leaves one at 0.36x", () => {
		const style = exp7Style();
		const fires = quickLiftStroke(7, 0.34);
		const stays = quickLiftStroke(7, 0.36);
		expect(flattenStrokeShaped(fires, style, 2)).toEqual(flattenStrokeShaped(heldAtPrevious(fires), style, 2, NO_HOLD));
		expect(flattenStrokeShaped(stays, style, 2)).toEqual(flattenStrokeShaped(stays, style, 2, NO_HOLD));
	});

	/**
	 * Threshold 0 means never. A last sample at pressure 0 is at
	 * or below 0x anything, so a bare "<=" held it even with the rule off. The
	 * release filter drops such a sample after confident contact, but not
	 * before it. Read against the same stroke ending at 1e-12, which no reading
	 * of the rule holds: the two must draw alike.
	 */
	it("with the threshold at 0 never holds, even a last sample at pressure 0", () => {
		const style = exp7Style();
		const zero = quickLiftStroke(7, 0);
		const tiny = zero.map((p, i) => (i === zero.length - 1 ? { ...p, pressure: 1e-12 } : p));
		const a = flattenStrokeShaped(zero, style, 2, NO_HOLD);
		const b = flattenStrokeShaped(tiny, style, 2, NO_HOLD);
		expect(a).toHaveLength(b.length);
		for (let i = 0; i < a.length; i++) expect(a[i]!.hw, `ribbon point ${i}`).toBeCloseTo(b[i]!.hw, 9);
	});

	it("leaves a two-sample stroke alone", () => {
		const style = exp7Style();
		const pts: InkPoint[] = [
			{ x: 0, y: 0, pressure: 0.6, t: 0 },
			{ x: 9, y: 2, pressure: 0.15, t: 4 },
		];
		expect(flattenStrokeShaped(pts, style, 2)).toEqual(flattenStrokeShaped(pts, style, 2, NO_HOLD));
	});

	it("leaves legacy (1.4.12) ink and pressure-off ink alone", () => {
		const pts = quickLiftStroke();
		const legacy: PenStyle = legacyStyle();
		expect(flattenStrokeShaped(pts, legacy, 2)).toEqual(flattenStrokeShaped(pts, legacy, 2, NO_HOLD));
		setPressureSensitivity(false);
		const style = exp7Style();
		expect(flattenStrokeShaped(pts, style, 2)).toEqual(flattenStrokeShaped(pts, style, 2, NO_HOLD));
	});

	it("leaves the wet layer alone", () => {
		const pts = quickLiftStroke();
		const style = exp7Style();
		const wet = (params: ShapeParams): number[] => {
			const shaper = new IncrementalShaper(params);
			shaper.reset(pts[0], style);
			return [shaper.last(), ...pts.slice(1).map((p) => shaper.push(style, p))];
		};
		expect(wet(PEN_SHAPE)).toEqual(wet(NO_HOLD));
	});
});

/**
 * Alan's own strokes (HW_PT_CAPTURES; never committed, skipped by the gate):
 * his four traces through the real router, builder and release filter
 * (87828c65 and 58569933 on 1.4.19; 07a85f68 and c4ff793d on
 * pressure-feel-1420-dev) and the Demo note's stored strokes. The hold must
 * fire on EVERY stroke whose final ratio is at or below 0.35 - counted, not
 * assumed - and draw the end at the held width: the held / as-reported end
 * width ratio on the law in force, measured on the tip-off law (tipFloor 1 on
 * d9d091de, which that law equals) and pinned to 4 decimals, +-0.01.
 */
const HOLD_END_RATIO: Record<string, Record<number, number>> = {
	"87828c65": { 0: 1.4659 },
	"58569933": { 0: 1.455, 1: 1.4095, 2: 1.4303, 3: 1.4453, 4: 1.4301, 6: 1.444, 7: 1.4413 },
	"07a85f68": { 0: 1.4647, 1: 1.4659 },
	c4ff793d: { 1: 1.4655 },
	demo: { 0: 1.436, 1: 1.4352, 2: 1.4659, 4: 1.4553, 5: 1.4087, 6: 1.43, 7: 1.4453, 8: 1.4314, 10: 1.444, 11: 1.4421 },
};

describe.skipIf(!CAPTURES)("the hold on Alan's captures", () => {
	let uninstall: () => void = () => {};
	beforeAll(() => {
		uninstall = installFakeWindow();
	});
	afterAll(() => uninstall());

	const firing = (pts: readonly InkPoint[]): boolean => pts.length > 2 && liftRatio(pts) <= 0.35;

	const holdReadout = (label: string, strokes: readonly InkStroke[]): number[] => {
		const fired: number[] = [];
		strokes.forEach((stroke, si) => {
			const pts = stroke.points;
			const style = styleOf(stroke);
			if (!firing(pts)) {
				expect.soft(flattenStrokeShaped(pts, style, 2), `${label}/s${si} untouched`).toEqual(flattenStrokeShaped(pts, style, 2, NO_HOLD));
				return;
			}
			fired.push(si);
			const ratio = endRatio(pts, style);
			// eslint-disable-next-line no-console
			console.log(`${label}/s${si} n ${pts.length} lift ratio ${liftRatio(pts).toFixed(3)} end width held / as reported ${ratio.toFixed(4)}`);
			expect.soft(flattenStrokeShaped(pts, style, 2), `${label}/s${si} ribbon`).toEqual(flattenStrokeShaped(heldAtPrevious(pts), style, 2, NO_HOLD));
			expect.soft(Math.abs(ratio - (HOLD_END_RATIO[label]?.[si] ?? Number.NaN)), `${label}/s${si} end ratio pin`).toBeLessThanOrEqual(0.01);
		});
		return fired;
	};

	it.each([
		["87828c65", [0]],
		["58569933", [0, 1, 2, 3, 4, 6, 7]],
		["07a85f68", [0, 1]],
		["c4ff793d", [1]],
	] as const)("trace %s: the hold fires on every lift stroke %j and draws the end at the held width", (id, expected) => {
		expect(holdReadout(id, replayTrace(`${CAPTURES}/${id}.json`))).toEqual(expected);
	});

	it("Demo stored strokes: the hold fires on all 10 lift strokes and draws the end at the held width", () => {
		const parsed = parsePage(readFileSync(`${CAPTURES}/sidecar-96c5e0cf.json`, "utf8"), "capture");
		expect(parsed.recovered).toBeFalsy();
		expect(holdReadout("demo", parsed.data.strokes)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 10, 11]);
	});

	it.each([
		["87828c65", 1],
		["58569933", 7],
	] as const)("trace %s, under the pre-1.4.20 tip taper (calibration): all %i lift strokes meet the 30% bar", (id, expectedFiring) => {
		let fired = 0;
		replayTrace(`${CAPTURES}/${id}.json`).forEach((stroke, si) => {
			const pts = stroke.points;
			if (!firing(pts)) return;
			fired++;
			const style = styleOf(stroke);
			const shipped = endOf(pts, style, TIP_TAPER_NO_HOLD);
			const held = endOf(pts, style, TIP_TAPER);
			// eslint-disable-next-line no-console
			console.log(`${id}/s${si} removed ${shipped.removed.toFixed(2)} -> ${held.removed.toFixed(2)} end ${shipped.endWidth.toFixed(2)} -> ${held.endWidth.toFixed(2)}`);
			expect.soft(held.removed, `${id}/s${si} taper removal`).toBeLessThanOrEqual(0.3 * shipped.removed);
		});
		expect(fired).toBe(expectedFiring);
	});

	/**
	 * Held removal per Demo stroke under the pre-1.4.20 tip taper, kept as
	 * calibration. The earlier absolute bar of 1.3 px^2 is dropped on the law in
	 * force, where the tip taper removes nothing.
	 */
	const DEMO_HELD_REMOVED: Record<number, number> = {
		0: 0.015, 1: 0, 2: 0.4357, 4: 0, 5: 0.3689, 6: 0.0161, 7: 0, 8: 0, 10: 1.2996, 11: 0.0907,
	};

	it("Demo stored strokes, under the pre-1.4.20 tip taper (calibration): each lift stroke at most 30% of its unheld removal, values pinned", () => {
		const parsed = parsePage(readFileSync(`${CAPTURES}/sidecar-96c5e0cf.json`, "utf8"), "capture");
		const fired: number[] = [];
		parsed.data.strokes.forEach((stroke, si) => {
			const pts = stroke.points;
			if (!firing(pts)) return;
			fired.push(si);
			const style = styleOf(stroke);
			const shipped = endOf(pts, style, TIP_TAPER_NO_HOLD);
			const held = endOf(pts, style, TIP_TAPER);
			// eslint-disable-next-line no-console
			console.log(`demo/s${si} removed ${shipped.removed.toFixed(2)} -> ${held.removed.toFixed(4)}`);
			expect.soft(held.removed, `demo/s${si} share`).toBeLessThanOrEqual(0.3 * shipped.removed);
			expect.soft(Math.abs(held.removed - (DEMO_HELD_REMOVED[si] ?? Number.NaN)), `demo/s${si} pin`).toBeLessThanOrEqual(0.01);
		});
		expect(fired).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 10, 11]);
	});
});
