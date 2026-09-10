/**
 * THE JOIN, as an acceptance test.
 *
 * Two halves used to meet here and lose ink:
 *   - `InlineInkStore.reloadExternal` discards locally drawn strokes the disk
 *     copy does not have (it clears localStrokeIds before the merge), and
 *   - `PageStore.hasQueuedWrite` / `busy` were both FALSE while a write was in
 *     flight, because `writePending` drops the pending entry and clears the
 *     timers before awaiting.
 * So the poll adopted another device's copy, the local stroke vanished, and the
 * stalled write then landed carrying its PRE-reload snapshot - over the other
 * device's ink, with no conflict copy, because the reload had refreshed the
 * known mtime and the write-path guard no longer saw a reason to preserve
 * anything.
 *
 * The QUEUED case never had that problem: the poll refuses while a write is
 * queued, and the write's own conflict guard preserves the external revision.
 * This file runs the two cases through the SAME assertions - an in-flight write
 * must behave exactly as a queued one - using the REAL live-reload poll
 * extracted from main.ts by LiveReloadTestHarness, the REAL PageStore over a
 * fake adapter, and the REAL InlineInkStore wired to that store exactly the way
 * main.ts wires it (loadSidecar -> store.load, scheduleSidecar ->
 * store.schedule).
 *
 * Nothing here injects a state the product could not reach: the only things
 * faked are the disk (FakeAdapter, the house fixture) and the note-side page
 * id, which stands for a note whose frontmatter already carries one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	normalizePath: (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/"),
	Notice: class {},
}));

import { installLiveReloadPoll } from "./testUtils/LiveReloadTestHarness";
import { PageStore, contentStamp, type PreparedExternalAdoption } from "./persistence/PageStore";
import { FakeAdapter, gate } from "./persistence/FakeAdapter";
import { InlineInkStore } from "./inline/InlineInkStore";
import { PageData, emptyPage, serializePage } from "./model/PageData";
import { InkStroke } from "./ink/Stroke";

const DEBOUNCE_MS = 700;
const PATH = "note.md";
const PAGE_ID = "p1";

function stroke(id: string): InkStroke {
	return {
		id,
		tool: "pen",
		color: "#4b7bec",
		width: 2.2,
		points: [
			{ x: 0, y: 0, pressure: 0.5, t: 0 },
			{ x: 10, y: 0, pressure: 0.5, t: 8 },
		],
		bbox: { x: 0, y: 0, width: 10, height: 0 },
		createdAt: 0,
	} as InkStroke;
}

function pageWith(...ids: string[]): PageData {
	const p = emptyPage(PAGE_ID);
	p.surface = "inline";
	p.strokes = ids.map(stroke);
	return p;
}

let fake: FakeAdapter;
let store: PageStore;
let inlineInk: InlineInkStore;
let fireTick!: () => void;
let pending: Promise<void> = Promise.resolve();
let pollErrors: unknown[][] = [];
let conflicts: Array<[string, string]> = [];
/**
 * What was true AT the moment `onConflict` fired, not afterwards.
 *
 * The report is only honest if both files are already on disk when it is
 * made: the preserved external copy AND our own live sidecar. Asserting that
 * after the run would not distinguish "announced too early" from "announced
 * correctly", because by then both exist either way.
 */
let conflictAtCallback: Array<{ copyExact: boolean; liveExists: boolean }> = [];
let writeErrors: unknown[][] = [];
/** The page's live sidecar, captured before any conflict copy exists. */
let livePath!: string;

/** Another device replaces the sidecar behind our back. */
function otherDeviceWrites(...ids: string[]): void {
	fake.externalWrite(livePath, serializePage(pageWith(...ids)));
}

/**
 * The exact bytes the other device last wrote, for the preservation cases.
 *
 * A conflict copy is made by RENAMING the live file, so the bytes must come
 * back out untouched - not re-serialised, not normalised, not reordered. A
 * `toContain('"s3"')` check cannot tell those apart: it passes just as happily
 * on a copy that silently dropped the other device's unknown fields or
 * rewrote its whitespace. So the external revision below carries three things
 * a canonical `serializePage` would erase, and the assertion is equality of
 * the whole string rather than presence of a substring.
 */
let externalExact = "";

/**
 * An external revision with distinctive geometry, UNKNOWN NESTED METADATA and
 * NONCANONICAL WHITESPACE. Still valid JSON, so the codec can read it where a
 * case means it to; the point is that none of it survives a re-serialise.
 */
