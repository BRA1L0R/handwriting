/**
 * PROBE, not a pin: can `snapStroke` ever emit a non-finite coordinate?
 *
 * `ShapeSnap` synthesises the points that get STORED (the snapped shape
 * replaces the drawn stroke), it divides by `len`, `rx` and `ry` without
 * guarding any of them, and it contains zero `Number.isFinite` checks. The
 * serializer downstream has no finite guard either, and `JSON.stringify` turns
 * `NaN` into `null` - which the reader then counts as decode loss and reports
 * as damage, which opens the note blank.
 *
 * So this asks the only question that decides whether
 * `ink-writer-rejects-non-finite` is urgent or theoretical: can ordinary
 * degenerate input drive a `NaN` into a stored coordinate?
 *
 * It is deliberately adversarial about SHAPE, not about values - every input
 * here is finite and plausible for a real gesture. A probe that fed in `NaN`
 * would prove nothing.
 */
import { describe, expect, it } from "vitest";
import { snapStroke } from "./ShapeSnap";
import type { InkStroke, InkPoint } from "./Stroke";

function stroke(points: InkPoint[]): InkStroke {
	return {
		id: "probe",
		tool: "pen",
		color: "#000000",
		width: 2,
		createdAt: 0,
		points,
	} as InkStroke;
}

function pt(x: number, y: number, t: number): InkPoint {
	return { x, y, pressure: 0.5, t };
}

/** Every degenerate gesture shape a hand can actually produce. */
const cases: Array<[string, InkPoint[]]> = [
	["a single point", [pt(10, 10, 0)]],
	["two identical points", [pt(10, 10, 0), pt(10, 10, 8)]],
	[
		"many identical points (a long press)",
		Array.from({ length: 60 }, (_, i) => pt(10, 10, i * 8)),
	],
	[
		"a perfectly horizontal line (ry would be 0)",
		Array.from({ length: 60 }, (_, i) => pt(i, 50, i * 8)),
	],
	[
		"a perfectly vertical line (rx would be 0)",
		Array.from({ length: 60 }, (_, i) => pt(50, i, i * 8)),
	],
	[
		"a closed loop of zero size",
		Array.from({ length: 60 }, (_, i) => pt(10, 10, i * 8)),
	],
	[
		"a back-and-forth on one axis, returning to start",
		Array.from({ length: 60 }, (_, i) => pt(i < 30 ? i : 59 - i, 50, i * 8)),
	],
	[
		"two points very far apart (large but finite)",
		[pt(-1e6, -1e6, 0), pt(1e6, 1e6, 8)],
	],
];

/**
 * CALIBRATION. Every case is allowed to refuse to snap, and a suite where all
 * of them refused would be eight green tests asserting nothing. This counts the
 * cases that actually reached the emit path, and the last test fails if none
 * did - so the probe cannot report "no NaN" from a run that never ran.
 */
let snapped = 0;
let pointsChecked = 0;

describe("ShapeSnap never emits a non-finite stored coordinate", () => {
	it.each(cases)("%s", (_name, points) => {
		for (const dwell of [false, true]) {
			const out = snapStroke(stroke(points), dwell);
			if (!out) continue; // refusing to snap is a fine answer
			snapped++;
			for (const p of out.points) {
				pointsChecked++;
				expect(Number.isFinite(p.x), `x was ${p.x}`).toBe(true);
				expect(Number.isFinite(p.y), `y was ${p.y}`).toBe(true);
				expect(Number.isFinite(p.pressure), `pressure was ${p.pressure}`).toBe(true);
				expect(Number.isFinite(p.t), `t was ${p.t}`).toBe(true);
			}
		}
	});

	it("CALIBRATION: the cases above actually reached the emit path", () => {
		expect(snapped, "no case snapped - the finite assertions never ran").toBeGreaterThan(0);
		expect(pointsChecked, "no point was examined").toBeGreaterThan(0);
	});
});
