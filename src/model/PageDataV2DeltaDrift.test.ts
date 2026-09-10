import { describe, expect, it } from "vitest";
import { InkPoint } from "../ink/Stroke";
import { packPointsV2, parsePage, unpackPointsV2 } from "./PageData";

/**
 * An unreadable v2 delta TRUNCATES the stroke and marks the file damaged.
 *
 * This file began as a characterisation of the defect (d223283), pinning the
 * wrong behaviour with received values so a fix would have to come back here
 * and re-pin deliberately. It has. The harness is unchanged; the assertions
 * now state the contract.
 *
 * THE DEFECT, for the record. `unpackPointsV2` advanced its accumulators with
 * `?? 0` before deciding whether a sample survived. Pressure and time are
 * DELTAS from the previous point, so an unreadable `dp` or `dt` contributed 0
 * instead of its real step, the point still decoded because x and y were fine,
 * and the shortfall was carried in the running total for every later sample.
 * `notePointLoss` could not see it: it compares decoded count against
 * `flat.length / 4`, and every point decoded. A cumulative corruption inside
 * the one content type that already had a loss detector, invisible to it.
 *
 * WHY THE FIX IS TRUNCATION AND NOT RECOVERY. The characterisation's `it.fails`
 * cases hoped for "every sample keeps its own pressure" - all six values back
 * exactly. **That is unachievable, and this file says so rather than quietly
 * pinning something weaker.** The 0.1 step at index 2 was replaced with junk;
 * nothing can reconstruct 0.3 from 0.2 and junk, and a pure delta stream has no
 * re-anchor from which later values could be recovered. From an unknown step
 * onward every absolute value is unknowable. So the correct contract is:
 * every sample BEFORE the bad delta is exact, NOTHING is emitted after it, the
 * loss is reported, and the file is marked damaged so the next save preserves
 * the original bytes. Everything emitted is right; everything lost is counted.
 *
 * The same rule applies to an unreadable dx or dy, which the old code handled
 * by skipping the point while leaving the accumulator un-advanced - the same
 * drift by another road. And the rule the old comment defended still stands:
 * a READABLE delta whose point is refused (outside MAX_COORD) must still
 * advance the accumulator, or later points slide. The last case pins that.
 */

/** Six samples, each one step further along in x, y, pressure and time. */
const POINTS: InkPoint[] = [
	{ x: 10, y: 10, pressure: 0.1, t: 0 },
	{ x: 20, y: 20, pressure: 0.2, t: 10 },
	{ x: 30, y: 30, pressure: 0.3, t: 20 },
	{ x: 40, y: 40, pressure: 0.4, t: 30 },
	{ x: 50, y: 50, pressure: 0.5, t: 40 },
	{ x: 60, y: 60, pressure: 0.6, t: 50 },
];

/** Index 2 of 6: far enough in that three later samples would inherit an error. */
const BAD = 2;
/** Offsets inside a quadruple: [dx, dy, dp, dt]. */
const DX = 0;
const DY = 1;
const DP = 2;
const DT = 3;
const OFFSETS = [DX, DY, DP, DT];

/** The packed stroke with one field of one quadruple made unreadable. */
function corrupted(offset: number): unknown[] {
	const flat: unknown[] = packPointsV2(POINTS);
	flat[BAD * 4 + offset] = "junk";
	return flat;
}

function sidecar(flat: unknown[]): string {
	return JSON.stringify({
		schemaVersion: 2,
		pageId: "v2-delta-drift",
		surface: "inline",
		textBoxes: [],
		images: [],
		strokes: [{ id: "s1", tool: "pen", color: "#000", width: 2, createdAt: 1, ptsd: flat }],
	});
}