function otherDeviceWritesDistinctive(): void {
	externalExact =
		'{\n  "version": 1,\n    "pageId": "' +
		PAGE_ID +
		'",\n\t"surface":   "inline",\n  "futureField": { "writtenBy": "other-device", "nested": { "keep": [1, 2, 3], "why": "unknown to this version" } },\n  "strokes": [\n    {\n      "id": "s3",\n      "tool": "pen",\n      "color":  "#e84118",\n      "width": 3.7,\n      "points": [ { "x": 41.5, "y": 17.25, "pressure": 0.8125, "t": 3 }, { "x": 63.75, "y": 29.5, "pressure": 0.4375, "t": 91 } ],\n      "createdAt": 1234567,\n      "deviceNote": { "pen": "other", "tiltUnknown": true }\n    }\n  ]\n}\n';
	fake.externalWrite(livePath, externalExact);
}

/**
 * Session strokes as content, with the DERIVED bbox left out.
 *
 * `PageData` recomputes `bbox` from the points on every load rather than
 * trusting the file, so comparing it would fail an equality that is otherwise
 * exact - the same overstrict comparison the independent acceptance hit and
 * corrected. Everything a user would notice losing is here: identity, style,
 * and every point's position, pressure and time.
 */
function contentWithoutBBox(strokes: readonly InkStroke[]): string {
	return JSON.stringify(
		strokes.map((s) => ({
			id: s.id,
			tool: s.tool,
			color: s.color,
			width: s.width,
			createdAt: s.createdAt,
			points: s.points.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure, t: p.t })),
		}))
	);
}

function idsInSession(): string[] {
	return inlineInk.strokes(PATH).map((s) => s.id);
}

/** Every non-tmp file for this page that is not the live sidecar. */
function conflictCopies(): string[] {
	return [...fake.files.keys()].filter(
		(k) => k !== livePath && k.includes(PAGE_ID) && !k.endsWith(".tmp")
	);
}

beforeEach(async () => {
	vi.useFakeTimers();
	(globalThis as { window?: unknown }).window = globalThis;
	fake = new FakeAdapter();
	pollErrors = [];
	conflicts = [];
	conflictAtCallback = [];
	externalExact = "";
	writeErrors = [];
	store = new PageStore({ vault: { adapter: fake } } as never, ".handwriting", () => 5_000_000);
	store.onConflict = (pageId, keptAs) => {
		conflicts.push([pageId, keptAs]);
		conflictAtCallback.push({
			copyExact: fake.files.get(keptAs) === externalExact,
			liveExists: fake.files.has(livePath),
		});
	};
	store.onWriteError = (...args: unknown[]) => writeErrors.push(args);
	inlineInk = new InlineInkStore();
	inlineInk.attachHost({
		readPageId: (path: string) => (path === PATH ? PAGE_ID : null),
		claimId: async (_path: string, proposedId: string) => ({ pageId: proposedId }),
		loadSidecar: (pageId: string) => store.load(pageId),
		scheduleSidecar: (pageId: string, page: PageData) => store.schedule(pageId, page),
		scheduleSidecarNow: (pageId: string, page: PageData) => store.saveNow(pageId, page),
		prepareExternalAdoption: (pageId: string, outgoing: PageData) =>
			store.prepareExternalAdoption(pageId, outgoing),
		acceptExternalAdoption: (prepared: PreparedExternalAdoption) =>
			store.acceptExternalAdoption(prepared),
		notify: () => {},
	} as never);

	// The real poll, extracted from main.ts and executed.
	const host = {
		store,
		pdfInk: new Map(),
		pdfIds: new Map(),
		pollStats: { ticks: 0, hidden: 0, spaced: 0, checks: 0 },
		registerInterval(handle: number) {
			return handle;
		},
	};
	installLiveReloadPoll.call(
		host,
		{
			setInterval(fn: () => void) {
				fireTick = fn;
				return 1;
			},
		},
		{ hidden: false },
		(promise: Promise<void>) => {
			pending = promise.catch((e: unknown) => {
				pollErrors.push([e]);
			});
		},
		() => [PATH],
		inlineInk,
		() => {},
		() => {},
		() => null,
		async () => false,
		{ error: (...args: unknown[]) => pollErrors.push(args) }
	);

	// Seed: a sidecar already on disk, so the store knows its mtime, and the
	// session has loaded it.
	store.schedule(PAGE_ID, pageWith("s1"));
	await vi.runAllTimersAsync();
	livePath = [...fake.files.keys()].find(
		(k) => k.includes(PAGE_ID) && !k.endsWith(".tmp")
	)!;
	expect(livePath).toBeTruthy();
	await inlineInk.ensureLoaded(PATH);
	expect(idsInSession()).toEqual(["s1"]);
});

async function tick(): Promise<void> {
	fireTick();
	await pending;
	await vi.advanceTimersByTimeAsync(0);
}

type Stage = "queued" | "in flight";

/**
 * Draw a stroke and leave its write either QUEUED (the debounce has not fired)
 * or IN FLIGHT (the debounce fired and the write is stalled inside the
 * adapter). Either way the session holds ink the disk does not have. Returns
 * the release for the in-flight case; a no-op for the queued one.
 */
