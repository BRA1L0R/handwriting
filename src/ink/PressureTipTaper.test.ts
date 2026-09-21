import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installFakeWindow } from "../../test/routerHarness";
import { CAPTURES, exp7Style, legacyStyle, pushStroke, quickLiftStroke, replayTrace, styleOf } from "../../test/pressureFeel";
import { flattenStrokeShaped, IncrementalShaper, PEN_SHAPE, type ShapeParams } from "./InkShape";
import { setPressureSensitivity, type PenStyle } from "./PenStyle";
import type { InkPoint } from "./Stroke";

/**
 * PRESSURE DRAWS THE TIPS (Alan on 1.4.20's dev build:
 * "the start, always. that's the taper getting vanished").
 *
 * The pre-1.4.20 exp7 tip taper eased each end of a committed stroke down to a
 * floor of that end's width over the stroke's widest, over up to 2.4 nib widths.
 * A push starts light, so its start was already thin from pressure and the taper
 * then multiplied it by that small ratio again: on Alan's four pushes the
 * committed start was 0.52-0.59 px against the 3.3-3.5 px the wet layer had
 * shown while he drew, six times thinner the moment he lifted. The wet shaper's
 * own start taper floors at the widest SO FAR, which is about 1 while a push is
 * still light, so wet and commit disagreed by construction.
 *
 * The rule: exp7 pen ink with pressure sensitivity on gets no geometric tip
 * taper at either end, wet or committed. Pressure is the taper. Legacy (1.4.12)
 * ink, pressure-off ink and the highlighter keep theirs, byte for byte.
 *
 * Read against a ribbon no taper can touch on either tree (tipFloor 1), and the
 * plant `exp7TipTaper: true` restores the pre-1.4.20 taper.
 */

const UNTAPERED = { ...PEN_SHAPE, tipFloor: 1 } as ShapeParams;
const TIP_TAPER = { ...PEN_SHAPE, exp7TipTaper: true } as ShapeParams;

afterEach(() => setPressureSensitivity(true));

const STROKES: ReadonlyArray<readonly [string, () => InkPoint[]]> = [
	["quick lift stroke", () => quickLiftStroke(7)],
	["push stroke", () => pushStroke(11)],
];

function wet(points: readonly InkPoint[], style: PenStyle, params: ShapeParams = PEN_SHAPE): number[] {
	const shaper = new IncrementalShaper(params);
	shaper.reset(points[0], style);
	return [shaper.last(), ...points.slice(1).map((p) => shaper.push(style, p))];
}

describe("pressure ink has no geometric tip taper", () => {
	it.each(STROKES)("%s: the committed ribbon is the untapered ribbon, both ends", (_name, make) => {
		const pts = make();
		const style = exp7Style();
		expect(flattenStrokeShaped(pts, style, 2)).toEqual(flattenStrokeShaped(pts, style, 2, UNTAPERED));
	});

	it.each(STROKES)("%s: the start after lift is the start the wet layer drew (sample 0, ratio 1)", (name, make) => {
		const pts = make();
		const style = exp7Style();
		const committed = flattenStrokeShaped(pts, style, 2)[0]!.hw;
		const drawn = wet(pts, style)[0]!;
		// eslint-disable-next-line no-console
		console.log(`${name}: start wet ${(drawn * 2).toFixed(4)} committed ${(committed * 2).toFixed(4)} ratio ${(committed / drawn).toFixed(4)}`);
		expect(committed / drawn).toBe(1);
	});

	it.each(STROKES)("%s: the wet layer draws no start taper either", (_name, make) => {
		const pts = make();
		const style = exp7Style();
		expect(wet(pts, style)).toEqual(wet(pts, style, UNTAPERED));
	});

	it.each(STROKES)("%s: the plant restores the pre-1.4.20 taper, which thinned the start", (_name, make) => {
		const pts = make();
		const style = exp7Style();
		const tapered = flattenStrokeShaped(pts, style, 2, TIP_TAPER)[0]!.hw;
		const untapered = flattenStrokeShaped(pts, style, 2, UNTAPERED)[0]!.hw;
		expect(tapered).toBeLessThan(0.5 * untapered);
	});

	it("legacy (1.4.12) ink and pressure-off ink keep their tips, committed and wet", () => {
		const pts = quickLiftStroke();
		const check = (style: PenStyle, label: string) => {
			const ribbon = flattenStrokeShaped(pts, style, 2);
			const flat = flattenStrokeShaped(pts, style, 2, UNTAPERED);
			expect(ribbon[0]!.hw, `${label} start at the tip floor`).toBeCloseTo(flat[0]!.hw * PEN_SHAPE.tipFloor, 12);
			expect(ribbon[ribbon.length - 1]!.hw, `${label} end at the tip floor`).toBeCloseTo(flat[flat.length - 1]!.hw * PEN_SHAPE.tipFloor, 12);
			expect(wet(pts, style), `${label} wet start taper`).not.toEqual(wet(pts, style, UNTAPERED));
		};
		check(legacyStyle(), "legacy");
		setPressureSensitivity(false);
		check(exp7Style(), "exp7 pressure off");
	});
});

/**
 * Alan's four traces (HW_PT_CAPTURES; never committed, skipped by the gate):
 * every stroke of three samples or more draws its committed start at the width
 * the wet layer drew at sample 0, pinned to 4 decimals (+-0.01) at the harness
 * nib (6.56). On d9d091de the committed start was about a sixth of the wet one
 * on the pushes.
 */
const START: Record<string, Record<number, number>> = {
	"87828c65": { 0: 1.2449, 1: 1.2145 },
	"58569933": { 0: 2.1312, 1: 1.8814, 2: 3.44, 3: 2.9774, 4: 1.8527, 6: 2.5456, 7: 2.9124 },
	"07a85f68": { 0: 1.1808, 1: 1.4452 },
	c4ff793d: { 1: 1.3707 },
};

describe.skipIf(!CAPTURES)("tips on Alan's captures", () => {
	let uninstall: () => void = () => {};
	beforeAll(() => {
		uninstall = installFakeWindow();
	});
	afterAll(() => uninstall());

	it.each(Object.keys(START))("trace %s: committed start == wet start on every stroke, widths pinned", (id) => {
		const seen: number[] = [];
		replayTrace(`${CAPTURES}/${id}.json`).forEach((stroke, si) => {
			const pts = stroke.points;
			if (pts.length < 3) return;
			seen.push(si);
			const style = styleOf(stroke);
			const committed = flattenStrokeShaped(pts, style, 2)[0]!.hw * 2;
			const drawn = wet(pts, style)[0]! * 2;
			// eslint-disable-next-line no-console
			console.log(`${id}/s${si} start wet ${drawn.toFixed(4)} committed ${committed.toFixed(4)} ratio ${(committed / drawn).toFixed(4)}`);
			expect.soft(committed / drawn, `${id}/s${si} lift ratio`).toBe(1);
			expect.soft(Math.abs(committed - (START[id]?.[si] ?? Number.NaN)), `${id}/s${si} start pin`).toBeLessThanOrEqual(0.01);
		});
		expect(seen).toEqual(Object.keys(START[id]!).map(Number));
	});
});
