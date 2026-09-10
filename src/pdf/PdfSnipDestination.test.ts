/**
 * THE PDF PNG SNIP IS THE ONE EXPORT PAINTER THAT NEVER DECLARES ITS
 * DESTINATION, so `Keep exported ink readable` cannot reach it.
 *
 * `exportInkColor` is the gated entry point for every export painter and its
 * first line is `if (dest === null || dest === undefined || !exportReadable)
 * return color`. A painter that declares no destination therefore gets the
 * stored colour **whatever the setting says** - the toggle is not merely
 * ineffective on this surface, it is unreachable by construction.
 *
 * THE DEFECT IS THE UNREACHABILITY, NOT THE DARKNESS. "The snip is faint" is a
 * symptom and could be argued about; "a setting the user toggles cannot change
 * this output" is the thing to fix. The second case below is the one that says
 * so, and it is the load-bearing one.
 *
 * WHO DECLARES A DESTINATION, measured at this tip: `InkPdf.ts:71` and
 * `SvgExport.ts:86`/`:190` pass one as an argument; the NOTE snip wraps its
 * paint in `withInkDestination(SNIP_PAGE, ...)` (`InkOverlay.ts:5349`). The
 * PDF snip (`PdfInkController.snipSelection`) paints its own white page and
 * then draws committed strokes through the shared renderer with neither.
 *
 * CHARACTERISATION: these pin what the code does today, which is the wrong
 * thing. The fix - giving the PDF snip a destination - will turn the third
 * case red, and that red is the signal the gap closed.
 */

import { afterEach, describe, expect, it } from "vitest";
import snipSrc from "./PdfInkController.ts?raw";
import overlaySrc from "../inline/InkOverlay.ts?raw";
import { codeOnly } from "../CodeOnly";
import {
	contrastRatio,
	inkColorFor,
	relativeLuminance,
	resetInkTheme,
	setInkExportReadability,
	withInkDestination,
} from "../ink/InkTheme";

/** The white page both snips paint under the ink. */
const PAGE = "#ffffff";
/** Deliberately faint ink - the case the readability rule exists for. */
const FAINT = "#f4f4f2";

function lum(hex: string): number {
	const h = hex.replace("#", "");
	const n = parseInt(h, 16);
	return relativeLuminance((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
const contrastOnPage = (hex: string): number => contrastRatio(lum(hex), lum(PAGE));

/** What the NOTE snip does: paint inside a declared destination. */
const noteSnipColour = (ink: string): string =>
	withInkDestination(PAGE, () => inkColorFor({ color: ink, tool: "pen" as const }));

/** What the PDF snip does: paint with no destination declared at all. */
const pdfSnipColour = (ink: string): string => inkColorFor({ color: ink, tool: "pen" as const });

afterEach(() => {
	resetInkTheme();
	setInkExportReadability(true);
});

describe("the PDF snip's missing destination", () => {
	it("emits faint ink unchanged where the note snip makes it readable", () => {
		setInkExportReadability(true);

		const note = noteSnipColour(FAINT);
		const pdf = pdfSnipColour(FAINT);

		// The note snip declares a destination, so the rule runs and the ink
		// clears the readability bar on the page it is landing on.
		expect(note).not.toBe(FAINT);
		expect(contrastOnPage(note)).toBeGreaterThanOrEqual(3);

		// The PDF snip declares none, so the stored colour leaves untouched and
		// is very nearly invisible on its own white page.
		expect(pdf).toBe(FAINT);
		// Measured at this tip: 1.101 against a required 3. Bounded rather
		// than pinned to the digit, because the number is a property of this
		// fixture's ink and the claim is that it is nowhere near readable.
		expect(contrastOnPage(pdf)).toBeLessThan(1.2);
		expect(contrastOnPage(pdf)).toBeLessThan(3);
	});

	it("THE DEFECT: the setting changes the note snip and CANNOT change the PDF snip", () => {
		// This is the case that states the defect rather than a symptom. A user
		// toggling `Keep exported ink readable` moves one surface and not the
		// other, and no value of the setting makes the PDF snip differ.
		setInkExportReadability(true);
		const noteOn = noteSnipColour(FAINT);
		const pdfOn = pdfSnipColour(FAINT);

		setInkExportReadability(false);
		const noteOff = noteSnipColour(FAINT);
		const pdfOff = pdfSnipColour(FAINT);

		expect(noteOn).not.toBe(noteOff); // the setting reaches the note snip
		expect(pdfOn).toBe(pdfOff); // and cannot reach the PDF snip
		expect(pdfOn).toBe(FAINT);
		expect(pdfOff).toBe(FAINT);
	});

	it("the PDF snip painter declares no destination, and the note snip does", () => {
		// Pinned at the painters themselves, so the gap cannot be closed in one
		// and left open in the other without this failing.
		const pdf = codeOnly(snipSrc);
		const note = codeOnly(overlaySrc);

		const at = pdf.indexOf("async snipSelection(");
		expect(at, "PdfInkController.snipSelection not found").toBeGreaterThanOrEqual(0);
		const region = pdf.slice(at, at + 3400);
		// It really is a painter onto a page of its own - it cannot fail open
		// by simply not being the snip.
		expect(region).toContain("fillStyle");
		expect(region).toContain("drawCommitted");
		// ...and it names neither seam.
		expect(region).not.toContain("withInkDestination");
		expect(region).not.toContain("exportInkColor");

		// The note snip, by contrast, declares one.
		expect(note).toContain("withInkDestination");
	});
});
