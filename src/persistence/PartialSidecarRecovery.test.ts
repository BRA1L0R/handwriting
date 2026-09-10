import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageStore } from "./PageStore";
import { FakeAdapter } from "./FakeAdapter";
import { InlineInkStore } from "../inline/InlineInkStore";
import { PdfInkStore } from "../pdf/PdfInkStore";
import { packPointsV2, parsePage } from "../model/PageData";
import type { InkPoint, InkStroke } from "../ink/Stroke";

/**
 * A sidecar can be syntactically perfect JSON and still be only PARTLY
 * decodable: a stroke whose id is missing or unusable, or one whose point
 * payload is nonempty but whose samples do not survive validation. The
 * migration drops exactly those and returns the rest, and `parsePage` used to
 * call that an ordinary, undamaged load.
 *
 * That verdict is what destroys ink. `PageStore.load` records an undamaged
 * input as the known hash/revision, so the next save sees no external change,
 * makes no conflict copy, and writes the FILTERED model over the file - the
 * only copy of the strokes that failed to decode. Both stores block writes on
 * `damaged`, so reporting the loss is what keeps the original bytes on disk.
 *
 * These tests fix that boundary: a lossy decode is damage, the decoded remnant
 * still travels in `ParseResult.data`, and nothing that merely normalises
 * (defaults, unknown fields, empty pages, future schemas) is called damage.
 * Displaying the decoded subset on cold open is deliberately NOT asserted -
 * it is outside this slice's boundary.
 */

const PAGE_ID = "partial-sidecar-page";
const PATH = `.handwriting/${PAGE_ID}.json`;

const P1: InkPoint = { x: 10, y: 20, pressure: 0.5, t: 0 };
const P2: InkPoint = { x: 30, y: 40, pressure: 0.5, t: 8 };
const P3: InkPoint = { x: 50, y: 60, pressure: 0.5, t: 16 };

type Raw = Record<string, unknown>;

/** v1 packed, both samples readable. */
const V1_OK: Raw = { pts: [10, 20, 0.5, 0, 30, 40, 0.5, 8] };
/** v1 packed, second tuple's x is not a number: one sample of two survives. */
const V1_PARTIAL: Raw = { pts: [10, 20, 0.5, 0, "30", 40, 0.5, 8] };
/** v1 packed, trailing tuple is incomplete: the loop never reads those values. */
const V1_RAGGED: Raw = { pts: [10, 20, 0.5, 0, 30, 40] };
/** v1 packed, nonempty, and no tuple survives. */
const V1_WHOLE: Raw = { pts: ["10", "20", 0.5, 0, "30", "40", 0.5, 8] };

const V2_OK: Raw = { ptsd: packPointsV2([P1, P2]) };
const V2_PARTIAL: Raw = { ptsd: corruptedDelta() };
const V2_WHOLE: Raw = { ptsd: ["a", "b", "c", "d"] };

/** The oldest shape: an array of point objects. */
const LEGACY_OK: Raw = { points: [P1, P2] };
const LEGACY_PARTIAL: Raw = { points: [P1, { x: "30", y: 40, pressure: 0.5, t: 8 }] };
/** Nonempty, and every coordinate is outside MAX_COORD. */
const LEGACY_WHOLE: Raw = { points: [{ x: 1e8, y: 1e8, pressure: 0.5, t: 0 }] };

/**
 * Three v2 samples with the second quadruple's dx replaced by a string. The
 * bounds suite pins the decoder's behaviour here: the bad quadruple costs its
 * own sample and nothing further, so TWO of three survive - which is what
 * makes this a partial loss rather than a dropped stroke.
 */
function corruptedDelta(): unknown[] {
	const flat: unknown[] = packPointsV2([P1, P2, P3]);
	flat[4] = "junk";
	return flat;
}

/** `id: null` writes a stroke with NO id field at all - the reported defect. */
function rawStroke(id: string | null, payload: Raw, pdf: boolean): Raw {
	return {
		...(id === null ? {} : { id }),
		tool: "pen",
		color: "#4b7bec",
		width: 2,
		createdAt: 1,
		...(pdf ? { page: 1 } : {}),
		...payload,
	};
}

