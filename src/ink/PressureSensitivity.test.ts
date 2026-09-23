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

	it("renders saved samples identically under either capture preference", () => {
		for (const style of [DEFAULT_PEN, HIGHLIGHTER_PEN, { ...DEFAULT_PEN, baseWidth: 4.75 }]) {
			setPressureSensitivity(true);
			const samples = [0, 0.06, NO_PRESSURE, 0.959, 1];
			const before = samples.map(p => widthForPressure(style, p));
			setPressureSensitivity(false);
			expect(samples.map(p => widthForPressure(style, p))).toEqual(before);
		}
	});

	it("derives width from the style and effective pressure alone", () => {
		setPressureSensitivity(false);
		const moved: PenStyle = { ...DEFAULT_PEN, minWidthFactor: 0.5, gamma: 2.4, maxWidthFactor: 9 };
		expect(widthForPressure(moved, 1)).toBe(moved.baseWidth * 9);
		expect(widthForPressure(moved, 0)).toBe(moved.baseWidth * 0.5);
		expect(widthForPressure(HIGHLIGHTER_PEN, 1)).toBe(HIGHLIGHTER_PEN.baseWidth);
		expect(PEN_SHAPE.thinningK).toBeGreaterThan(0);
	});
});
