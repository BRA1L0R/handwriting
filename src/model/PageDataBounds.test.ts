/**
 * Coordinate and width bounds on the sidecar reader (2026-09-01).
 *
 * Finiteness used to be the only check. A finite coordinate of 1e6 in one
 * point made StrokeIndex.rebuild walk millions of cells and the note froze
 * with no error; larger values never returned. Every point packing the
 * reader accepts must refuse such values the same way, and refusing must not
 * disturb the points around them.
 */

import { describe, expect, it } from "vitest";

import { StrokeIndex } from "../ink/StrokeIndex";
import { MAX_COORD, MAX_WIDTH, packPointsV2, parsePage, serializePage, unpackPointsV2 } from "./PageData";

function sidecar(strokes: unknown[], extra: Record<string, unknown> = {}): string {
	return JSON.stringify({ schemaVersion: 1, pageId: "p", strokes, ...extra });
}

const ok = { x: 10, y: 20, pressure: 0.5, t: 0 };
const okToo = { x: 11, y: 21, pressure: 0.5, t: 5 };

describe("sidecar coordinate bounds", () => {
	it("drops an object point beyond MAX_COORD and keeps its neighbours", () => {
		const r = parsePage(
			sidecar([{ id: "s", tool: "pen", color: "#000", width: 2, points: [ok, { x: MAX_COORD * 10, y: 0, pressure: 0.5, t: 1 }, okToo] }]),
			"fb"
		);
		expect(r.data.strokes[0]!.points.map((p) => p.x)).toEqual([10, 11]);
	});

	it("drops a v1 packed point beyond MAX_COORD", () => {
		const r = parsePage(
			sidecar([{ id: "s", tool: "pen", color: "#000", width: 2, pts: [10, 20, 0.5, 0, 1e9, 0, 0.5, 1, 11, 21, 0.5, 5] }]),
			"fb"
		);
		expect(r.data.strokes[0]!.points.map((p) => p.x)).toEqual([10, 11]);
	});

	it("drops a v2 delta point beyond MAX_COORD but keeps the running position aligned", () => {
		// Absolute x: 10, then 1e9 (dropped), then back to 11 via a negative delta.
		const flat = packPointsV2([ok, { x: 1e9, y: 0, pressure: 0.5, t: 1 }, okToo]);
		const pts = unpackPointsV2(flat);
		expect(pts.map((p) => p.x)).toEqual([10, 11]);
		expect(pts.map((p) => p.y)).toEqual([20, 21]);
	});

	// A corrupt DELTA is unrecoverable: the distance it carried is gone. This
	// case used to pin the OLD contract (534ab82, 2026-09-01) - keep decoding,
	// let every later point shift by the lost step, and call that "the bound
	// on the damage". It now pins the contract that SUPERSEDES it: stop at the
	// unreadable delta, emit only what is exact, and report the loss.
	//
	// Why the rule changed, and it is dated: on 2026-09-01 dropping the tail
	// and keeping a shifted one were BOTH permanently lossy, so keeping more
	// ink was the reasonable choice. 090916e (2026-09-08) then made a file
	// reported as damaged PRESERVE its original bytes on the next save. Under
	// the old contract the shift is silent - the point still decodes, so
	// `lost` never flips, `damaged` stays false, and the next save overwrites
	// the true ink with the drifted copy for good. Under this one nothing is
	// lost permanently: the in-memory stroke is short but right, and the
	// original is kept. The bounds-drop case above is unchanged - a delta that
	// READS still advances the running position through a refused point.
	it("a bad v2 quadruple ends the stroke there, exactly, and is reported", () => {
		const flat = packPointsV2([ok, okToo, { x: 12, y: 22, pressure: 0.5, t: 9 }]);
		flat[4] = "junk" as unknown as number; // dx of the second point (+1)
		const loss = { lost: false };
		const pts = unpackPointsV2(flat, loss);
		// Only the first point is knowable. Not [10, 11] - that 11 was a 12
		// displaced by the lost step, and the old pin recorded it as correct.
		expect(pts.map((p) => p.x)).toEqual([10]);
		expect(pts.map((p) => p.y)).toEqual([20]);
		expect(loss.lost).toBe(true);
	});

	it("a whole stroke of out-of-range points is dropped as unreadable", () => {
		const r = parsePage(
			sidecar([{ id: "s", tool: "pen", color: "#000", width: 2, points: [{ x: 1e8, y: 1e8, pressure: 0.5, t: 0 }] }]),
			"fb"
		);
		expect(r.data.strokes.length).toBe(0);
	});

	it("exactly MAX_COORD is still a coordinate", () => {
		const r = parsePage(
			sidecar([{ id: "s", tool: "pen", color: "#000", width: 2, points: [{ x: MAX_COORD, y: -MAX_COORD, pressure: 0.5, t: 0 }] }]),
			"fb"
		);
		expect(r.data.strokes[0]!.points[0]).toMatchObject({ x: MAX_COORD, y: -MAX_COORD });
	});

	it("bounds text box and image positions the same way", () => {
		const r = parsePage(
			sidecar([], {
				textBoxes: [{ id: "b", x: 5, y: 5, width: 100, z: 0 }, { id: "bad", x: 1e9, y: 0, width: 100, z: 0 }],
				images: [{ id: "i", x: 5, y: 5, width: 10, height: 10, z: 0 }, { id: "ibad", x: 0, y: -1e9, width: 10, height: 10, z: 0 }],
			}),
			"fb"
		);
		expect(r.data.textBoxes.map((b) => b.id)).toEqual(["b"]);
		expect(r.data.images.map((i) => i.id)).toEqual(["i"]);
	});
});

