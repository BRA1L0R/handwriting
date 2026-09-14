import { describe, it, expect } from "vitest";
import { stableCameraOriginY, type CameraOriginY } from "./CameraOriginY";

describe("bounded camera Y measurement", () => {
	const basis = ["note", {}, .1];
	it("holds fractional scroll noise without advancing the retained origin", () => {
		const prior: CameraOriginY = { y: 10000, basis };
		for (const raw of [9999.999694824219, 10000.00015258789, 10000.000762939453, 10000]) {
			expect(stableCameraOriginY(raw, prior, basis, .1, 1, .2)).toBe(10000);
		}
		expect(prior.y).toBe(10000);
	});
	it("bounds both screen and backing displacement at nonunit scales", () => {
		const prior: CameraOriginY = { y: 20, basis };
		expect(stableCameraOriginY(20.001, prior, basis, .15, 2, .3)).toBe(20);
		// Screen cap rejects this even though the backing cap permits it.
		expect(stableCameraOriginY(20.004, prior, basis, .15, 2, .3)).toBe(20.004);
		// Backing cap rejects this even though the screen cap permits it.
		expect(stableCameraOriginY(20.001, prior, basis, .1, 2, 16)).toBe(20.001);
	});
	it("adopts cumulative real movement and reversals without walking the reference", () => {
		let prior: CameraOriginY = { y: 0, basis };
		for (let i = 1; i <= 100; i++) {
			const raw = i * .001;
			const accepted = stableCameraOriginY(raw, prior, basis, .1, 1, .2);
			expect(Math.abs(raw-accepted)*.1).toBeLessThanOrEqual(1/1024);
			prior = { y: accepted, basis };
		}
		expect(prior.y).toBeGreaterThan(.09);
		for (let i = 99; i >= 0; i--) {
			const raw = i * .001;
			prior = { y: stableCameraOriginY(raw, prior, basis, .1, 1, .2), basis };
			expect(Math.abs(raw-prior.y)*.1).toBeLessThanOrEqual(1/1024);
		}
		expect(Math.abs(prior.y)).toBeLessThan(.01);
	});
	it("accepts raw on every changed basis and never scales tolerance with position", () => {
		const prior = { y: 1e12, basis };
		expect(stableCameraOriginY(1e12+.1, prior, basis, .1, 1, .2)).toBe(1e12+.1);
		for (let i=0;i<basis.length;i++) {
			const changed = [...basis]; changed[i] = {};
			expect(stableCameraOriginY(1e12+.001, prior, changed, .1, 1, .2)).toBe(1e12+.001);
		}
	});
	it("missing or invalid geometry keeps raw behavior", () => {
		const prior = { y: 10, basis };
		expect(stableCameraOriginY(10.001, null, basis, .1, 1, .2)).toBe(10.001);
		for (const bad of [0, -1, NaN, Infinity]) {
			expect(stableCameraOriginY(10.001, prior, basis, bad, 1, .2)).toBe(10.001);
			expect(stableCameraOriginY(10.001, prior, basis, .1, bad, .2)).toBe(10.001);
			expect(stableCameraOriginY(10.001, prior, basis, .1, 1, bad)).toBe(10.001);
		}
		expect(stableCameraOriginY(NaN, prior, basis, .1, 1, .2)).toBeNaN();
	});
});
