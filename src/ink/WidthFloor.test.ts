import { describe, expect, it } from "vitest";
import { flooredHalfWidth } from "./WidthFloor";

describe("flooredHalfWidth", () => {
	it("is the identity at backing === dpr, for a normal and a thin stroke", () => {
		expect(flooredHalfWidth(1.32, 1, 1)).toBe(1.32);
		expect(flooredHalfWidth(0.33, 1, 1)).toBe(0.33);
		expect(flooredHalfWidth(1.32, 2, 2)).toBe(1.32);
	});

	it("floors a normal stroke to one device pixel at backing 0.1, dpr 1", () => {
		expect(flooredHalfWidth(1.32, 0.1, 1)).toBeCloseTo(5.0, 10);
	});

	it("floors a thin stroke to its own 100% look at backing 0.1, dpr 1", () => {
		expect(flooredHalfWidth(0.33, 0.1, 1)).toBeCloseTo(3.3, 10);
	});

	it("floors at backing 0.2, dpr 2", () => {
		// hw*dpr = 2.64, so `min(0.5, …)` SATURATES and the floor is 0.5/backing.
		expect(flooredHalfWidth(1.32, 0.2, 2)).toBeCloseTo(2.5, 10);
	});

	it("floors at backing 0.2, dpr 2 on the NON-saturating branch", () => {
		// The other side of the `min`, which the case above cannot reach: a hw
		// thin enough that hw*dpr is under half a device pixel. 0.2*2 = 0.4, so
		// the floor is 0.4/0.2 = 2.0 rather than 0.5/0.2 = 2.5. Without this the
		// dpr=2 coverage pins one branch only, and swapping `min` for its left
		// argument alone would still pass.
		expect(flooredHalfWidth(0.2, 0.2, 2)).toBeCloseTo(2.0, 10);
	});

	it("never returns less than hw", () => {
		expect(flooredHalfWidth(10, 0.01, 1)).toBeGreaterThanOrEqual(10);
	});

	it("returns hw unchanged on NaN, zero, and negative inputs", () => {
		expect(flooredHalfWidth(Number.NaN, 0.1, 1)).toBe(Number.NaN);
		expect(flooredHalfWidth(1.32, Number.NaN, 1)).toBe(1.32);
		expect(flooredHalfWidth(1.32, 0.1, Number.NaN)).toBe(1.32);
		expect(flooredHalfWidth(0, 0.1, 1)).toBe(0);
		expect(flooredHalfWidth(-1.32, 0.1, 1)).toBe(-1.32);
		expect(flooredHalfWidth(1.32, 0, 1)).toBe(1.32);
		expect(flooredHalfWidth(1.32, -0.1, 1)).toBe(1.32);
		expect(flooredHalfWidth(1.32, 0.1, 0)).toBe(1.32);
		expect(flooredHalfWidth(1.32, 0.1, -1)).toBe(1.32);
	});
});