describe("a v2 delta that does not decode truncates the stroke and marks the file damaged", () => {
	// The setup proof, first on purpose: if clean packing stopped round-tripping,
	// every assertion below would be testing the harness, not the decoder.
	it("the harness holds: clean packing round-trips every sample exactly", () => {
		const clean = unpackPointsV2(packPointsV2(POINTS));
		expect(clean).toHaveLength(POINTS.length);
		expect(clean.map((p) => p.x)).toEqual([10, 20, 30, 40, 50, 60]);
		expect(clean.map((p) => p.pressure)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
		expect(clean.map((p) => p.t)).toEqual([0, 10, 20, 30, 40, 50]);
		const loss = { lost: false };
		unpackPointsV2(packPointsV2(POINTS), loss);
		expect(loss.lost).toBe(false);
	});

	it("stops at the unreadable delta, whichever field it is: the samples before it are exact and none follow", () => {
		for (const offset of OFFSETS) {
			const pts = unpackPointsV2(corrupted(offset));
			// Two samples precede index 2. Not six, not five: two.
			expect(pts, `offset ${offset}`).toHaveLength(BAD);
			expect(pts.map((p) => p.x), `offset ${offset}`).toEqual([10, 20]);
			expect(pts.map((p) => p.y), `offset ${offset}`).toEqual([10, 20]);
			expect(pts.map((p) => p.pressure), `offset ${offset}`).toEqual([0.1, 0.2]);
			expect(pts.map((p) => p.t), `offset ${offset}`).toEqual([0, 10]);
		}
	});

	it("reports the loss through the codec's own out-parameter, for every field", () => {
		for (const offset of OFFSETS) {
			const loss = { lost: false };
			unpackPointsV2(corrupted(offset), loss);
			expect(loss.lost, `offset ${offset}`).toBe(true);
		}
	});

	it("the file is reported DAMAGED, so the next save preserves the original instead of overwriting it", () => {
		for (const offset of OFFSETS) {
			const parsed = parsePage(sidecar(corrupted(offset)), "v2-delta-drift");
			expect(parsed.damaged, `offset ${offset}`).toBe(true);
			expect(parsed.problem, `offset ${offset}`).toBeDefined();
			// The stroke is still there - shortened, not dropped.
			expect(parsed.data.strokes, `offset ${offset}`).toHaveLength(1);
			expect(parsed.data.strokes[0]!.points, `offset ${offset}`).toHaveLength(BAD);
		}
	});

	it("an unreadable FIRST quadruple yields no points at all, and is still reported", () => {
		const flat: unknown[] = packPointsV2(POINTS);
		flat[DP] = "junk";
		const loss = { lost: false };
		expect(unpackPointsV2(flat, loss)).toHaveLength(0);
		expect(loss.lost).toBe(true);
	});

	// THE RULE THE OLD COMMENT DEFENDED, kept. A delta that READS but lands on a
	// point outside MAX_COORD must still advance the accumulator, or every later
	// point slides by the skipped step. Here index 2 is pushed far out of range
	// and index 3 pulled back by the same amount: index 2 is refused, and index
	// 3 onward must land exactly where the clean stroke puts them.
	it("a readable delta whose point is refused still advances the accumulator, so later points do not slide", () => {
		const flat: unknown[] = packPointsV2(POINTS);
		const HUGE = 1e12; // packed hundredths: 1e10 world px, far beyond any coordinate bound
		flat[BAD * 4 + DX] = (flat[BAD * 4 + DX] as number) + HUGE;
		flat[(BAD + 1) * 4 + DX] = (flat[(BAD + 1) * 4 + DX] as number) - HUGE;
		const loss = { lost: false };
		const pts = unpackPointsV2(flat, loss);
		// Index 2 refused; the other five exact, including the three after it.
		expect(pts.map((p) => p.x)).toEqual([10, 20, 40, 50, 60]);
		expect(pts.map((p) => p.pressure)).toEqual([0.1, 0.2, 0.4, 0.5, 0.6]);
		expect(pts.map((p) => p.t)).toEqual([0, 10, 30, 40, 50]);
		// A refused point is still a lost point, and is reported as one.
		expect(loss.lost).toBe(true);
	});
});