function sidecar(
	surface: "inline" | "pdf",
	strokes: Raw[],
	version = 1,
	extra: Raw = {}
): string {
	return JSON.stringify({
		schemaVersion: version,
		pageId: PAGE_ID,
		surface,
		textBoxes: [],
		images: [],
		strokes,
		...extra,
	});
}

/**
 * The fixture the whole slice turns on: one stroke that decodes (`kept`) beside
 * one that does not (`recoverable`), in whichever shape and failure mode the
 * case is about.
 */
function keptPlus(
	surface: "inline" | "pdf",
	payload: Raw,
	// `id` is only defaulted when the option is absent, never when it is null:
	// `undefined` would take the default back and quietly build a VALID file.
	{ id = "recoverable", version = 1 }: { id?: string | null; version?: number } = {}
): string {
	const pdf = surface === "pdf";
	const ok = version >= 2 ? V2_OK : V1_OK;
	return sidecar(
		surface,
		[rawStroke("kept", ok, pdf), rawStroke(id, payload, pdf)],
		version
	);
}

function committed(id: string, pdf: boolean): InkStroke {
	return {
		id,
		tool: "pen",
		color: "#4b7bec",
		width: 2,
		createdAt: 1,
		points: [P1, P2],
		bbox: { x: 6, y: 16, width: 28, height: 28 },
		...(pdf ? { page: 1 } : {}),
	};
}

interface Observation {
	damaged: boolean;
	problem: string | undefined;
	/** What the parse handed back - the readable remnant, not what got drawn. */
	decodedIds: string[] | undefined;
	notices: string[];
	/** Every path still holding the exact bytes that were on disk at open. */
	retainedCopies: string[];
	originalUnchanged: boolean;
	writeAttempts: number;
	reopenedIds: string[] | undefined;
	files: string[];
}

/**
 * Open `original` through a real PageStore and the surface's real ink store,
 * draw one ordinary stroke, flush, and reopen through a FRESH store - the same
 * sequence a user performs without knowing the file is malformed.
 */