async function drawAndHoldWrite(stage: Stage): Promise<() => void> {
	inlineInk.commit(PATH, stroke("s2"));
	expect(idsInSession()).toEqual(["s1", "s2"]);
	expect(store.hasQueuedWrite(PAGE_ID)).toBe(true);
	if (stage === "queued") return () => {};

	const g = gate();
	fake.writeGate = g.promise;
	await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
	// The write really did leave the queue and reach the adapter.
	expect(fake.writeAttempts).toBeGreaterThan(1);
	return () => {
		fake.writeGate = null;
		g.release();
	};
}

describe("in-flight write + external sidecar + the real poll", () => {
	it.each<Stage>(["queued", "in flight"])(
		"%s: the write is visible to hasQueuedWrite and to busy",
		async (stage) => {
			const release = await drawAndHoldWrite(stage);
			expect(store.hasQueuedWrite(PAGE_ID)).toBe(true);
			expect(store.busy).toBe(true);
			release();
			await vi.runAllTimersAsync();
			expect(store.hasQueuedWrite(PAGE_ID)).toBe(false);
			expect(store.busy).toBe(false);
		}
	);

	it.each<Stage>(["queued", "in flight"])(
		"%s: the poll refuses, our stroke survives, and the external revision is preserved",
		async (stage) => {
			const release = await drawAndHoldWrite(stage);
			// What the session holds BEFORE the poll can touch it, so the
			// after-comparison is against a captured fact rather than against
			// the same object read twice.
			const localBefore = contentWithoutBBox(inlineInk.strokes(PATH));
			// The other device does not know about s2, and writes bytes a
			// re-serialise would not reproduce.
			otherDeviceWritesDistinctive();

			await tick();

			// The poll ran and declined to adopt: s2 is still here, and s3 -
			// which could only have arrived by adopting the other copy - is not.
			expect(pollErrors).toEqual([]);
			expect(idsInSession()).toEqual(["s1", "s2"]);

			// Now let our write land. Its own conflict guard is still intact,
			// because no reload refreshed the known mtime.
			release();
			await vi.runAllTimersAsync();

			// Our ink is on disk...
			const live = fake.files.get(livePath) ?? "";
			expect(live).toContain('"s2"');

			// ...and the other device's revision was RETAINED VERBATIM beside
			// it. EXACT BYTES, not a substring: the copy is made by renaming
			// the file, so anything less than equality would also pass on a
			// copy that dropped `futureField`, reordered `deviceNote` or
			// rewrote the whitespace - the silent normalisation that loses an
			// unknown field a future version put there.
			const copies = conflictCopies();
			expect(copies).toHaveLength(1);
			expect(fake.files.get(copies[0]!)).toBe(externalExact);
			// The same claim by content identity, using the store's own stamp.
			expect(contentStamp(fake.files.get(copies[0]!) ?? "")).toBe(contentStamp(externalExact));

			// ...and the user was told, once the write had actually landed -
			// with BOTH files already on disk at the moment of the report.
			expect(conflicts).toEqual([[PAGE_ID, copies[0]!]]);
			expect(conflictAtCallback).toEqual([{ copyExact: true, liveExists: true }]);
			expect(writeErrors).toEqual([]);
			expect(pollErrors).toEqual([]);

			// LOCAL FULL CONTENT: not just that s2's id survived, but that
			// every point, pressure, time and style value is what it was
			// before the poll ran. The derived bbox is excluded because the
			// codec recomputes it rather than trusting the file.
			expect(contentWithoutBBox(inlineInk.strokes(PATH))).toBe(localBefore);

			// REOPEN: and the same is true of what a cold read gets back, so
			// this is durability rather than a live in-memory artefact.
			const reopened = new PageStore(
				{ vault: { adapter: fake } } as never,
				".handwriting",
				() => 5_000_000
			);
			const back = await reopened.load(PAGE_ID);
			expect(back?.damaged ?? false).toBe(false);
			expect(contentWithoutBBox(back?.data.strokes ?? [])).toBe(localBefore);

			// The session still holds the stroke, so a selection holding it
			// still matches something. (Destructive: last assertion.)
			expect(inlineInk.applyRemove(PATH, ["s2"]).map((r) => r.stroke.id)).toEqual(["s2"]);
		}
	);

	it.each<Stage>(["queued", "in flight"])(
		"%s CALIBRATION: the same run adopts the copy once the write has landed",
		async (stage) => {
			const release = await drawAndHoldWrite(stage);
			release();
			await vi.runAllTimersAsync();
			expect(store.hasQueuedWrite(PAGE_ID)).toBe(false);

			// Nothing is owed now, so an external revision IS adopted: the
			// refusal above is the queue guard, not a poll that never reloads.
			otherDeviceWrites("s1", "s2", "s3");
			await tick();

			expect(pollErrors).toEqual([]);
			expect(idsInSession()).toContain("s3");
			expect(idsInSession()).toContain("s2");
		}
	);
});
