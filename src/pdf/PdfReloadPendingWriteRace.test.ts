/**
 * THE OPEN HALF OF THE PDF RELOAD DEFECT, EXECUTED.
 *
 * STATUS, 2026-09-08 22:3x, AFTER THE ACCEPTED REPAIR (`366d030`) MERGED:
 * PRODUCTION NO LONGER REACHES THIS PATH ON THE PDF SURFACE. The repair added
 * `adoptExternal`, and `main.ts:1810` is now the ONLY production call on the
 * PDF store - `pdfStore.adoptExternal?.(id, ...)`. Nothing in non-test source
 * calls `PdfInkStore.reloadExternal` any more.
 *
 * EVERY ASSERTION BELOW IS UNCHANGED AND STILL GREEN. What changed is only
 * what it means: these cases now pin the BEHAVIOUR OF THE METHOD, not a live
 * user-reachable defect. They are kept deliberately - the method still exists,
 * still empties the record before re-reading, and would be a live hole again
 * the moment anything calls it. Do not read a green run here as evidence that
 * the production repair is missing; check the caller first, as this note does.
 *
 * ---- the original finding, which is what the assertions measure ----
 *
 * `reloadExternal` empties `rec.strokes` before re-reading, so the union that
 * exists to preserve session strokes ("the persisted set is merged underneath
 * them rather than replacing them") degenerates to disk-only, and the restore
 * runs on the FAILURE branch only. Three seats have now read that code and
 * agreed on the mechanism. What nobody had resolved is the part that decides
 * severity: WHETHER THE DROPPED STROKES HAD ALREADY REACHED DISK.
 *
 * They usually have not. `persist` calls `host.schedule`, and the real
 * `PageStore.schedule` is a DEBOUNCED, COALESCING queue:
 *
 *     this.pending.set(pageId, data);            // last payload wins
 *     if (existing !== undefined) clearTimeout(existing);   // timer RESTARTS
 *
 * So a scheduled write is not a write, the newest payload replaces the queued
 * one, and an actively drawing user pushes the flush further away with every
 * stroke. `reloadExternal` refuses while `loadInFlight` but NOT while a write
 * is pending, so the poll can land inside that window.
 *
 * WHY THE EXISTING TESTS COULD NOT SEE THIS. `PdfInkReload.test.ts` fakes the
 * host with `schedule: (_id, data) => void saved.push(data)` - an APPEND. It
 * keeps every payload ever scheduled, so an overwrite is invisible to it and a
 * lost stroke still appears somewhere in `saved`. The fake models a log; the
 * real thing is a map. This harness models the map.
 */
import { describe, expect, it } from "vitest";
import { PdfInkStore, type PdfInkHost } from "./PdfInkStore";
import { emptyPage, type PageData, type ParseResult } from "../model/PageData";
import { computeBBox, type InkStroke } from "../ink/Stroke";

const ID = "pdf-1";

// Same shape as PdfInkReload.test.ts's fixture, including the bbox that
// `inkFingerprint` reads - a stroke without one is not a stroke this store
// can handle, and inventing a thinner fixture only fakes a different bug.
function stroke(id: string, page = 1, x = 10): InkStroke {
	const points = [
		{ x, y: 10, pressure: 0.5, t: 0 },
		{ x: x + 10, y: 20, pressure: 0.5, t: 8 },
	];
	return {
		id,
		tool: "pen",
		color: "#4b7bec",
		width: 2,
		points,
		bbox: computeBBox(points, 4),
		createdAt: 0,
		page,
	};
}

/**
 * A host whose `schedule` behaves like `PageStore.schedule`: coalescing by
 * page id, and nothing reaches disk until `flush()` runs the timer.
 */
