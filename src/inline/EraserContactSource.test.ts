/**
 * A source guard over the ERASER CONTACT PATH, because the 1.4.12 report was
 * filed against the wrong toast and the cheapest way to keep that from
 * happening twice is to be able to prove where a pen contact can and cannot
 * reach.
 *
 * WHAT WAS REPORTED. Alan, hardware, on `vault test 2`: "holding ctrl and
 * touching eraser end to screen spams toast notification - there is no ink on
 * the note to erase, even though there is". That was read as the
 * `delete-all-ink` command's "Handwriting: no ink on this note", which would
 * have meant a pen contact was somehow running a palette command - a keyboard
 * event synthesised by the eraser, a hotkey collision, or a plugin path
 * dispatching a command id off `buttons & 32`.
 *
 * WHAT IS ACTUALLY THE CASE, and what this file pins:
 *
 *   - the toast is `InkOverlay.penDown`'s own "no ink on the page to erase",
 *     three words from Alan's wording and on the eraser branch itself;
 *   - the eraser branch reaches no palette command at all. Not once per
 *     contact, not once per sample, not ever;
 *   - `handwriting:delete-all-ink` is dispatched from nowhere in the tree. It
 *     exists as an `addCommand` id and as nothing else, so no pen path, strip
 *     button or keyboard handler can invoke it however it is provoked.
 *
 * WHY SOURCE TEXT. A behavioural test can only show that the eraser did not
 * run a command in the situations it was driven through. What is worth
 * pinning is that there is no such call to run in the first place - a
 * property of the code, not of a scenario, and one a future edit could add
 * back without failing any behavioural test in this suite.
 *
 * BOUNDED AT BOTH ENDS, and both anchors asserted to exist. An unbounded
 * search over the file would be useless here: `InkOverlay.ts` legitimately
 * holds `commands.executeCommandById(id)` a thousand lines away, wiring the
 * pen-tools strip's buttons. The claim is about the eraser branch, so the
 * slice is the eraser branch, and a rename that moves either anchor fails
 * loudly rather than shrinking the window to nothing and passing.
 *
 * Source text via `import.meta.glob` + `?raw`, and comments blanked with
 * `codeOnly`, for the reasons those two carry in `InkSurfaceRules.test.ts`
 * and `CodeOnly.ts`: this repo has no `@types/node`, and a guard a comment
 * can satisfy is a guard a comment can defeat. This very file's header names
 * `executeCommandById` and `delete-all-ink` in prose, which would satisfy a
 * raw-text search on its own.
 */

import { describe, expect, it } from "vitest";
import { codeOnly } from "../CodeOnly";

const ALL_TS = import.meta.glob("/src/**/*.ts", {
	query: "?raw",
	eager: true,
	import: "default",
}) as Record<string, string>;

const OVERLAY = "/src/inline/InkOverlay.ts";

/** A file's code, comments blanked. Throws on a rename rather than passing vacuously. */
function code(file: string): string {
	const text = ALL_TS[file];
	if (text === undefined) throw new Error(`not in the source scan: ${file}`);
	return codeOnly(text);
}

/**
 * The eraser branch of `penDown`, from the branch itself to the next
 * gesture's branch.
 *
 * Both ends are asserted present and unique before anything is sliced, and
 * the slice is asserted non-trivial: the three ways a bounded-slice guard
 * goes quietly vacuous are a missing opener, a missing closer, and a window
 * that closes before it opens.
 */
const ERASER_BRANCH_OPEN = "if (eraser) {";
const ERASER_BRANCH_CLOSE = 'if (intent === "pan") {';

