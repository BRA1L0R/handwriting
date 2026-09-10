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
	it("pins the 1.4.12 ON curve before and after an OFF round trip", () => {
		const golden: Array<[pressure: number, width: number]> = [
			[0, 0.77],
			[0.06, 0.9433602303012543],
			[0.1, 1.0242939556355661],
			[0.25, 1.2755813485483816],
			[0.5, 1.6202830872269456],
			[0.75, 1.922476251880749],
			[0.959, 2.155798199828466],
			[1, 2.2],
		];
		const assertGolden = () => {
			for (const [pressure, width] of golden) {
				expect(widthForPressure(DEFAULT_PEN, pressure), `pressure ${pressure}`).toBeCloseTo(
					width,
					12
				);
			}
		};

		assertGolden();
		setPressureSensitivity(false);
		setPressureSensitivity(true);
		assertGolden();
	});

	it("off preserves the 1.4.12 width at every pressure and base width", () => {
		setPressureSensitivity(false);
		// The historical law evaluated at NO_PRESSURE (0.5).
		const historical = 0.7364923123758843;
		for (const style of [DEFAULT_PEN, { ...DEFAULT_PEN, baseWidth: 4.75 }]) {
			for (const pressure of [0, 0.06, NO_PRESSURE, 0.959, 1]) {
				expect(widthForPressure(style, pressure)).toBeCloseTo(style.baseWidth * historical, 14);
			}
		}
	});

	it("off at the 2.2 base matches the saved ink's historical width", () => {
		setPressureSensitivity(false);
		// The literal width on screen, so a factor change that keeps the
		// arithmetic self-consistent but moves the ink still fails here.
		expect(DEFAULT_PEN.baseWidth).toBe(2.2);
		expect(widthForPressure(DEFAULT_PEN, NO_PRESSURE)).toBeCloseTo(1.6202830872269456, 12);
	});

	it("the explicit OFF factor remains independent of ON fields", () => {
		setPressureSensitivity(false);
		// Keep the explicit style API used by uniform-width callers.
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
