import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePage, serializePage } from "./PageData";

/**
 * A CHARACTERISATION FILE. IT PINS BEHAVIOUR THAT IS WRONG.
 *
 * DO NOT DELETE THIS BECAUSE IT LOOKS BROKEN. The `it.fails` cases state what
 * the decoder SHOULD do and record that today it does not; the green ones quote
 * what it ACTUALLY does. **A fix turns both kinds red on purpose**, so whoever
 * fixes it comes back here and re-pins deliberately.
 *
 * THE DEFECT. `migratePageData` reads a stroke's creation time as
 *
 *     createdAt: num(s.createdAt) ?? Date.now(),
 *
 * so a stroke whose `createdAt` is absent or unreadable is stamped with the
 * time of THE LOAD. **That default is nondeterministic.** Every other silent
 * default in this parser is wrong but STABLE - a width of 320 is wrong the same
 * way on every load, so a comparison built on it at least compares like with
 * like. **This one is wrong differently every time**: the same bytes produce a
 * different model on every load, and two devices opening one synced file
 * disagree about when its ink was drawn.
 *
 * WHAT IT BREAKS DOWNSTREAM, written here rather than left in a side channel
 * because that is where a reader three weeks from now will be standing:
 * **`createdAt` ordering is used as EVIDENCE.** A fork analysis on 2026-09-08
 * used createdAt ordering as measured proof that no ink was lost in a sync
 * incident. Any such argument is only as sound as the field, and for a stroke
 * that reached this branch the field was invented at load time - so an ordering
 * over those strokes says when they were PARSED, not when they were drawn.
 * **Check this test before trusting a createdAt ordering.**
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. It does not claim the fix should
 * raise `damaged`. An ABSENT `createdAt` is indistinguishable from a sidecar
 * written before the field existed, and nothing in the format records which
 * fields a file was written with - `schemaVersion` is per FILE, not per field.
 * Calling absence damage would flag ordinary old files, which is the failure the
 * container-loss slice was careful to avoid. A deterministic fallback and a
 * damage verdict are both defensible and it is not a runner's call.
 *
 * THE KNOWN-FAILING IDIOM is `it.fails`, following `PageStoreTwoDocuments.test.ts`
 * which established it here. Its known cost is that it passes on ANY error
 * escaping the body, including a broken harness - so everything the failing
 * cases rest on is asserted first, in the green tests below.
 */

const PAGE_ID = "createdat-nondeterminism";
const T1 = 1_000_000_000_000;
const T2 = 2_000_000_000_000;

/** A sidecar whose one stroke carries no `createdAt` at all. */
function sidecarWithout(): string {
	return JSON.stringify({
		schemaVersion: 1,
		pageId: PAGE_ID,
		surface: "inline",
		textBoxes: [],
		images: [],
		strokes: [
			{ id: "s1", tool: "pen", color: "#4b7bec", width: 2, pts: [10, 20, 0.5, 0, 30, 40, 0.5, 8] },
		],
	});
}

/** The same sidecar with a real `createdAt`, as the plugin itself writes it. */
function sidecarWith(createdAt: number): string {
	const raw = JSON.parse(sidecarWithout()) as { strokes: Record<string, unknown>[] };
	raw.strokes[0]!.createdAt = createdAt;
	return JSON.stringify(raw);
}

/** Parse `text` with the clock frozen at `now`. */
function parseAt(now: number, text: string) {
	vi.setSystemTime(now);
	return parsePage(text, PAGE_ID);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
	vi.useRealTimers();
});

describe("a stroke with no createdAt is stamped with the time of the load", () => {
	// The setup proof, green and first: `it.fails` passes on ANY escaping error,
	// so a fixture that had stopped reproducing would hide the defect instead of
	// reporting it. Break any of this and these go red.
	it("the harness holds: the clock is frozen, one stroke loads, and a REAL createdAt is kept exactly", () => {
		const kept = parseAt(T1, sidecarWith(12345));
		expect(kept.data.strokes).toHaveLength(1);
		// The control that matters: the default fires ONLY when the field is
		// unusable. A file that carries its own time is untouched by any of this.
		expect(kept.data.strokes[0]!.createdAt).toBe(12345);
		expect(kept.damaged).toBeFalsy();

		// And with the field absent, the value is the CLOCK - not the file.
		expect(parseAt(T1, sidecarWithout()).data.strokes[0]!.createdAt).toBe(T1);
		expect(parseAt(T2, sidecarWithout()).data.strokes[0]!.createdAt).toBe(T2);
	});

	// WHAT IT ACTUALLY PRODUCES, received values quoted, so the magnitude is
	// visible here and not only in a report.
	it("characterises the non-determinism: identical bytes, two loads, two different models", () => {
		const bytes = sidecarWithout();
		const first = parseAt(T1, bytes).data.strokes[0]!.createdAt;
		const second = parseAt(T2, bytes).data.strokes[0]!.createdAt;

		expect(first).toBe(1_000_000_000_000);
		expect(second).toBe(2_000_000_000_000);
		// The whole defect in one line: same input, different output.
		expect(first).not.toBe(second);
		// And it tracks the clock exactly, which is what makes it unbounded
		// rather than merely wrong - the gap is however long apart the loads are.
		expect(second - first).toBe(T2 - T1);

		// Nothing warns. The file loads clean and the next save writes the
		// invented time back over it as though it were the real one.
		expect(parseAt(T1, bytes).damaged).toBeFalsy();
	});

	// The consequence, and the reason it is not merely cosmetic: two devices
	// that open the same synced file and save it write DIFFERENT bytes.
	it("characterises the divergence: re-serialising the same file twice gives different bytes", () => {
		const bytes = sidecarWithout();
		const outA = serializePage(parseAt(T1, bytes).data);
		const outB = serializePage(parseAt(T2, bytes).data);
		expect(outA).not.toBe(outB);
		expect(outA).toContain(`"createdAt":${T1}`);
		expect(outB).toContain(`"createdAt":${T2}`);
	});

	it.fails("the same bytes parse to the same model however far apart the loads are", () => {
		const bytes = sidecarWithout();
		expect(parseAt(T2, bytes).data.strokes[0]!.createdAt).toBe(
			parseAt(T1, bytes).data.strokes[0]!.createdAt
		);
	});

	it.fails("loading and re-saving one file twice produces identical bytes", () => {
		const bytes = sidecarWithout();
		expect(serializePage(parseAt(T2, bytes).data)).toBe(serializePage(parseAt(T1, bytes).data));
	});
});
