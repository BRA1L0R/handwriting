/**
 * THE TRAILING PERIOD IS BACK ON THE TWO PDF REFUSALS, AND THE ARC IS THE POINT.
 *
 * IT CAME OFF FIRST. Alan, 2026-09-09 18:41 CDT, shown both strings as they
 * were and as they would be and asked yes or no with no wording touched either
 * way. Verbatim: "last period off, ones between sentences stay".
 *
 * AND HE PUT IT BACK THE SAME DAY, 2026-09-09 17:14 CDT, which is what this
 * file now asserts. Verbatim: "ehhhhhhhhhhhhhhhh we hsould be consistent, put a
 * period back at end". The reason bounds it: OTHER messages on this same
 * command always carried trailing periods and had never been shown to him, so
 * he chose consistency in the direction of restoring rather than stripping
 * more. The authority is that 17:14 entry, which supersedes the 18:41 one.
 *
 * DO NOT STRIP THEM AGAIN ON THE STRENGTH OF THE 18:41 ENTRY. It is still on
 * the record, it still says the opposite, and it was correctly executed at the
 * time.
 *
 * Both INTERNAL periods in the second string are unchanged throughout - his
 * 17:18 "yes that's fine good call" was never reversed.
 *
 * AND NOT EVERY APPROVED STRING IS PUNCTUATED. The ink-trash restore line is
 * ruled BARE because it ends in a file path (17:21 CDT, "leave that last one
 * bare"). Nothing here may be generalised into "approved strings end in a
 * period"; this file speaks only for the two constants it names.
 *
 * PUNCTUATION ONLY. He has never seen the wording of either sentence and this
 * file says nothing about it - see the marker on the constants themselves.
 *
 * WHY THE NEEDLE IS A LITERAL TABLE AND NOT THE LIVE CONSTANT. A needle read
 * from the constant it guards moves with the defect: restore the period in
 * `main.ts` and a derived needle becomes the punctuated form too, matches
 * itself, and the sweep is green in both states. That exact flaw was caught by
 * its own control on another branch today, and only by running the control.
 *
 * The punctuated form is never written here as one piece either - it is
 * assembled from `body + PERIOD` - so the sweep cannot match its own source
 * even if the test-file exclusion below is ever loosened.
 */

import { describe, expect, it } from "vitest";

const ALL_TS = import.meta.glob("/src/**/*.ts", {
	query: "?raw",
	eager: true,
	import: "default",
}) as Record<string, string>;

const PERIOD = ".";

/** Written out by hand, from Alan's ruling, not read from the code under test. */
const REFUSALS: ReadonlyArray<{ name: string; body: string }> = [
	{
		name: "PDF_INK_NOT_READY",
		body: "Handwriting: this PDF's ink storage is not ready. nothing was deleted",
	},
	{
		name: "PDF_INK_CHANGED_DURING_BACKUP",
		body:
			"Handwriting: the ink changed while its backup was being made. nothing was deleted. " +
			"run Delete all ink again if you still want to remove it",
	},
];

/** Everything that ships: source, minus the tests that describe it. */
function shipped(): Array<[string, string]> {
	return Object.entries(ALL_TS).filter(([path]) => !path.endsWith(".test.ts"));
}

describe("the PDF delete-all refusals carry their trailing period", () => {
	it("CONTROL: the sweep reads real files and the needles are the shipped text", () => {
		const files = shipped();
		// A sweep that read nothing would pass every assertion below.
		expect(files.length).toBeGreaterThan(100);
		expect(files.some(([p]) => p.endsWith("/src/main.ts"))).toBe(true);

		// And each needle really is the sentence that ships, so a green below
		// cannot come from a mistyped needle.
		for (const { name, body } of REFUSALS) {
			const found = files.filter(([, src]) => src.includes(body + PERIOD));
			expect(found.length, `${name}: the punctuated sentence is not in any shipped file`).toBe(1);
		}
	});

	it.each(REFUSALS)("$name ends with a period where it ships", ({ body }) => {
		const carriers = shipped()
			.filter(([, src]) => src.includes(body + PERIOD))
			.map(([path]) => path);
		expect(carriers, "the punctuated sentence ships nowhere").not.toEqual([]);
	});

	/**
	 * The bare form is checked as the sentence followed by a CLOSING QUOTE,
	 * never by plain absence: the punctuated string contains the bare one as a
	 * prefix, so `!includes(body)` can never pass and would be a guard that
	 * only ever reports failure.
	 */
	it.each(REFUSALS)("$name never ships unpunctuated", ({ body }) => {
		const offenders = shipped()
			.filter(([, src]) => src.includes(body + '"'))
			.map(([path]) => path);
		expect(offenders, `the trailing period is missing in: ${offenders.join(", ")}`).toEqual([]);
	});
});
