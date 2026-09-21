import { describe, expect, it } from "vitest";
import type { InkStroke } from "../ink/Stroke";
import { SLIDES_HISTORY_LIMIT, SlidesInkHistory } from "./SlidesInkHistory";

function stroke(id: string, page = 1): InkStroke {
	return {
		id, page, tool: "pen", color: "#000000", width: 2, createdAt: 1,
		points: [{ x: 10, y: 20, pressure: 0.7, t: 0 }],
		bbox: { x: 9, y: 19, width: 2, height: 2 },
	};
}

describe("SlidesInkHistory", () => {
	it("ignores no-ops without discarding redo", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a");
		const buckets = new Map<number, InkStroke[]>([[0, [a]]]);
		expect(history.record("Empty", [])).toBe(false);
		history.record("Draw on slide 1", [{ index: 0, before: [], after: [a] }]);
		expect(history.undo(buckets)).toBe("Draw on slide 1");
		expect(history.record("No change", [{ index: 0, before: [a], after: [a] }])).toBe(false);
		expect(history.record("Empty clear", [{ index: 0, before: [], after: [] }])).toBe(false);
		expect(history.redoLabel).toBe("Draw on slide 1");
		expect(history.redo(buckets)).toBe("Draw on slide 1");
		expect(buckets.get(0)).toEqual([a]);
	});

	it("undoes draw, partial erase and clear in deck chronology across slides", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a"), b = stroke("b", 2), fragment = stroke("b-part", 2);
		const buckets = new Map<number, InkStroke[]>();
		history.record("Draw on slide 1", [{ index: 0, before: [], after: [a] }]);
		buckets.set(0, [a]);
		history.record("Draw on slide 2", [{ index: 1, before: [], after: [b] }]);
		buckets.set(1, [b]);
		history.record("Erase on slide 2", [{ index: 1, before: [b], after: [fragment] }]);
		buckets.set(1, [fragment]);
		history.record("Clear slide 1", [{ index: 0, before: [a], after: [] }]);
		buckets.delete(0);
		expect(history.undo(buckets)).toBe("Clear slide 1");
		expect(buckets.get(0)?.[0]).toBe(a);
		expect(buckets.get(1)).toEqual([fragment]);
		expect(history.undo(buckets)).toBe("Erase on slide 2");
		expect(buckets.get(1)?.[0]).toBe(b);
		expect(history.undo(buckets)).toBe("Draw on slide 2");
		expect(buckets.has(1)).toBe(false);
		expect(history.undo(buckets)).toBe("Draw on slide 1");
		expect(buckets.size).toBe(0);
		expect(history.undo(buckets)).toBeNull();
		for (let i = 0; i < 4; i++) history.redo(buckets);
		expect(buckets).toEqual(new Map([[1, [fragment]]]));
		expect(history.redo(buckets)).toBeNull();
	});

	it("clears every stored bucket, including unmatched ink, as one composite undo", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a"), b = stroke("b"), retained = stroke("retained", 501);
		const buckets = new Map<number, InkStroke[]>([[0, [b, a]], [500, [retained]]]);
		history.record("Clear all presentation ink", [...buckets].map(([index, before]) => ({ index, before, after: [] })));
		buckets.clear();
		history.undo(buckets);
		expect(buckets.get(0)).toEqual([b, a]);
		expect(buckets.get(500)?.[0]).toBe(retained);
		expect(buckets.get(500)?.[0]?.page).toBe(501);
		expect(history.undoLabel).toBeNull();
		history.redo(buckets);
		expect(buckets.size).toBe(0);
	});

	it("copies arrays at record and replay while retaining immutable stroke identity", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a"), b = stroke("b");
		const before = [a], after = [a, b];
		history.record("Draw", [{ index: 0, before, after }]);
		before.length = 0;
		after.reverse();
		const buckets = new Map<number, InkStroke[]>();
		history.undo(buckets);
		expect(buckets.get(0)?.[0]).toBe(a);
		buckets.get(0)!.push(b);
		history.redo(buckets);
		expect(buckets.get(0)).toEqual([a, b]);
		buckets.get(0)!.reverse();
		history.undo(buckets);
		expect(buckets.get(0)).toEqual([a]);
	});

	it("forks redo only for a new effective operation and restores whole erase order", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a"), b = stroke("b"), c = stroke("c");
		const buckets = new Map<number, InkStroke[]>([[0, [a, c]]]);
		history.record("Erase", [{ index: 0, before: [a, b, c], after: [a, c] }]);
		history.undo(buckets);
		expect(buckets.get(0)).toEqual([a, b, c]);
		history.record("Reorder", [{ index: 0, before: [a, b, c], after: [c, a, b] }]);
		expect(history.redoLabel).toBeNull();
		expect(history.redo(buckets)).toBeNull();
	});

	it("combines repeated bucket changes and drops a net no-op", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a"), b = stroke("b");
		expect(history.record("Round trip", [
			{ index: 0, before: [a], after: [b] },
			{ index: 0, before: [b], after: [a] },
		])).toBe(false);
		history.record("Composite", [
			{ index: 0, before: [a], after: [b] },
			{ index: 0, before: [b], after: [] },
		]);
		const buckets = new Map<number, InkStroke[]>();
		history.undo(buckets);
		expect(buckets.get(0)).toEqual([a]);
		history.redo(buckets);
		expect(buckets.has(0)).toBe(false);
	});

	it("preserves cold-load additions when undoing and redoing an earlier local draw", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a"), b = stroke("stored-b");
		history.record("Draw", [{ index: 0, before: [], after: [a] }]);
		const buckets = new Map<number, InkStroke[]>([[0, [a, b]]]);
		const incoming = [b];
		history.rebaseInitial(new Map([[0, incoming]]));
		incoming.length = 0;
		expect(history.undo(buckets)).toBe("Draw");
		expect(buckets.get(0)).toEqual([b]);
		expect(history.redo(buckets)).toBe("Draw");
		expect(buckets.get(0)).toEqual([a, b]);
	});

	it("keeps cold-load ink across a local erase and the preceding local draw", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a"), b = stroke("stored-b");
		history.record("Draw", [{ index: 0, before: [], after: [a] }]);
		history.record("Erase", [{ index: 0, before: [a], after: [] }]);
		const buckets = new Map<number, InkStroke[]>([[0, [b]]]);
		history.rebaseInitial(new Map([[0, [b]]]));
		history.undo(buckets);
		expect(buckets.get(0)).toEqual([a, b]);
		history.undo(buckets);
		expect(buckets.get(0)).toEqual([b]);
		history.redo(buckets);
		history.redo(buckets);
		expect(buckets.get(0)).toEqual([b]);
	});

	it("rebases redo snapshots by slide, deduplicates IDs and retains existing objects", () => {
		const history = new SlidesInkHistory();
		const a = stroke("a"), b = stroke("stored-b"), c = stroke("other-slide", 2);
		history.record("Draw", [{ index: 0, before: [], after: [a] }]);
		const buckets = new Map<number, InkStroke[]>([[0, [a]]]);
		history.undo(buckets);
		buckets.set(0, [b]);
		buckets.set(1, [c]);
		history.rebaseInitial(new Map([[0, [b, { ...b }]], [1, [c]]]));
		history.rebaseInitial(new Map([[0, [{ ...b }]]]));
		expect(history.redoLabel).toBe("Draw");
		history.redo(buckets);
		expect(buckets.get(0)).toEqual([a, b]);
		expect(buckets.get(0)?.[1]).toBe(b);
		expect(buckets.get(1)).toEqual([c]);
		history.undo(buckets);
		expect(buckets.get(0)).toEqual([b]);
		expect(buckets.get(1)).toEqual([c]);
	});

	it("retains the latest 100 operations and clears both stacks at an adoption boundary", () => {
		const history = new SlidesInkHistory();
		const buckets = new Map<number, InkStroke[]>();
		for (let i = 0; i <= SLIDES_HISTORY_LIMIT; i++) {
			const after = [stroke(String(i), i + 1)];
			history.record(`Draw ${i}`, [{ index: i, before: [], after }]);
			buckets.set(i, after);
		}
		for (let i = SLIDES_HISTORY_LIMIT; i > 0; i--) expect(history.undo(buckets)).toBe(`Draw ${i}`);
		expect(history.undo(buckets)).toBeNull();
		expect([...buckets.keys()]).toEqual([0]);
		history.redo(buckets);
		expect(history.undoLabel).not.toBeNull();
		expect(history.redoLabel).not.toBeNull();
		history.clear();
		expect(history.undoLabel).toBeNull();
		expect(history.redoLabel).toBeNull();
		expect(history.undo(buckets)).toBeNull();
		expect(history.redo(buckets)).toBeNull();
		expect([...buckets.keys()]).toEqual([0, 1]);
	});
});