describe("sidecar width bounds", () => {
	it("an absurd width falls back to the default rather than padding the bbox with it", () => {
		const r = parsePage(sidecar([{ id: "s", tool: "pen", color: "#000", width: MAX_WIDTH * 1000, points: [ok, okToo] }]), "fb");
		const s = r.data.strokes[0]!;
		expect(s.width).toBe(2.2);
		expect(s.bbox.width).toBeLessThan(20);
	});

	it("zero and negative widths fall back too", () => {
		for (const width of [0, -3]) {
			const r = parsePage(sidecar([{ id: "s", tool: "pen", color: "#000", width, points: [ok, okToo] }]), "fb");
			expect(r.data.strokes[0]!.width).toBe(2.2);
		}
	});

	it("an ordinary width is kept exactly", () => {
		const r = parsePage(sidecar([{ id: "s", tool: "pen", color: "#000", width: 5.5, points: [ok, okToo] }]), "fb");
		expect(r.data.strokes[0]!.width).toBe(5.5);
	});
});

// K1, audit-fixes-design.md 5k: an object id is a key of unknownByObject,
// and on a plain object "__proto__" as a key is a prototype write, not a
// data write. isSafePageId rejects it (its first char is not [A-Za-z0-9]),
// so the object is dropped with the id, same as a bad coordinate.
describe("sidecar object id safety", () => {
	it("drops a stroke whose id is \"__proto__\" instead of writing through it", () => {
		const r = parsePage(
			sidecar([
				{ id: "__proto__", tool: "pen", color: "#000", width: 2, points: [ok, okToo], polluted: "yes" },
			]),
			"fb"
		);
		expect(r.data.strokes.length).toBe(0);
		expect(({} as any).polluted).toBeUndefined();
	});

	it("an ordinary unknown field on a stroke still round-trips through serializePage -> parsePage", () => {
		const r = parsePage(
			sidecar([{ id: "s", tool: "pen", color: "#000", width: 2, points: [ok, okToo], futureField: "kept" }]),
			"fb"
		);
		expect(r.data.unknownByObject["s"]).toEqual({ futureField: "kept" });
		const json = serializePage(r.data);
		expect(JSON.parse(json).strokes[0].futureField).toBe("kept");
		const r2 = parsePage(json, "fb");
		expect(r2.data.unknownByObject["s"]).toEqual({ futureField: "kept" });
	});
});

describe("the freeze that motivated the bounds", () => {
	it("a sidecar with a 1e6 coordinate indexes in milliseconds, not minutes", () => {
		const r = parsePage(
			sidecar([{ id: "s", tool: "pen", color: "#000", width: 2, points: [ok, { x: 1e6, y: 1e6, pressure: 0.5, t: 1 }] }]),
			"fb"
		);
		const idx = new StrokeIndex();
		const started = performance.now();
		idx.rebuild(r.data.strokes);
		expect(performance.now() - started).toBeLessThan(100);
		// 1e6 is inside MAX_COORD, so the point survives; the index copes on its own.
		expect(r.data.strokes[0]!.points.length).toBe(2);
	});
});