function eraserBranch(): string {
	const text = code(OVERLAY);
	const opens = text.split(ERASER_BRANCH_OPEN).length - 1;
	const closes = text.split(ERASER_BRANCH_CLOSE).length - 1;
	expect(opens, `anchor "${ERASER_BRANCH_OPEN}" in ${OVERLAY}`).toBe(1);
	expect(closes, `anchor "${ERASER_BRANCH_CLOSE}" in ${OVERLAY}`).toBe(1);
	const from = text.indexOf(ERASER_BRANCH_OPEN);
	const to = text.indexOf(ERASER_BRANCH_CLOSE);
	expect(to).toBeGreaterThan(from);
	const slice = text.slice(from, to);
	// A window that is present, ordered, and still too small to contain the
	// branch would pass every check above. The erase branch sets four fields
	// and calls four methods; anything under a few hundred characters means
	// the anchors have drifted onto something else.
	expect(slice.length).toBeGreaterThan(300);
	return slice;
}

describe("the eraser contact path", () => {
	it("reaches no palette command, however many contacts a scrub makes", () => {
		const branch = eraserBranch();
		// Every spelling this repo actually uses to run a command, from the
		// two real dispatch sites (main.ts and InkOverlay's strip wiring).
		for (const call of ["executeCommandById", "app.commands", ".commands", "exec("]) {
			expect(branch, `eraser branch must not reach ${call}`).not.toContain(call);
		}
	});

	it("says its one thing through the gate, so a scrub cannot repeat it", () => {
		const branch = eraserBranch();
		// One Notice-raising call, and it is the gated helper rather than a
		// bare `new Notice` - the bare form is what fired per contact.
		expect(branch).toContain("this.sayIfPageEmpty(here, \"erase\")");
		expect(branch).not.toContain("new Notice(");
	});

	it("still decides erase-vs-ink from the pen alone, never from a modifier", () => {
		// The report named Ctrl. Nothing on this path reads a modifier, and
		// the arbitration it does use takes buttons and the strip mode only
		// (TipMode.penContactIntent). If a modifier is ever consulted here,
		// this is the line that should have to be rewritten deliberately.
		const branch = eraserBranch();
		expect(branch).not.toContain("ctrlKey");
		expect(branch).not.toContain("metaKey");
		expect(branch).not.toContain("altKey");
		expect(branch).not.toContain("shiftKey");
	});
});

describe("handwriting:delete-all-ink", () => {
	/**
	 * The whole tree, not one file: the point is that NOTHING dispatches it,
	 * so a per-file check would only be as good as the list of files someone
	 * remembered - the exact failure `StripPenChrome.test.ts` inverted its
	 * allowlist to avoid.
	 */
	const files = Object.keys(ALL_TS).filter((f) => !f.endsWith(".test.ts"));

	it("is declared in exactly one place and dispatched from none", () => {
		const declaring: string[] = [];
		const dispatching: string[] = [];
		for (const file of files) {
			const text = code(file);
			// CommandPaletteSplit.ts writes the same `id: "..."` shape for
			// every palette entry, but it REGISTERS nothing: it is the table
			// the settings row prints and the split test reads. The claim
			// here is about registration, so the table is not a declaration.
			if (file !== "/src/CommandPaletteSplit.ts" && text.includes('id: "delete-all-ink"'))
				declaring.push(file);
			// A dispatch needs the id in its command-palette form. The
			// `addCommand` declaration above is the bare id; anything that
			// RUNS it has to name the plugin prefix too.
			if (text.includes("handwriting:delete-all-ink")) dispatching.push(file);
		}
		expect(declaring).toEqual(["/src/main.ts"]);
		expect(dispatching).toEqual([]);
	});

	it("is not on any pen-tools strip button", () => {
		// The strip is the one thing in the plugin that turns a pen tap into
		// a command id, so it is the one place a pen COULD reach a palette
		// command. Its button table is the complete list, and this pins that
		// the destructive command is not on it.
		expect(code("/src/inline/MobileTools.ts")).not.toContain("delete-all-ink");
	});

	it("declares no default hotkey anywhere, so nothing binds it by accident", () => {
		// `addCommand({ hotkeys: [...] })` is how a plugin claims a chord.
		// This plugin claims none - every binding in a vault is the user's
		// own, which is what made the vault's hotkeys.json the place to look
		// when the report named Ctrl.
		for (const file of files) {
			expect(code(file), `${file} declares a default hotkey`).not.toContain("hotkeys:");
		}
	});
});
