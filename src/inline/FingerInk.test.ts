import { describe, expect, it } from "vitest";
import { FINGER_INK_PRESSURE, fingerInkEligible, type FingerInkState } from "./FingerInk";

const eligible: FingerInkState = {
	isIosApp: true,
	isPhone: true,
	toolPicked: true,
	penInkEnabled: true,
	tipMode: "nib",
	tool: "pen",
};

describe("iPhone finger ink eligibility", () => {
	it("requires the real iOS-phone pair and an explicit live nib pick", () => {
		expect(fingerInkEligible(eligible)).toBe(true);
		for (const patch of [
			{ isIosApp: false },
			{ isPhone: false },
			{ toolPicked: false },
			{ penInkEnabled: false },
			{ tipMode: "eraser" as const },
			{ tipMode: "lasso" as const },
			{ tipMode: "space" as const },
			{ tipMode: "pan" as const },
		]) {
			expect(fingerInkEligible({ ...eligible, ...patch })).toBe(false);
		}
	});

	it("allows both nibs and rejects non-inking tools", () => {
		expect(fingerInkEligible({ ...eligible, tool: "highlighter" })).toBe(true);
		expect(fingerInkEligible({ ...eligible, tool: "eraser" })).toBe(false);
	});

	it("uses one fixed no-pressure value", () => {
		expect(FINGER_INK_PRESSURE).toBe(0.5);
	});
});
