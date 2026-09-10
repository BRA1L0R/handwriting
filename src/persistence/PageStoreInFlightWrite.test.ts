/**
 * IN-FLIGHT WRITE COVERAGE.
 *
 * `writePending` consumes the batch - `pending.delete`, `pendingWriter.delete`,
 * `clearTimers` - SYNCHRONOUSLY, then awaits the chained `writeNow`. Both
 * observers (`busy`, `hasQueuedWrite`) read only those three maps, so for the
 * whole duration of the write they answered "nothing queued" while the ink
 * existed only in memory. `externallyChanged` asks `hasQueuedWrite` first, so
 * the live-reload poll was free to adopt another device's copy and discard the
 * local stroke; the stalled write then landed carrying its pre-reload snapshot,
 * over the other device's ink, with no conflict copy (see
 * LiveReloadInFlightWrite.test.ts for that end of it).
 *
 * The state tracked here is a per-page COUNT, not a boolean and not the `tails`
 * map: a clone's DESTINATION tail is retained after it has already settled, so
 * reusing tails would report busy forever for that page, and a boolean an
 * earlier attempt clears would uncover a second one still in flight.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/"),
}));

import { PageStore } from "./PageStore";
import { FakeAdapter, gate } from "./FakeAdapter";
import { PageData, emptyPage, serializePage } from "../model/PageData";

const DEBOUNCE_MS = 700;

function pageWithInk(id: string, ...strokeIds: string[]): PageData {
	const p = emptyPage(id);
	p.surface = "inline";
	p.strokes = (strokeIds.length ? strokeIds : ["s1"]).map((sid) => ({
		id: sid,
		tool: "pen",
		color: "#4b7bec",
		width: 2.2,
		points: [
			{ x: 0, y: 0, pressure: 0.5, t: 0 },
			{ x: 10, y: 0, pressure: 0.5, t: 8 },
		],
		bbox: { x: 0, y: 0, width: 10, height: 0 },
		createdAt: 0,
	})) as PageData["strokes"];
	return p;
}

let fake: FakeAdapter;
let store: PageStore;

/** Is the page's real (non-tmp) sidecar on disk yet? */
function onDisk(pageId: string): boolean {
	return livePaths(pageId).length > 0;
}

function livePaths(pageId: string): string[] {
	return [...fake.files.keys()].filter(
		(k) => k.includes(pageId) && !k.endsWith(".tmp") && !k.includes(".conflict-")
	);
}

/** Turn the microtask crank until `done`, bounded so a hang is a failure. */
async function until(done: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 100 && !done(); i++) await vi.advanceTimersByTimeAsync(0);
	if (!done()) throw new Error(`never reached: ${label}`);
}

beforeEach(() => {
	vi.useFakeTimers();
	(globalThis as { window?: unknown }).window = globalThis;
	fake = new FakeAdapter();
	store = new PageStore({ vault: { adapter: fake } } as never, ".handwriting", () => 5_000_000);
});

describe("CALIBRATION: the observers move at all", () => {
	it("are true while queued and false once the write has landed", async () => {
		store.schedule("p1", pageWithInk("p1"));
		expect(store.hasQueuedWrite("p1")).toBe(true);
		expect(store.busy).toBe(true);
		expect(onDisk("p1")).toBe(false);

		await vi.runAllTimersAsync();

		expect(store.hasQueuedWrite("p1")).toBe(false);
		expect(store.busy).toBe(false);
		expect(onDisk("p1")).toBe(true);
	});
});

describe("THE WINDOW: a write that has left the queue but not reached disk", () => {
	it("hasQueuedWrite and busy stay TRUE while the write is IN FLIGHT", async () => {
		store.schedule("p1", pageWithInk("p1"));
		expect(store.hasQueuedWrite("p1")).toBe(true);

		const g = gate();
		fake.writeGate = g.promise;

		// The debounce fires: writePending deletes the pending entry and clears
		// both timers BEFORE awaiting the write.
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
		expect(fake.writeAttempts).toBeGreaterThan(0);
		expect(onDisk("p1")).toBe(false);

		// The ink exists only in memory, so the page is NOT quiet.
		expect(store.hasQueuedWrite("p1")).toBe(true);
		expect(store.busy).toBe(true);

		fake.writeGate = null;
		g.release();
		await vi.runAllTimersAsync();

		expect(onDisk("p1")).toBe(true);
		expect(store.hasQueuedWrite("p1")).toBe(false);
		expect(store.busy).toBe(false);
	});

	it("externallyChanged refuses for the whole of that window", async () => {
		// A sidecar this session knows: written, so knownMtime/knownHash are set.
		store.schedule("p1", pageWithInk("p1"));
		await vi.runAllTimersAsync();
		const live = livePaths("p1")[0]!;
		expect(await store.externallyChanged("p1")).toBe(false);

		// A new batch, stalled inside the adapter.
		store.schedule("p1", pageWithInk("p1", "s1", "s2"));
		const g = gate();
		fake.writeGate = g.promise;
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
		expect(fake.writeAttempts).toBeGreaterThan(1);

		// Another device replaces the file underneath us.
		fake.externalWrite(live, serializePage(pageWithInk("p1", "s1", "s3")));

		// The poll must not be told to reload: our own unlanded write still
		// carries ink the copy on disk has never seen.
		expect(await store.externallyChanged("p1")).toBe(false);

		fake.writeGate = null;
		g.release();
		await vi.runAllTimersAsync();
	});
});

