import { describe, expect, it } from "vitest";
import { analyzePointerDeliveryTrace, PointerTraceEntry } from "./PointerDeliveryTrace";

function entry(overrides: Partial<PointerTraceEntry> = {}): PointerTraceEntry {
	return {
		t: 10, type: "pointermove", id: 1, ptr: "pen", buttons: 1, button: 0,
		pressure: 0.5, x: 10, y: 20, tx: 0, ty: 0, note: "", eventId: "e1",
		epoch: 1, role: "sample", sourceT: 10, observationT: 100, ...overrides,
	};
}

describe("pointer delivery trace analysis", () => {
	it("counts a coalesced parent once while retaining dense source samples", () => {
		const result = analyzePointerDeliveryTrace([
			entry({ type: "pointerdown", role: "lifecycle", eventId: "d", sourceT: 1, observationT: 90 }),
			entry({ eventId: "m", sourceT: 20, observationT: 110, cs: [{ t: 12, x: 1, y: 2, p: 0.2 }, { t: 16, x: 2, y: 3, p: 0.4 }] }),
			entry({ eventId: "m", role: "annotation", sourceT: 20, observationT: 110, cs: undefined }),
			entry({ type: "pointerup", role: "lifecycle", eventId: "u", sourceT: 30, observationT: 120 }),
		]);
		expect(result.available).toBe(true);
		expect(result.streams.pointermove!).toMatchObject({ parentCount: 1, sampleCount: 2, coalescedParentCount: 1 });
		expect(result.incomplete).toBe(false);
	});

	it("keeps raw and move streams separate and marks unpaired or reused contacts incomplete", () => {
		const result = analyzePointerDeliveryTrace([
			entry({ type: "pointermove", eventId: "u", sourceT: 1, observationT: 1 }),
			entry({ type: "pointerdown", eventId: "d1", role: "lifecycle", sourceT: 2, observationT: 2 }),
			entry({ type: "pointerrawupdate", eventId: "r", sourceT: 3, observationT: 3 }),
			entry({ type: "pointerup", eventId: "u1", role: "lifecycle", sourceT: 4, observationT: 4 }),
			entry({ type: "pointerdown", eventId: "d2", role: "lifecycle", sourceT: 5, observationT: 5 }),
		]);
		expect(result.streams.pointermove!.sampleCount).toBe(1);
		expect(result.streams.pointerrawupdate!.sampleCount).toBe(1);
		expect(Object.keys(result.contacts)).toHaveLength(3);
		expect(result.incomplete).toBe(true);
	});

	it("refuses old captures instead of inventing timing", () => {
		const old = { ...entry() };
		delete old.eventId;
		expect(analyzePointerDeliveryTrace([old])).toMatchObject({ available: false });
	});

	it("carries explicit truncation and partial-batch evidence", () => {
		const result = analyzePointerDeliveryTrace([entry({ partial: true })], {
			truncated: true, partialBatch: true, evictedRows: 4, evictedSamples: 7,
		});
		expect(result).toMatchObject({ truncated: true, partialBatch: true, evictedRows: 4, evictedSamples: 7 });
	});

	it("prefers the canonical down over a same-event window annotation", () => {
		const result = analyzePointerDeliveryTrace([
			entry({ type: "window-pointerdown", role: "lifecycle", eventId: "d", sourceT: 1, observationT: 2 }),
			entry({ type: "pointerdown", role: "lifecycle", eventId: "d", sourceT: 1, observationT: 2 }),
			entry({ type: "pointerup", role: "lifecycle", eventId: "u", sourceT: 3, observationT: 4 }),
		]);
		expect(Object.keys(result.contacts)).toHaveLength(1);
		expect(result.incomplete).toBe(false);
	});

	it("does not fabricate a parent sample from a partial zero-child batch", () => {
		const result = analyzePointerDeliveryTrace([
			entry({ partial: true, cs: undefined }),
		]);
		expect(result.streams.pointermove!.sampleCount).toBe(0);
		expect(result.incomplete).toBe(true);
	});

	it("does not count retained children from a partial batch", () => {
		const result = analyzePointerDeliveryTrace([
			entry({ partial: true, cs: [{ t: 11, x: 1, y: 1, p: 0.2 }, { t: 12, x: 2, y: 2, p: 0.3 }] }),
		]);
		expect(result.streams.pointermove!.sampleCount).toBe(2);
		expect(result.incomplete).toBe(true);
	});

	it("marks a lone up and evicted contacts as globally and locally incomplete", () => {
		const result = analyzePointerDeliveryTrace([
			entry({ type: "pointerup", role: "lifecycle", eventId: "up", sourceT: 2, observationT: 2 }),
		], { evictedRows: 1 });
		expect(result.incomplete).toBe(true);
		expect(Object.values(result.contacts)[0]?.incomplete).toBe(true);
	});
});