function harness(diskStrokes: InkStroke[]) {
	const disk = { strokes: [...diskStrokes] };
	let pending: PageData | null = null;
	let scheduleCalls = 0;

	const host: PdfInkHost = {
		load: (id) =>
			Promise.resolve<ParseResult>({
				data: { ...emptyPage(id), surface: "pdf", strokes: [...disk.strokes] },
				recovered: false,
			}),
		// THE REAL SEMANTICS: a map write, not a log append.
		schedule: (_id, data) => {
			scheduleCalls++;
			pending = data;
		},
		notice: () => {},
	};

	const store = new PdfInkStore();
	store.attachHost(host);
	return {
		store,
		disk,
		/** The debounce firing. Only now does anything reach disk. */
		flush(): void {
			if (pending) disk.strokes = [...pending.strokes];
			pending = null;
		},
		pendingIds: (): string[] => (pending ? pending.strokes.map((s) => s.id) : []),
		scheduleCalls: (): number => scheduleCalls,
	};
}

describe("a poll-driven reload that lands while a write is still queued", () => {
	it("CALIBRATION: a commit only QUEUES a write; disk is untouched until the debounce fires", async () => {
		const h = harness([stroke("a")]);
		await h.store.ensureLoaded(ID);
		h.store.commit(ID, stroke("b"));

		// The window this whole file is about must actually exist.
		expect(h.scheduleCalls(), "commit did not schedule a write at all").toBeGreaterThan(0);
		expect(h.pendingIds(), "the queued payload should carry the new stroke").toEqual(["a", "b"]);
		expect(h.disk.strokes.map((s) => s.id), "disk must NOT have it yet").toEqual(["a"]);
	});

	it("DROPS the unflushed stroke from the session on a SUCCESSFUL reload", async () => {
		const h = harness([stroke("a")]);
		await h.store.ensureLoaded(ID);
		h.store.commit(ID, stroke("b")); // queued, not written

		// Another device touches the file; the poll fires inside the window.
		const changed = await h.store.reloadExternal(ID);

		expect(changed, "the reload reported no change, so this case did not run").toBe(true);
		// This is the defect, stated as the user meets it: b is on screen, then it is not.
		expect(h.store.strokes(ID).map((s) => s.id)).toEqual(["a"]);
	});

	it("but the QUEUED payload still carries it, so a clean flush RECOVERS it", async () => {
		const h = harness([stroke("a")]);
		await h.store.ensureLoaded(ID);
		h.store.commit(ID, stroke("b"));
		await h.store.reloadExternal(ID);

		// `persist` spreads rec.strokes into a NEW object at call time, so the
		// queued payload is a by-value snapshot taken BEFORE the clear.
		expect(h.pendingIds()).toEqual(["a", "b"]);
		h.flush();
		expect(h.disk.strokes.map((s) => s.id), "a clean flush should preserve it").toEqual(["a", "b"]);
	});

	it("THE LOSS: one more persist after the reload REPLACES the queue and b is gone from memory AND disk", async () => {
		const h = harness([stroke("a")]);
		await h.store.ensureLoaded(ID);
		h.store.commit(ID, stroke("b"));
		await h.store.reloadExternal(ID); // b dropped from the record

		// Anything that persists again now - another stroke, an erase, a
		// lasso, pen-up - schedules from the EMPTIED record and, because the
		// queue coalesces by page id, replaces the payload that still held b.
		h.store.save(ID);

		expect(h.pendingIds(), "the queue no longer carries b").toEqual(["a"]);
		h.flush();
		expect(h.disk.strokes.map((s) => s.id)).toEqual(["a"]);
		expect(h.store.strokes(ID).map((s) => s.id)).toEqual(["a"]);
		// b existed, was acknowledged by the store, and is now in neither place.
	});

	it("CONTROL: with no pending write, a reload loses nothing", async () => {
		const h = harness([stroke("a")]);
		await h.store.ensureLoaded(ID);
		h.store.commit(ID, stroke("b"));
		h.flush(); // the ordinary case: the write landed before the poll

		await h.store.reloadExternal(ID);
		expect(h.store.strokes(ID).map((s) => s.id)).toEqual(["a", "b"]);
		expect(h.disk.strokes.map((s) => s.id)).toEqual(["a", "b"]);
	});
});
