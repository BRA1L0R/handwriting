/**
 * The lasso delete tells the truth about what it did.
 *
 * Reported from public (r/ObsidianMD, Boox, 2026-09-07): "when you lasso
 * writing and hit the trash, it says 'you must lasso something first'". The
 * real string is `Handwriting: lasso some ink first`, and it was reached two
 * ways - by a genuinely empty selection, where it is TRUE, and by a real
 * selection whose ids the store matched none of, where it is a lie AND the
 * lasso had already been wiped before the failure was noticed.
 *
 * WHY THE STORE IS MOCKED HERE. Which of the two candidate causes produces the
 * empty `applyRemove` - a selection holding ids an external sidecar reload
 * replaced, or `filePath()` resolving somewhere the strokes are not stored - is
 * NOT settled, and this box was not asked to settle it. Driving the real store
 * would pin one of those guesses into a test. Faking the one return value that
 * both candidates end in pins what the overlay does about it, which is the part
 * that holds either way.
 */
import { describe, expect, it, vi } from "vitest";

const del = vi.hoisted(() => ({
	op: null as unknown,
	calls: [] as { path: string; ids: string[] }[],
}));
vi.mock("./InlineSelectionDelete", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./InlineSelectionDelete")>();
	return {
		...actual,
		removeSelectedInlineStrokes: (_store: unknown, path: string, ids: readonly string[]) => {
			del.calls.push({ path, ids: [...ids] });
			return del.op;
		},
	};
});

import { InkOverlayPlugin, cutSelectionNotice, type CutSelectionOutcome } from "./InkOverlay";
import { lassoDeleteNotice, type DeleteSelectionOutcome } from "./InlineSelectionDelete";

/** The two strings, written out here so a change to either one fails loudly. */
const EMPTY_NOTICE = "Handwriting: lasso some ink first";
const UNMATCHED_NOTICE = "Handwriting: could not remove the selected ink - the lasso has been kept";

/**
 * A plugin instance carrying only what `deleteSelectedInk` actually touches.
 * The selection stub exposes the two members the method uses and counts its
 * own clears, which is the whole point of the first failure case.
 */
function overlay(ids: string[], path: string | null = "note.md") {
	const selection = {
		strokeIds: [...ids],
		cleared: 0,
		clear(): void {
			this.cleared++;
			this.strokeIds = [];
		},
	};
	const dispatched: unknown[] = [];
	const repainted: string[] = [];
	const o = Object.create(InkOverlayPlugin.prototype) as Record<string, unknown>;
	o.filePath = () => path;
	o.selection = selection;
	o.redrawSelectionUI = () => {};
	o.dispatchInk = (op: unknown) => void dispatched.push(op);
	o.scheduleRepaint = () => {};
	o.repaintPath = (p: string) => void repainted.push(p);
	return { o, selection, dispatched, repainted };
}

const proto = InkOverlayPlugin.prototype as unknown as {
	deleteSelectedInk(this: unknown): DeleteSelectionOutcome;
	cutSelectedInk(this: unknown): CutSelectionOutcome;
};

describe("lassoDeleteNotice: one outcome, one sentence", () => {
	it("keeps the empty-selection sentence byte for byte - it was always true", () => {
		expect(lassoDeleteNotice({ kind: "empty" })).toBe(EMPTY_NOTICE);
	});

	it("gives the unmatched case its own sentence, and it is NOT the old one", () => {
		const said = lassoDeleteNotice({ kind: "unmatched", count: 3 });
		expect(said).toBe(UNMATCHED_NOTICE);
		// The whole point: the user DID lasso, so the old sentence would be a
		// lie here, and a test that only checked "some notice appears" would
		// have passed on the bug.
		expect(said).not.toBe(EMPTY_NOTICE);
	});

	it("says nothing at all when the delete worked", () => {
		expect(lassoDeleteNotice({ kind: "deleted", count: 2 })).toBeNull();
	});
});

describe("cutSelectionNotice: a cut owes three different sentences, not two", () => {
	it("keeps the empty-selection sentence byte for byte - the same string, always true", () => {
		expect(cutSelectionNotice({ kind: "empty" })).toBe(EMPTY_NOTICE);
	});

	it("says the ink was copied when the cut actually happened", () => {
		expect(cutSelectionNotice({ kind: "cut", count: 3 })).toBe("Handwriting: cut 3 stroke(s)");
	});

	it("gives the copied-but-not-removed case its own honest sentence", () => {
		const said = cutSelectionNotice({ kind: "unmatched", count: 1 });
		// Says the ink WAS copied - "lasso some ink first" here would be a lie,
		// the exact shape of the bug the delete side of this file was written
		// against, ported to cut.
		expect(said).toBe("Handwriting: copied 1 stroke(s) but could not remove them - the lasso has been kept");
		expect(said).not.toBe(EMPTY_NOTICE);
	});
});