describe("the outstanding-write state itself", () => {
	it("CLEARS ON A FAILED WRITE: re-queued, never falsely idle, never blocked", async () => {
		store.schedule("p1", pageWithInk("p1"));
		fake.failWriteTimes = 1;

		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);

		// The failure re-queued the batch and armed the retry, so the page is
		// still not quiet - writeNow's catch does that before the attempt
		// settles, so there is no idle instant in between.
		expect(store.hasQueuedWrite("p1")).toBe(true);
		expect(store.busy).toBe(true);
		expect(onDisk("p1")).toBe(false);

		// And the in-flight state itself was released by the failed attempt:
		// dropping the re-queued batch leaves the store idle. If it were only
		// released on success, this page would be blocked forever.
		store.discardPending("p1");
		expect(store.hasQueuedWrite("p1")).toBe(false);
		expect(store.busy).toBe(false);
	});

	it("REJECTED -> RETRY -> IDLE: the retry lands and the store goes quiet", async () => {
		store.schedule("p1", pageWithInk("p1"));
		fake.failWriteTimes = 1;

		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
		expect(store.hasQueuedWrite("p1")).toBe(true);
		expect(onDisk("p1")).toBe(false);

		await vi.runAllTimersAsync();

		expect(onDisk("p1")).toBe(true);
		expect(store.hasQueuedWrite("p1")).toBe(false);
		expect(store.busy).toBe(false);
		// One failure, one retry: the attempt was not counted twice.
		expect(fake.writeAttempts).toBe(2);
	});

	it("TWO OUTSTANDING BATCHES: the first settling does not clear the second", async () => {
		store.schedule("p1", pageWithInk("p1", "s1"));
		const first = gate();
		fake.writeGate = first.promise;
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
		await until(() => fake.writeAttempts >= 1, "the first write reaches the adapter");

		// A second batch consumed while the first is still in flight. saveNow
		// takes it out of `pending` synchronously and chains it behind the
		// first, so from here two attempts are owed.
		const second = gate();
		const saved = store.saveNow("p1", pageWithInk("p1", "s1", "s2"));
		expect(store.hasQueuedWrite("p1")).toBe(true);

		// Let ONLY the first through.
		fake.writeGate = second.promise;
		first.release();
		await until(() => fake.writeAttempts >= 2, "the second write reaches the adapter");

		// The first has landed; the second has not. A boolean cleared by the
		// first would read idle here while s2 is still only in memory.
		expect(onDisk("p1")).toBe(true);
		expect(fake.files.get(livePaths("p1")[0]!)).not.toContain('"s2"');
		expect(store.hasQueuedWrite("p1")).toBe(true);
		expect(store.busy).toBe(true);

		fake.writeGate = null;
		second.release();
		await saved;
		await vi.runAllTimersAsync();

		expect(fake.files.get(livePaths("p1")[0]!)).toContain('"s2"');
		expect(store.hasQueuedWrite("p1")).toBe(false);
		expect(store.busy).toBe(false);
	});

	it("INDEPENDENT PAGES: one page's in-flight write does not gag another", async () => {
		store.schedule("p2", pageWithInk("p2"));
		await vi.runAllTimersAsync();
		const otherLive = livePaths("p2")[0]!;

		store.schedule("p1", pageWithInk("p1"));
		const g = gate();
		fake.writeGate = g.promise;
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
		await until(() => fake.writeAttempts >= 2, "p1's write reaches the adapter");

		// Another device edits p2 while p1's write is stalled.
		fake.externalWrite(otherLive, serializePage(pageWithInk("p2", "s1", "s9")));

		expect(store.hasQueuedWrite("p1")).toBe(true);
		expect(store.hasQueuedWrite("p2")).toBe(false);
		// p2's live reload keeps working: the guard is per page, not global.
		expect(await store.externallyChanged("p2")).toBe(true);

		fake.writeGate = null;
		g.release();
		await vi.runAllTimersAsync();
		expect(store.busy).toBe(false);
	});

	it("A SETTLED CLONE leaves the store idle (tails would not)", async () => {
		// The counterexample that rules out reusing `tails`: clone records its
		// chained promise under the DESTINATION id and never removes it, so a
		// tails-based observer reports the store busy and page p2 queued long
		// after the clone finished - suppressing global idle and p2's reload
		// for the rest of the session.
		store.schedule("p1", pageWithInk("p1"));
		await vi.runAllTimersAsync();
		expect(store.busy).toBe(false);

		expect(await store.clone("p1", "p2")).toBe("cloned");

		expect(store.busy).toBe(false);
		expect(store.hasQueuedWrite("p2")).toBe(false);
		expect(store.hasQueuedWrite("p1")).toBe(false);

		await vi.runAllTimersAsync();
		expect(store.busy).toBe(false);
		expect(store.hasQueuedWrite("p2")).toBe(false);
	});

	it("FLUSH settles everything it dispatched, including a stalled write", async () => {
		store.schedule("p1", pageWithInk("p1"));
		store.schedule("p2", pageWithInk("p2"));
		const g = gate();
		fake.writeGate = g.promise;
		const flushing = store.flush();
		await until(() => fake.writeAttempts >= 1, "flush reaches the adapter");
		expect(store.busy).toBe(true);

		fake.writeGate = null;
		g.release();
		await flushing;

		expect(store.busy).toBe(false);
		expect(onDisk("p1")).toBe(true);
		expect(onDisk("p2")).toBe(true);
	});
});