async function driveStores(
	surface: "inline" | "pdf",
	original: string
): Promise<Observation> {
	const adapter = new FakeAdapter();
	const disk = new PageStore({ vault: { adapter } });
	const notices: string[] = [];
	adapter.externalWrite(PATH, original);

	const parsed = await disk.load(PAGE_ID);
	if (surface === "inline") {
		const ink = new InlineInkStore();
		ink.attachHost({
			readPageId: () => PAGE_ID,
			claimId: async (_p, pageId) => ({ pageId }),
			loadSidecar: (pageId) => disk.load(pageId),
			scheduleSidecar: (pageId, data) => disk.schedule(pageId, data),
			notify: (message) => notices.push(message),
		});
		await ink.ensureLoaded("note.md");
		ink.commit("note.md", committed("new", false));
		await ink.settle();
	} else {
		const ink = new PdfInkStore();
		ink.attachHost({
			load: (pageId) => disk.load(pageId),
			schedule: (pageId, data) => disk.schedule(pageId, data),
			notice: (message) => notices.push(message),
		});
		await ink.ensureLoaded(PAGE_ID);
		ink.commit(PAGE_ID, committed("new", true));
	}
	await disk.flush();

	const reopened = await new PageStore({ vault: { adapter } }).load(PAGE_ID);
	return {
		damaged: !!parsed?.damaged,
		problem: parsed?.problem,
		decodedIds: parsed?.data.strokes.map((s) => s.id),
		notices,
		retainedCopies: [...adapter.files].filter(([, t]) => t === original).map(([p]) => p),
		originalUnchanged: adapter.files.get(PATH) === original,
		writeAttempts: adapter.writeAttempts,
		reopenedIds: reopened?.data.strokes.map((s) => s.id),
		files: [...adapter.files.keys()],
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("window", globalThis);
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("a partly decodable sidecar keeps its source bytes", () => {
	const surfaces = ["inline", "pdf"] as const;

	// The reported defect, verbatim: a valid sidecar, one stroke missing its
	// id, one ordinary new stroke drawn on top. The original bytes are the
	// only copy of `recoverable` anywhere.
	it.each(surfaces)(
		"%s: a stroke with no id must not cost the file its source bytes",
		async (surface) => {
			const got = await driveStores(surface, keptPlus(surface, V1_OK, { id: null }));
			expect(
				got.retainedCopies.length,
				"original partial sidecar retained live or as recovery copy"
			).toBeGreaterThan(0);
			expect(got.originalUnchanged).toBe(true);
			expect(got.damaged).toBe(true);
			expect(got.notices.length).toBeGreaterThan(0);
			// No ordinary scheduled replacement: the lock is what holds the file.
			expect(got.writeAttempts).toBe(0);
			// The readable half still travels in the parse result.
			expect(got.decodedIds).toEqual(["kept"]);
		}
	);

	// Same harm, and a stroke-count comparison cannot see it: two strokes go
	// in, two come out, one of them shorter than the file says.
	it.each(surfaces)(
		"%s: a stroke that loses only some of its samples is the same loss",
		async (surface) => {
			const got = await driveStores(surface, keptPlus(surface, V1_RAGGED));
			expect(
				got.retainedCopies.length,
				"original partial sidecar retained live or as recovery copy"
			).toBeGreaterThan(0);
			expect(got.originalUnchanged).toBe(true);
			expect(got.damaged).toBe(true);
			expect(got.notices.length).toBeGreaterThan(0);
			expect(got.writeAttempts).toBe(0);
			expect(got.decodedIds).toEqual(["kept", "recoverable"]);
		}
	);

	it.each(surfaces)("%s control: a valid file still saves and reopens whole", async (surface) => {
		const got = await driveStores(surface, keptPlus(surface, V1_OK));
		expect(got.damaged).toBe(false);
		expect(got.originalUnchanged).toBe(false);
		expect(got.reopenedIds).toEqual(["kept", "recoverable", "new"]);
		expect(got.notices).toEqual([]);
	});

	it.each(surfaces)("%s control: an empty valid page is still writable", async (surface) => {
		const got = await driveStores(surface, sidecar(surface, []));
		expect(got.damaged).toBe(false);
		expect(got.reopenedIds).toEqual(["new"]);
		expect(got.notices).toEqual([]);
	});

	it.each(surfaces)("%s control: syntax damage stays locked, bytes intact", async (surface) => {
		const got = await driveStores(surface, '{"strokes":[');
		expect(got.damaged).toBe(true);
		expect(got.originalUnchanged).toBe(true);
		expect(got.notices.length).toBeGreaterThan(0);
	});

	it.each(surfaces)("%s control: a future schema stays locked, bytes intact", async (surface) => {
		const got = await driveStores(surface, keptPlus(surface, V1_OK, { version: 999 }));
		expect(got.originalUnchanged).toBe(true);
		expect(got.notices.length).toBeGreaterThan(0);
	});
});

describe("every lossy decode shape is reported, in every point format", () => {
	// Each case keeps one fully readable sibling, so a verdict that merely
	// noticed "no strokes decoded" could not pass any of them.
	const lossy: [string, Raw, string[]][] = [
		["v1 packed, one sample of two rejected", V1_PARTIAL, ["kept", "recoverable"]],
		["v1 packed, an incomplete trailing tuple", V1_RAGGED, ["kept", "recoverable"]],
		["v1 packed, nonempty and wholly unreadable", V1_WHOLE, ["kept"]],
		["v2 deltas, one quadruple of three corrupt", V2_PARTIAL, ["kept", "recoverable"]],
		["v2 deltas, nonempty and wholly unreadable", V2_WHOLE, ["kept"]],
		["legacy objects, one point of two rejected", LEGACY_PARTIAL, ["kept", "recoverable"]],
		["legacy objects, nonempty and wholly out of range", LEGACY_WHOLE, ["kept"]],
	];

	it.each(lossy)("%s is damage, and the readable sibling survives", (_name, payload, ids) => {
		const version = "ptsd" in payload ? 2 : 1;
		const r = parsePage(keptPlus("inline", payload, { version }), PAGE_ID);
		expect(r.damaged).toBe(true);
		expect(r.problem).toBeTruthy();
		expect(r.data.strokes.map((s) => s.id)).toEqual(ids);
	});

	it("a missing stroke id is damage", () => {
		const r = parsePage(keptPlus("inline", V1_OK, { id: null }), PAGE_ID);
		expect(r.damaged).toBe(true);
		expect(r.data.strokes.map((s) => s.id)).toEqual(["kept"]);
	});

	it("an unusable stroke id is damage", () => {
		const r = parsePage(keptPlus("inline", V1_OK, { id: "../escape" }), PAGE_ID);
		expect(r.damaged).toBe(true);
		expect(r.data.strokes.map((s) => s.id)).toEqual(["kept"]);
	});

	it("a partial loss keeps the samples that did decode", () => {
		const r = parsePage(keptPlus("inline", V1_PARTIAL), PAGE_ID);
		expect(r.data.strokes[1]!.points.map((p) => p.x)).toEqual([10]);
	});

	it("the diagnostic carries no ink coordinates", () => {
		const r = parsePage(keptPlus("inline", V1_PARTIAL), PAGE_ID);
		expect(r.problem).not.toMatch(/\d{2,}/);
	});
});

describe("normalisation is not damage", () => {
	it.each([
		["v1 packed", V1_OK, 1],
		["v2 deltas", V2_OK, 2],
		["legacy objects", LEGACY_OK, 1],
	] as [string, Raw, number][])("%s: a fully readable file is clean", (_n, payload, version) => {
		const r = parsePage(keptPlus("inline", payload, { version }), PAGE_ID);
		expect(r.damaged).toBeFalsy();
		expect(r.recovered).toBe(false);
		expect(r.data.strokes.map((s) => s.id)).toEqual(["kept", "recoverable"]);
	});

	it("absent optional pressure/time fields keep their harmless defaults", () => {
		const json = sidecar("inline", [
			{ id: "sparse", points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] },
		]);
		const r = parsePage(json, PAGE_ID);
		expect(r.damaged).toBeFalsy();
		expect(r.data.strokes[0]!.points).toEqual([
			{ x: 10, y: 20, pressure: 0.5, t: 0 },
			{ x: 30, y: 40, pressure: 0.5, t: 0 },
		]);
	});

	it("absent optional style fields keep their harmless defaults", () => {
		const json = sidecar("inline", [{ id: "bare", ...LEGACY_OK }]);
		const r = parsePage(json, PAGE_ID);
		expect(r.damaged).toBeFalsy();
		expect(r.data.strokes[0]!.tool).toBe("pen");
		expect(r.data.strokes[0]!.width).toBe(2.2);
		expect(r.data.strokes[0]!.color).toBe("#4b7bec");
	});

	// An out-of-range WIDTH already falls back to the default rather than
	// dropping anything, so it is normalisation and must stay clean.
	it("an absurd stroke width is normalised, not damaged", () => {
		const json = sidecar("inline", [{ id: "wide", width: 1e9, ...LEGACY_OK }]);
		const r = parsePage(json, PAGE_ID);
		expect(r.damaged).toBeFalsy();
		expect(r.data.strokes[0]!.width).toBe(2.2);
	});

	it("unknown top-level and per-object fields round-trip without a damage verdict", () => {
		const json = sidecar(
			"inline",
			[{ id: "kept", ...V1_OK, futureField: { nested: true } }],
			1,
			{ futureTop: "keep me" }
		);
		const r = parsePage(json, PAGE_ID);
		expect(r.damaged).toBeFalsy();
		expect(r.data.unknownTop.futureTop).toBe("keep me");
		expect(r.data.unknownByObject["kept"]).toEqual({ futureField: { nested: true } });
	});

	it("an empty page and an empty stroke list are clean", () => {
		expect(parsePage(sidecar("inline", []), PAGE_ID).damaged).toBeFalsy();
		// An empty point array is a stroke with nothing in it: there is no
		// sample to lose, so it is outside the loss this slice reports.
		expect(parsePage(sidecar("inline", [{ id: "s", pts: [] }]), PAGE_ID).damaged).toBeFalsy();
	});

	it("a future schema keeps its own refusal semantics rather than becoming damage", () => {
		const r = parsePage(keptPlus("inline", V1_WHOLE, { version: 999 }), PAGE_ID);
		expect(r.futureVersion).toBe(999);
		expect(r.damaged).toBeFalsy();
	});

	it("a syntax error is still damage with a placeholder page", () => {
		const r = parsePage('{"strokes":[', PAGE_ID);
		expect(r.damaged).toBe(true);
		expect(r.recovered).toBe(true);
		expect(r.data.strokes).toEqual([]);
	});
});

describe("existing recovery paths still behave", () => {
	it("a complete .tmp is promoted over a lossy live file, which is kept", async () => {
		const adapter = new FakeAdapter();
		const lossy = keptPlus("inline", V1_OK, { id: null });
		adapter.externalWrite(PATH, lossy);
		adapter.externalWrite(`${PATH}.tmp`, keptPlus("inline", V1_OK));

		const result = await new PageStore({ vault: { adapter } }).load(PAGE_ID);
		expect(result?.damaged).toBeFalsy();
		expect(result?.data.strokes.map((s) => s.id)).toEqual(["kept", "recoverable"]);
		// The generation that could not be fully decoded is kept beside it.
		expect([...adapter.files.values()]).toContain(lossy);
		expect(result?.damagedKeptAs).toBeTruthy();
	});

	it("repairing the file lifts the inline lock through the existing reopen", async () => {
		const adapter = new FakeAdapter();
		const disk = new PageStore({ vault: { adapter } });
		const notices: string[] = [];
		adapter.externalWrite(PATH, keptPlus("inline", V1_OK, { id: null }));

		const ink = new InlineInkStore();
		ink.attachHost({
			readPageId: () => PAGE_ID,
			claimId: async (_p, pageId) => ({ pageId }),
			loadSidecar: (pageId) => disk.load(pageId),
			scheduleSidecar: (pageId, data) => disk.schedule(pageId, data),
			notify: (message) => notices.push(message),
		});
		await ink.ensureLoaded("note.md");
		expect(ink.isDamagedLocked("note.md")).toBe(true);

		// Repaired by hand, or arriving from a sync copy. No invented id, no
		// automatic repair: the file itself became valid.
		adapter.externalWrite(PATH, keptPlus("inline", V1_OK));
		await ink.ensureLoaded("note.md");
		expect(ink.isDamagedLocked("note.md")).toBe(false);
		expect(parsePage(adapter.files.get(PATH)!, PAGE_ID).damaged).toBeFalsy();
	});
});

/**
 * The same boundary, one content type over.
 *
 * `090916e` taught `parsePage` to call a partly decodable sidecar damage so the
 * next save cannot write the remnant over the only copy - and it did that for
 * STROKES ONLY. A text box or an image that fails the identical checks is
 * dropped just as silently, `wasLossy` cannot see it, and the file is then
 * overwritten by the first ordinary save.
 *
 * Each loop has TWO exits - an entry that is not an object, and an entry whose
 * id or coordinate is rejected - so each type is tested at both. Covering one
 * exit per type would leave half the hole open, which is how this slice's own
 * predecessor came to be incomplete.
 *
 * Every case keeps a valid sibling of its own type AND a readable stroke, so a
 * verdict that merely noticed "nothing decoded" cannot pass any of them.
 */
describe("box and image decode loss is damage too", () => {
	/** A text box whose id, x and y are all usable. */
	const BOX_OK: Raw = { id: "box-kept", x: 10, y: 20, width: 320, z: 0 };
	/** An image whose id, x and y are all usable. */
	const IMAGE_OK: Raw = { id: "img-kept", x: 10, y: 20, width: 320, height: 240, z: 0 };

	function withEntries(
		key: "textBoxes" | "images",
		entries: unknown[],
		surface: "inline" | "pdf" = "inline"
	): string {
		return sidecar(surface, [rawStroke("kept", V1_OK, surface === "pdf")], 1, {
			[key]: entries,
		});
	}

	// `null` is the non-object exit. The other two are the id/coordinate exit,
	// which one `continue` serves for both causes: `../escape` fails
	// isSafePageId, and 1e8 is outside MAX_COORD so `coord()` rejects it
	// exactly as it rejects a non-number.
	const dropped: [string, "textBoxes" | "images", unknown][] = [
		["a text box that is not an object", "textBoxes", null],
		["a text box with an unusable id", "textBoxes", { id: "../escape", x: 10, y: 20 }],
		["a text box with an out-of-range coordinate", "textBoxes", { id: "box-bad", x: 1e8, y: 20 }],
		["an image that is not an object", "images", null],
		["an image with an unusable id", "images", { id: "../escape", x: 10, y: 20 }],
		["an image with an unreadable coordinate", "images", { id: "img-bad", x: "10", y: 20 }],
	];

	it.each(dropped)("%s is damage, and the valid sibling survives", (_name, key, bad) => {
		const ok = key === "textBoxes" ? BOX_OK : IMAGE_OK;
		const keptId = key === "textBoxes" ? "box-kept" : "img-kept";
		const r = parsePage(withEntries(key, [ok, bad]), PAGE_ID);
		expect(r.damaged).toBe(true);
		expect(r.problem).toBeTruthy();
		const survivors = key === "textBoxes" ? r.data.textBoxes : r.data.images;
		expect(survivors.map((e) => e.id)).toEqual([keptId]);
		// The readable stroke still travels: this is the loss of one entry,
		// not a page-wide refusal.
		expect(r.data.strokes.map((s) => s.id)).toEqual(["kept"]);
	});

	it("the box and image diagnostic carries no ink coordinates", () => {
		const r = parsePage(
			sidecar("inline", [rawStroke("kept", V1_OK, false)], 1, {
				textBoxes: [BOX_OK, { id: "box-bad", x: 1e8, y: 20 }],
				images: [IMAGE_OK, null],
			}),
			PAGE_ID
		);
		expect(r.problem).not.toMatch(/\d{2,}/);
	});

	// The control that stops an over-eager counter marking every file damaged.
	// Callers fail closed on `damaged`, so a false positive here makes all ink
	// invisible - a worse outcome than the hole it would be fixing.
	it("a page whose boxes and images all decode is not damage", () => {
		const r = parsePage(
			sidecar("inline", [rawStroke("kept", V1_OK, false)], 1, {
				textBoxes: [BOX_OK],
				images: [IMAGE_OK],
			}),
			PAGE_ID
		);
		expect(r.damaged).toBeUndefined();
		expect(r.data.textBoxes.map((b) => b.id)).toEqual(["box-kept"]);
		expect(r.data.images.map((im) => im.id)).toEqual(["img-kept"]);
	});

	// An ABSENT array is not loss: it means "this page has none", which is what
	// every sidecar written before these fields existed looks like. Counting it
	// would mark ordinary old files damaged.
	it("a sidecar carrying no box or image arrays at all is not damage", () => {
		const r = parsePage(
			JSON.stringify({ schemaVersion: 1, pageId: PAGE_ID, surface: "inline", strokes: [] }),
			PAGE_ID
		);
		expect(r.damaged).toBeUndefined();
	});

	// The flag is a means; not overwriting the file is the promise. Driven
	// through the real stores, exactly as the stroke cases above are.
	it.each(["inline", "pdf"] as const)(
		"%s: a partly undecodable image must not cost the file its source bytes",
		async (surface) => {
			const got = await driveStores(surface, withEntries("images", [IMAGE_OK, null], surface));
			expect(got.damaged).toBe(true);
			expect(got.originalUnchanged).toBe(true);
			expect(got.writeAttempts).toBe(0);
			expect(got.notices.length).toBeGreaterThan(0);
			expect(got.decodedIds).toEqual(["kept"]);
		}
	);

	it.each(["inline", "pdf"] as const)(
		"%s: a partly undecodable text box must not cost the file its source bytes",
		async (surface) => {
			const got = await driveStores(
				surface,
				withEntries("textBoxes", [BOX_OK, { id: "../escape", x: 10, y: 20 }], surface)
			);
			expect(got.damaged).toBe(true);
			expect(got.originalUnchanged).toBe(true);
			expect(got.writeAttempts).toBe(0);
		}
	);
});

/**
 * A COLLECTION THE FILE HAS AND WE CANNOT READ.
 *
 * The three content loops are each guarded by `Array.isArray`. When that
 * fails the loop never runs, so no counter inside it can fire - `wasLossy`
 * is false, the verdict is undamaged, `PageStore.load` records it as the
 * page's known revision, and the next ordinary save writes an EMPTY array
 * over a file that said it had content. It is the same harm the per-entry
 * counters were added to stop, one level up, and no per-entry counter can
 * ever see it.
 *
 * THE DISTINCTION IS THE WHOLE POINT, and the two halves are
 * indistinguishable to `Array.isArray`:
 *
 * - ABSENT means "this page has none". Every sidecar written before these
 *   fields existed looks exactly like that, and calling it damage would
 *   mark ordinary old files unwritable. NOT damage, and pinned as such.
 * - PRESENT AND NOT AN ARRAY means the file claims a collection we cannot
 *   read. Damage, and the next save must refuse rather than overwrite.
 *
 * `null` is deliberately on the damage side. `serializePage` writes these
 * three unconditionally as real arrays and JSON.stringify drops an
 * `undefined` value entirely, so a null here was written by something that
 * is not us, and "explicitly nothing" cannot be told apart from "unreadable".
 * Failing closed costs a foreign writer a notice and a read-only page, which
 * is recoverable; failing open costs the user their ink, which is not.
 *
 * This stays a FOREIGN-WRITER class. The plugin cannot produce any of these
 * shapes: the three fields are non-optional in `PageData`, `serializePage`
 * builds each with `.map()` - which throws rather than emitting a non-array -
 * and that throw is caught before any write.
 */
describe("a collection the file HAS but cannot be read is damage", () => {
	const keys = ["strokes", "textBoxes", "images"] as const;

	// Four distinct shapes, because they are not one case. The array-like
	// object matters most: it has content and a length, so a check laxer
	// than `Array.isArray` would wave it through and lose the entries anyway.
	const unreadable: [string, unknown][] = [
		["null", null],
		["a plain object", {}],
		["an array-like object with content", { 0: { id: "a", x: 1, y: 2 }, length: 1 }],
		["a string", "[]"],
	];

	for (const key of keys) {
		it.each(unreadable)(`${key} as %s is damage`, (_shape, value) => {
			const r = parsePage(sidecar("inline", [], 1, { [key]: value }), PAGE_ID);
			expect(r.damaged).toBe(true);
			expect(r.problem).toBeTruthy();
		});
	}

	it.each(keys)("%s ABSENT is not damage - that is an ordinary older sidecar", (key) => {
		const raw = JSON.parse(sidecar("inline", [])) as Record<string, unknown>;
		delete raw[key];
		const r = parsePage(JSON.stringify(raw), PAGE_ID);
		expect(r.damaged).toBeUndefined();
	});

	it("the diagnostic still carries no ink coordinates", () => {
		const r = parsePage(sidecar("inline", [], 1, { strokes: {}, images: null }), PAGE_ID);
		expect(r.problem).not.toMatch(/\d{2,}/);
	});

	// The promise is not the flag, it is the file. A page whose strokes key
	// is unreadable must come back out of the stores with its bytes intact.
	it.each(["inline", "pdf"] as const)(
		"%s: a sidecar whose strokes key is not a list must not be overwritten",
		async (surface) => {
			const got = await driveStores(surface, sidecar(surface, [], 1, { strokes: {} }));
			expect(got.damaged).toBe(true);
			expect(got.originalUnchanged).toBe(true);
			expect(got.writeAttempts).toBe(0);
			expect(got.notices.length).toBeGreaterThan(0);
		}
	);

	// One level down, and the reason this is in the same slice: the adoption
	// path qualifies an incoming revision with the SAME `damaged` flag
	// (`PageStore` refuses "the incoming revision is not a clean inline
	// page"), and `writeVerified` certifies a recovery copy by re-parsing it
	// and checking that same flag. Both were blind to this shape. Driven
	// through the real public entry point rather than argued from the guard.
	it("an incoming revision whose strokes key is not a list is refused as unclean", async () => {
		const adapter = new FakeAdapter();
		const store = new PageStore({ vault: { adapter } });
		adapter.externalWrite(PATH, sidecar("inline", [], 1, { strokes: {} }));
		const outgoing = parsePage(sidecar("inline", []), PAGE_ID).data;
		const prep = await store.prepareExternalAdoption(PAGE_ID, outgoing);
		expect(prep.kind).toBe("unavailable");
	});
});

/**
 * The last uncounted per-entry drop in the three loops. The boxes and images
 * loops both count their non-object exit; the strokes loop, which the
 * counters were written for, did not - it read as an oversight rather than a
 * boundary once its two neighbours were counted.
 */
describe("a stroke entry that is not an object", () => {
	it("is damage, and its readable sibling survives", () => {
		const raw = JSON.parse(sidecar("inline", [rawStroke("kept", V1_OK, false)])) as Record<
			string,
			unknown
		>;
		(raw.strokes as unknown[]).push(null);
		const r = parsePage(JSON.stringify(raw), PAGE_ID);
		expect(r.damaged).toBe(true);
		expect(r.data.strokes.map((s) => s.id)).toEqual(["kept"]);
	});
});