describe("deleteSelectedInk: a failure it cannot act on keeps the lasso", () => {
	it("does NOT clear a selection the store matched none of, and logs path and ids", () => {
		del.op = null;
		del.calls.length = 0;
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { o, selection } = overlay(["s1", "s2"]);
			const out = proto.deleteSelectedInk.call(o);

			expect(out).toEqual({ kind: "unmatched", count: 2 });
			// The lasso is still on screen. This is the half of the bug the
			// user feels: before, it was gone and re-lassoing failed the same.
			expect(selection.cleared).toBe(0);
			expect(selection.strokeIds).toEqual(["s1", "s2"]);
			// The evidence nobody was collecting, and what the unresolved
			// root-cause question needs: which path, which ids.
			expect(logged).toHaveBeenCalledTimes(1);
			const [, detail] = logged.mock.calls[0]!;
			expect(detail).toEqual({ path: "note.md", strokeIds: ["s1", "s2"] });
		} finally {
			logged.mockRestore();
		}
	});

	it("an empty selection is unchanged: clears, says empty, logs nothing", () => {
		del.op = null;
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { o, selection } = overlay([]);
			expect(proto.deleteSelectedInk.call(o)).toEqual({ kind: "empty" });
			// The old behaviour on this path, deliberately preserved.
			expect(selection.cleared).toBe(1);
			expect(logged).not.toHaveBeenCalled();
		} finally {
			logged.mockRestore();
		}
	});

	it("a null path with nothing selected is still just empty - no log, no lie either way", () => {
		const { o, selection } = overlay([], null);
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(proto.deleteSelectedInk.call(o)).toEqual({ kind: "empty" });
			expect(selection.cleared).toBe(0);
			expect(logged).not.toHaveBeenCalled();
		} finally {
			logged.mockRestore();
		}
	});

	it("a null path is NOT an empty selection when the lasso holds something real", () => {
		// r/ObsidianMD's other shape of the same lie: the user did lasso ink,
		// there is just nowhere to look it up. Reuses "unmatched" - from the
		// caller's side a null path and a store that matched nothing are the
		// same fact, a real selection that could not be removed - and it logs
		// the null path itself, not just the ids, so this case stays visible
		// next to a genuine store miss rather than folding into it silently.
		const { o, selection } = overlay(["s1", "s2"], null);
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const out = proto.deleteSelectedInk.call(o);

			expect(out).toEqual({ kind: "unmatched", count: 2 });
			expect(selection.cleared).toBe(0);
			expect(selection.strokeIds).toEqual(["s1", "s2"]);
			expect(logged).toHaveBeenCalledTimes(1);
			const [, detail] = logged.mock.calls[0]!;
			expect(detail).toEqual({ path: null, strokeIds: ["s1", "s2"] });
		} finally {
			logged.mockRestore();
		}
	});

	it("a normal delete is unchanged: same count, the op dispatched, selection cleared", () => {
		const op = { type: "remove", path: "note.md", strokes: [], indices: [] };
		del.op = op;
		const { o, selection, dispatched, repainted } = overlay(["s1", "s2", "s3"]);

		expect(proto.deleteSelectedInk.call(o)).toEqual({ kind: "deleted", count: 3 });
		expect(dispatched).toEqual([op]);
		expect(selection.cleared).toBe(1);
		expect(repainted).toEqual(["note.md"]);
	});
});

describe("cutSelectedInk: a cut that did not happen is not reported as one", () => {
	it("answers unmatched - not empty, not a bare number - when the copy worked but the delete removed nothing", () => {
		del.op = null;
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { o, selection } = overlay(["s1"]);
			o.copySelectedInk = () => 1;

			// The clipboard holds the stroke and so does the note; a bare 0
			// (the old shape) is indistinguishable from "nothing was selected"
			// at every caller, which is the lie `cutSelectionNotice` exists to
			// stop telling.
			expect(proto.cutSelectedInk.call(o)).toEqual({ kind: "unmatched", count: 1 });
			expect(selection.cleared).toBe(0);
		} finally {
			logged.mockRestore();
		}
	});

	it("still answers the copied count when the delete really removed them", () => {
		del.op = { type: "remove", path: "note.md", strokes: [], indices: [] };
		const { o } = overlay(["s1", "s2"]);
		o.copySelectedInk = () => 2;
		expect(proto.cutSelectedInk.call(o)).toEqual({ kind: "cut", count: 2 });
	});

	it("answers empty when nothing was copied - the genuinely empty case", () => {
		const { o } = overlay([]);
		o.copySelectedInk = () => 0;
		expect(proto.cutSelectedInk.call(o)).toEqual({ kind: "empty" });
	});
});
