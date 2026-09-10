/**
 * The stalled-adoption toast has to arrive as TWO LINES.
 *
 * Alan asked for the break and said why: *"i want the line break it helps with
 * visibility"*. A toast gets about two seconds of attention, and a run-on
 * sentence in that window is a toast nobody reads.
 *
 * WHAT THIS FILE PINS, and what it deliberately does not. It pins OUR half:
 * that the message is written in two blocks, that the splitter finds them, and
 * that a one-block message does not pay for a fragment. The HOST half - that
 * Obsidian renders those blocks on separate lines - cannot be asserted from
 * here, and was established by reading the app bundle instead:
 *
 *   - `Element.prototype.setText` in obsidian.asar begins
 *     `if (e instanceof DocumentFragment || e instanceof Node) return
 *     t.empty(), void t.appendChild(e)` - so a fragment handed to
 *     `createDiv({ text })` is APPENDED as nodes, not stringified. Without
 *     that branch the whole approach would silently render
 *     "[object DocumentFragment]".
 *   - `.notice-message` has NO css rules in the app bundle at all, so a child
 *     `div` is block-level by the UA default and stacks. `.notice`'s own
 *     `flex-direction` cannot reach a grandchild.
 *
 * That reading is true of the Obsidian we ship against and is exactly the kind
 * of fact an update can change without telling us. This file is the half that
 * will still fail loudly if someone edits the copy into one line.
 */
import { describe, expect, it } from "vitest";
import { noticeBlocks } from "./main";

/**
 * The live string, sliced out of source rather than duplicated here.
 *
 * A copy of the message in the test would pass forever while production drifted
 * to one line - the assertion has to read what actually ships. CRLF is
 * normalised first because a checkout on Windows has it and the split is on a
 * blank line.
 */
async function shippedAdoptionMessage(): Promise<string> {
	const raw = (await import("./inline/InlineInkStore.ts?raw")).default as string;
	const src = raw.replace(/\r\n/g, "\n");
	const marker = "const ADOPTION_STILL_FAILING =";
	const at = src.indexOf(marker);
	expect(at, "ADOPTION_STILL_FAILING is gone or renamed").toBeGreaterThan(0);
	const semi = src.indexOf(";", at);
	expect(semi, "no statement end after ADOPTION_STILL_FAILING").toBeGreaterThan(at);
	const decl = src.slice(at + marker.length, semi).trim();
	// A single double-quoted literal, with its escapes still written as escapes.
	expect(decl.startsWith('"') && decl.endsWith('"'), `unexpected shape: ${decl}`).toBe(true);
	return JSON.parse(decl) as string;
}

describe("a notice written in blocks arrives in blocks", () => {
	it("splits on a blank line", () => {
		expect(noticeBlocks("one\n\ntwo")).toEqual(["one", "two"]);
	});

	it("leaves a single newline INSIDE its block, because wrapping is the theme's business", () => {
		expect(noticeBlocks("one\ntwo")).toEqual(["one\ntwo"]);
	});

	it("a one-block message stays one block, so it can take the cheap path", () => {
		expect(noticeBlocks("just the one")).toHaveLength(1);
	});

	it("tolerates trailing whitespace on the blank line", () => {
		expect(noticeBlocks("one\n   \ntwo")).toEqual(["one", "two"]);
	});

	it("drops nothing and invents nothing on an empty message", () => {
		expect(noticeBlocks("")).toEqual([]);
	});
});

describe("THE SHIPPED stalled-adoption message", () => {
	it("is written in exactly two blocks", async () => {
		const msg = await shippedAdoptionMessage();
		const blocks = noticeBlocks(msg);
		expect(
			blocks,
			`the toast must arrive as two lines; got ${blocks.length}: ${JSON.stringify(blocks)}`
		).toHaveLength(2);
	});

	it("asks the question first, then reassures - that order is the point", async () => {
		const blocks = noticeBlocks(await shippedAdoptionMessage());
		expect(blocks[0]).toBe("ink not appearing on this device?");
		expect(blocks[1]).toBe("your ink is safe. still trying to load from your other device...");
	});

	it("keeps the ellipsis, which is what says it has not given up", async () => {
		const blocks = noticeBlocks(await shippedAdoptionMessage());
		expect(blocks[blocks.length - 1]!.endsWith("...")).toBe(true);
	});

	it("promises no action, because there is none the reader can take", async () => {
		const msg = (await shippedAdoptionMessage()).toLowerCase();
		// The recovery copies live in a folder Obsidian will not show them, so
		// any instruction here would send someone somewhere they cannot go.
		for (const wrong of ["restart", "reload", "settings", ".handwriting", "try again"]) {
			expect(msg, `the copy tells the reader to "${wrong}"`).not.toContain(wrong);
		}
	});
});
