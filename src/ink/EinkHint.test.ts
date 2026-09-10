/**
 * The hint's decision, driven directly. Every value fed here stands for the
 * median of ONE fresh batch the caller has already detached - see
 * LatencyEstimate's `consumeHintLagMs` - so "three checks" here means three
 * disjoint observations, never three reads of one rolling median.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { noteLag, resetEinkHint, resetEinkHintProgress } from "./EinkHint";

describe("EinkHint", () => {
	beforeEach(() => resetEinkHint());

	it("undefined never fires", () => {
		expect(noteLag(undefined)).toBe(false);
		expect(noteLag(undefined)).toBe(false);
		expect(noteLag(undefined)).toBe(false);
	});

	it("undefined resets a partial run", () => {
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		// The batch was too small to have an opinion, which is not evidence
		// that the machine is fine - so the run starts over rather than
		// carrying two thirds of a decision across the gap.
		expect(noteLag(undefined)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(true);
	});

	it("a median below the threshold never fires", () => {
		expect(noteLag(10)).toBe(false);
		expect(noteLag(10)).toBe(false);
		expect(noteLag(10)).toBe(false);
		expect(noteLag(10)).toBe(false);
	});

	it("three consecutive fresh batches at/above threshold fire exactly once, then latch", () => {
		expect(noteLag(40)).toBe(false);
		expect(noteLag(40)).toBe(false);
		expect(noteLag(40)).toBe(true);
		// Latched: further batches, however slow, never fire again.
		expect(noteLag(100)).toBe(false);
		expect(noteLag(100)).toBe(false);
	});

	it("equal medians from distinct batches still count", () => {
		// Two batches reading 50 are two facts about the machine, not one fact
		// read twice - the caller has already guaranteed they are disjoint.
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(true);
	});

	it("a run broken by a low batch starts over", () => {
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(10)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(true);
	});

	it("boundary: exactly 40 fires, 39.9 does not", () => {
		expect(noteLag(39.9)).toBe(false);
		expect(noteLag(39.9)).toBe(false);
		expect(noteLag(39.9)).toBe(false);
		resetEinkHint();
		expect(noteLag(40)).toBe(false);
		expect(noteLag(40)).toBe(false);
		expect(noteLag(40)).toBe(true);
	});

	it("resetEinkHintProgress clears a partial run", () => {
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		resetEinkHintProgress();
		// Two thirds of a run is gone: this batch is the first of a new three.
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(true);
	});

	it("resetEinkHintProgress does NOT reopen the latch", () => {
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(true);
		resetEinkHintProgress();
		// Told once is once, even across a mode change that clears progress.
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
	});

	it("resetEinkHint clears the latch as well, so the suite can start clean", () => {
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(true);
		resetEinkHint();
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(false);
		expect(noteLag(50)).toBe(true);
	});
});
