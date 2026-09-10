import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_PEN,
	HIGHLIGHTER_PEN,
	NO_PRESSURE,
	type PenStyle,
	setPressureSensitivity,
	widthForPressure,
} from "./PenStyle";
import { PEN_SHAPE } from "./InkShape";

afterEach(() => setPressureSensitivity(true));

describe("pressure sensitivity", () => {
	it("pins Alan's accepted exp7 ON curve before and after an OFF round trip", () => {
		const golden: Array<[pressure: number, width: number]> = [
			[0, 0.396],
			[0.06, 0.657399],
			[0.1, 0.866359],
			[0.25, 1.745151],
			[0.5, 3.389954],
			[0.75, 5.168545],
			[0.959, 6.72771],
			[1, 7.04],
		];
		const assertGolden = () => {
			for (const [pressure, width] of golden) {
				expect(widthForPressure(DEFAULT_PEN, pressure), `pressure ${pressure}`).toBeCloseTo(
					width,
					6
				);
			}
		};

		assertGolden();
		setPressureSensitivity(false);
		setPressureSensitivity(true);
		assertGolden();
	});

	it("off paints the width Alan SELECTED, at every pressure and base width", () => {
		setPressureSensitivity(false);
		// The selected factor, not the old shipped one (0.7364923123758843).
		// He picked the displayed 0.32 -> 2.19 row - "same as the hardest
		// press" - and this pins that choice rather than a point on a curve.
		const selected = 0.9945718882219903;
		for (const style of [DEFAULT_PEN, { ...DEFAULT_PEN, baseWidth: 4.75 }]) {
			for (const pressure of [0, 0.06, NO_PRESSURE, 0.959, 1]) {
				expect(widthForPressure(style, pressure)).toBeCloseTo(style.baseWidth * selected, 14);
			}
		}
	});

	it("off at the 2.2 base is the 2.19 row he was looking at", () => {
		setPressureSensitivity(false);
		// The literal width on screen, so a factor change that keeps the
		// arithmetic self-consistent but moves the ink still fails here.
		expect(DEFAULT_PEN.baseWidth).toBe(2.2);
		expect(widthForPressure(DEFAULT_PEN, NO_PRESSURE)).toBeCloseTo(2.188058154088379, 12);
	});

	it("the selected factor is FROZEN, not re-derived from the live ON law", () => {
		setPressureSensitivity(false);
		// Move every ON-curve field. The OFF width must not follow, because it
		// is a choice he made once, not a sample of whatever the curve is now.
		const moved: PenStyle = {
			...DEFAULT_PEN,
			minWidthFactor: 0.5,
			gamma: 2.4,
			maxWidthFactor: 9,
		};
		expect(widthForPressure(moved, NO_PRESSURE)).toBeCloseTo(
			widthForPressure(DEFAULT_PEN, NO_PRESSURE),
			14
		);
	});

	it("off is independent of the ON ceiling", () => {
		setPressureSensitivity(false);
		const low: PenStyle = { ...DEFAULT_PEN, maxWidthFactor: 1 };
		const high: PenStyle = { ...DEFAULT_PEN, maxWidthFactor: 99 };
		expect(widthForPressure(low, 1)).toBe(widthForPressure(high, 0));
	});

	it("the highlighter keeps its own flat maximum and historical OFF width", () => {
		expect(widthForPressure(HIGHLIGHTER_PEN, 1)).toBe(HIGHLIGHTER_PEN.baseWidth);
		setPressureSensitivity(false);
		expect(widthForPressure(HIGHLIGHTER_PEN, 0)).toBe(HIGHLIGHTER_PEN.baseWidth * 0.95);
		expect(widthForPressure(HIGHLIGHTER_PEN, 1)).toBe(HIGHLIGHTER_PEN.baseWidth * 0.95);
		expect(PEN_SHAPE.thinningK).toBeGreaterThan(0);
		expect(PEN_SHAPE.taperWidths).toBeGreaterThan(0);
	});
});
