/**
 * BOTH SOURCE INPUTS ARE READ AS CODE, NOT AS TEXT. This is the only file in
 * the family that scans two - `InkOverlay.ts` and `styles.css` - and it was
 * unprotected on both.
 *
 * Demonstrated on this branch in one edit, with every assertion below staying
 * green through it:
 *
 *   - the stylesheet's `display: none` default was retired into a comment and
 *     a live copy without it left in its place. The second assertion below,
 *     whose entire job is "if this rule ever goes away the empty-string form
 *     starts working by accident, which is worse than failing loudly", read
 *     the retired copy and passed.
 *   - both `penCursorEl.setCssStyles({ display: "none" })` sites were moved
 *     behind a helper and the old lines left as `// was: …` comments. The
 *     first assertion's anti-vacuity check - `showBlocks.length > 0` - was
 *     then satisfied entirely by comments, and its loop inspected sentences.
 *
 * There is a loud direction too, and it is unusually likely here: the needle
 * is `display: ""`, the exact buggy form, so the natural comment to write
 * beside the fix - one QUOTING what went wrong - trips the assertion that
 * forbids it. That is a false alarm; the two above are false all-clears. One
 * call closes all three.
 *
 * `codeOnly` (src/CodeOnly.ts) is the shared stripper, imported not copied.
 * `styles.css` carries no `//` sequence at all (verified), and `InkOverlay.ts`
 * already goes through `codeOnly` in `StripPenChrome.test.ts`, so neither
 * input is a new case for it. Blanking can only remove candidate matches, so
 * no real reveal site and no real stylesheet rule stops being seen; what stops
 * being seen is one that was only ever a sentence. Nothing here pins a
 * documented REASON, so no assertion is left reading raw.
 */

import { describe, expect, it } from "vitest";
import { MIN_CURSOR_VISUAL_PX } from "./PenCursor";
import overlaySrc from "./InkOverlay.ts?raw";
import pdfSrc from "../pdf/PdfInkController.ts?raw";
import css from "../../styles.css?raw";
import { codeOnly } from "../CodeOnly";

function overlaySource(): string {
	return codeOnly(overlaySrc);
}

function cursorCss(): string {
	return codeOnly(css);
}

/**
 * The cursor's style-writing sites in a piece of overlay source, comments
 * excluded. A pure function so the fixtures at the bottom can attack it with
 * a string rather than by editing the real overlay and putting it back.
 */
function cursorStyleBlocks(src: string): string[] {
	return codeOnly(src).match(/(penCursorEl|eraserEl)\.setCssStyles\(\{[^}]*\}/gs) ?? [];
}

/**
 * The pan branch of `penRaw`, as CODE, sliced out of a piece of overlay
 * source. Pure, so the fixtures at the bottom can attack it with a string.
 *
 * Every way of failing to find it THROWS rather than returning an empty
 * slice. An empty string satisfies every "does not contain" assertion there
 * is, so a rename that quietly stopped finding the branch would leave the
 * source check below passing over an overlay that had gone back to painting
 * the ring mid-pan - which is this file's own header, one defect later.
 */
function panMoveBranch(src: string): string {
	const code = codeOnly(src);
	const raw = code.indexOf("private penRaw(");
	if (raw < 0) throw new Error("InkOverlay has no penRaw to read");
	const start = code.indexOf('if (this.mode === "pan") {', raw);
	if (start < 0) throw new Error("penRaw has no pan branch");
	const end = code.indexOf("return;", start);
	if (end < 0) throw new Error("penRaw's pan branch never returns");
	return code.slice(start, end);
}

/**
 * What a scroller rule naming `cls` sets `cursor` to, or null if the sheet has
 * no such rule. Scoped to the rule that names the class rather than to the
 * whole sheet, for the reason `penCursorDefaultsToHidden` below gives.
 */
function scrollerCursorFor(sheet: string, cls: string): string | null {
	const rules = codeOnly(sheet).match(/[^{}]+\{[^}]*\}/g) ?? [];
	for (const rule of rules) {
		const brace = rule.indexOf("{");
		if (!new RegExp(`\\.${cls}(?![-\\w])`).test(rule.slice(0, brace))) continue;
		const declared = /cursor:\s*([\w-]+)/.exec(rule.slice(brace));
		if (declared?.[1]) return declared[1];
	}
	return null;
}

/**
 * Does the pen cursor's OWN rule default it to `display: none`?
 *
 * Bound to the rule, not to the file, and that is a second defect found while
 * closing the first. The assertion this replaces was
 * `/\.handwriting-pen-cursor[\s\S]*?display:\s*none/` across the whole sheet,
 * and `styles.css` carries TWELVE `display: none` declarations - so it passed
 * on the class name appearing anywhere above any of the other eleven, and
 * would pass over a pen-cursor rule with no `display` in it at all. Blanking
 * comments does not close that by itself; the match has to be scoped to the
 * rule. Strictly stronger than what it replaces: every sheet the new form
 * accepts, the old pattern accepted too.
 *
 * `(?![-\w.])` keeps it on the BASE rule - `.handwriting-pen-cursor` bare, in
 * a selector list - rather than on the hover-state rules that extend it.
 */
function penCursorDefaultsToHidden(sheet: string): boolean {
	const rules = codeOnly(sheet).match(/[^{}]+\{[^}]*\}/g) ?? [];
	return rules.some((rule) => {
		const brace = rule.indexOf("{");
		if (!/\.handwriting-pen-cursor(?![-\w.])/.test(rule.slice(0, brace))) return false;
		return /display:\s*none/.test(rule.slice(brace));
	});
}

import {
	PAN_DRAG_CLASS,
	PEN_HOVER_CLASS,
	isPenCompatMouseMove,
	penCursorLayout,
	penReticleShown,
} from "./PenCursor";

describe("inline pen cursor layout", () => {
	it("centers a visible minimum-size cursor under a thin pen", () => {
		const cursor = penCursorLayout({
			x: 100,
			y: 50,
			strokeWidth: 2,
			cameraZoom: 1,
			cssScale: 1,
		});

		// Pinned to the constant, not a literal: the floor is a presentation
		// choice that moved once already (6px was a speck under the nib).
		const d = MIN_CURSOR_VISUAL_PX;
		expect(cursor).toEqual({ x: 100 - d / 2, y: 50 - d / 2, diameter: d });
	});

	it("keeps the minimum diameter constant in VISUAL pixels under page scaling", () => {
		const cursor = penCursorLayout({
			x: 100,
			y: 50,
			strokeWidth: 2,
			cameraZoom: 1,
			cssScale: 1.25,
		});

		expect(cursor.diameter * 1.25).toBeCloseTo(MIN_CURSOR_VISUAL_PX);
		expect(cursor.x + cursor.diameter / 2).toBe(100);
		expect(cursor.y + cursor.diameter / 2).toBe(50);
	});

	it("shows the selected stroke width when it is larger than the minimum", () => {
		const cursor = penCursorLayout({
			x: 40,
			y: 30,
			strokeWidth: 18,
			cameraZoom: 1.2,
			cssScale: 1,
		});

		expect(cursor.diameter).toBeCloseTo(21.6);
		expect(cursor.x + cursor.diameter / 2).toBeCloseTo(40);
		expect(cursor.y + cursor.diameter / 2).toBeCloseTo(30);
	});
});

describe("inline pen cursor ownership", () => {
	it("keeps the pen cursor through an immediate same-point mouse-compatible move", () => {
		expect(
			isPenCompatMouseMove({
				now: 1050,
				lastPenHoverAt: 1000,
				mouseX: 401,
				mouseY: 299,
				penX: 400,
				penY: 300,
			})
		).toBe(true);
	});

	it("lets a real mouse at another point restore the editor cursor", () => {
		expect(
			isPenCompatMouseMove({
				now: 1050,
				lastPenHoverAt: 1000,
				mouseX: 450,
				mouseY: 300,
				penX: 400,
				penY: 300,
			})
		).toBe(false);
	});

	it("lets a later mouse move restore the editor cursor at the same point", () => {
		expect(
			isPenCompatMouseMove({
				now: 1201,
				lastPenHoverAt: 1000,
				mouseX: 400,
				mouseY: 300,
				penX: 400,
				penY: 300,
			})
		).toBe(false);
	});
});

describe("the cursors have to be shown with a real display value", () => {
	// Both cursors sat at display:none in the stylesheet and were "shown"
	// with setCssStyles({ display: "" }). An empty string REMOVES the inline
	// declaration, so the element fell back to the stylesheet and neither the
	// pen reticle nor the eraser ring ever appeared on screen. They were
	// positioned and sized correctly every frame, invisibly.
	const source = overlaySource();

	it("never uses an empty display string to reveal a cursor", () => {
		// Code, not text. The anti-vacuity count below is the half comments
		// used to prop up: read raw, two `// was: …` lines kept it above zero
		// over an overlay with no reveal sites left at all.
		const showBlocks = cursorStyleBlocks(source);
		expect(showBlocks.length).toBeGreaterThan(0);
		for (const block of showBlocks) {
			if (!block.includes("display")) continue;
			expect(block).not.toMatch(/display:\s*""/);
		}
	});

	it("keeps the stylesheet default that made the bug possible", () => {
		// If this rule ever goes away the empty-string form would start
		// working by accident, which is worse than failing loudly. Read from
		// the cascade, and from the pen cursor's own rule rather than from
		// anywhere in a sheet that declares `display: none` twelve times.
		expect(penCursorDefaultsToHidden(css)).toBe(true);
	});
});

/**
 * A PAN DRAG PAINTS NO RETICLE (alan, 2026-09-05, hardware: "pan reticle
 * allows you to like fling it away from the point of pan and it flickers").
 *
 * The rule is pure and lives in this module because the thing that used to
 * carry it - three call sites inside `InkOverlay` - cannot be unit-tested at
 * all: that file imports `obsidian`. `penReticleShown`'s own header carries
 * the mechanism (a rect frozen at pen-down, an overlay that scrolls out from
 * under it) and the ruling.
 */
describe("the pan drag's reticle rule", () => {
	it("shows the ring for a pan tip that is only hovering", () => {
		expect(penReticleShown("pan", false)).toBe(true);
	});

	it("refuses it once the pan drag is live", () => {
		expect(penReticleShown("pan", true)).toBe(false);
	});

	it("leaves every other tip alone, dragging or not", () => {
		// The reversal is the pan's alone. Lasso and space persistence
		// through a drag is real and is what `GestureReticlePersists.test.ts`
		// is named for; the eraser drives its own element entirely.
		for (const tip of ["nib", "eraser", "lasso", "space"] as const) {
			expect(penReticleShown(tip, true), `${tip} lost its reticle to the pan rule`).toBe(true);
			expect(penReticleShown(tip, false)).toBe(true);
		}
	});
});

describe("the pan drag's move handler positions nothing, and the hand is on the scroller", () => {
	it("penRaw's pan branch scrolls and does not touch the reticle", () => {
		// BOTH ENDS. The positive half proves the slice really is the move
		// handler - `panMove` is the line that scrolls the overlay out from
		// under the frozen rect, which is what made the ring fly - and the
		// negative half is the rule: nothing in here positions a cursor.
		const branch = panMoveBranch(overlaySrc);

		expect(branch, "the slice is not penRaw's pan branch at all").toContain(
			"this.panMove(ev)"
		);
		expect(branch, "a reticle call came back into the pan drag's move handler").not.toMatch(
			/show\w*Cursor\(/
		);
		expect(branch, "the pan drag's move handler writes the reticle element").not.toContain(
			"penCursorEl"
		);
	});

	it("the overlay both puts the grabbing hand on and takes it off", () => {
		// Also both ends: a class added and never removed strands
		// `cursor: grabbing` on the scroller for the rest of the session.
		const source = overlaySource();

		expect(source).toContain("classList.add(PAN_DRAG_CLASS)");
		expect(source, "nothing takes the grabbing hand off again").toContain(
			"classList.remove(PAN_DRAG_CLASS)"
		);
	});

	it("the stylesheet gives the drag a cursor, and the rule that makes it necessary is still there", () => {
		// Hiding the reticle without this leaves the surface with NO pointer
		// at all - `cursor: none` over a hidden ring - which is the defect the
		// third suite of GestureReticlePersists.test.ts was written for, on a
		// different edge. Both halves are read from their own rule rather than
		// from anywhere in a sheet that mentions `cursor` many times over.
		expect(scrollerCursorFor(css, PAN_DRAG_CLASS)).toBe("grabbing");
		expect(scrollerCursorFor(css, PEN_HOVER_CLASS)).toBe("none");
	});

	it("and the pdf surface carries the same ruling, class for class", () => {
		// THE OTHER SURFACE, ASSERTED HERE rather than in a pdf test, because
		// the scanner and the ruling both live in this file and this project's
		// most expensive recurring defect is a ruling that reached one ink
		// surface and not another - which is exactly what happened to this
		// one. 1.4.12-design §11: "the pan-drag reticle
		// fix is note-only, the pdf pan still paints the ring per sample via
		// `showPanCursor` and never wears the grabbing hand".
		//
		// The class is spelled rather than imported: the pdf surface names its
		// cursor classes as literals throughout (`handwriting-pdf-hover` and
		// the three mode rings), so there is no constant to import and
		// inventing one for this alone would leave the file's other five
		// unguarded.
		expect(scrollerCursorFor(css, "handwriting-pdf-pan-drag")).toBe("grabbing");
		expect(scrollerCursorFor(css, "handwriting-pdf-hover")).toBe("none");
		// Both ends again: a class added and never removed strands `cursor:
		// grabbing` over the viewer for the rest of the session.
		const pdf = codeOnly(pdfSrc);
		expect(pdf).toContain('classList.add("handwriting-pdf-pan-drag")');
		expect(pdf, "nothing takes the grabbing hand off the pdf viewer again").toContain(
			'classList.remove("handwriting-pdf-pan-drag")'
		);
		// And the gate, called rather than re-implemented: it is the reason a
		// mid-drag `showCursor` from anywhere cannot put the ring back.
		expect(pdf, "the pdf surface decides the pan reticle rule for itself").toContain(
			"penReticleShown(tipMode(), this.panLast !== null)"
		);
	});
});

describe("both scans read code, not the sentences beside it", () => {
	// Fixtures. Without them a green run above is only a coincidence, which is
	// the failure this whole family is named for.
	const REVEAL = '\t\tthis.penCursorEl.setCssStyles({\n\t\t\tdisplay: "block",\n\t\t});\n';

	it("finds a real reveal site", () => {
		// Anti-vacuity for the fixtures themselves.
		expect(cursorStyleBlocks(REVEAL)).toHaveLength(1);
	});

	it("still catches a real reveal site using the empty-string form", () => {
		// The assertion's original job, unchanged by reading code.
		const buggy = '\t\tthis.penCursorEl.setCssStyles({ display: "" });\n';
		expect(cursorStyleBlocks(buggy)[0]).toMatch(/display:\s*""/);
	});

	it("does NOT count a reveal site that survives only as a comment", () => {
		// THE DEFEAT, verbatim: the shape a refactor leaves behind.
		const moved =
			'\t\t// moved into hideCursorEl(); was:\n\t\t//   this.penCursorEl.setCssStyles({ display: "none" })\n\t\tthis.hideCursorEl(this.penCursorEl);\n';
		expect(cursorStyleBlocks(moved)).toEqual([]);
	});

	it("does NOT fire on a comment that quotes the buggy form while explaining it", () => {
		// The loud direction, and the likeliest comment anyone would write
		// here: the fix's own explanation contains the thing it forbids.
		const explained =
			'\t/**\n\t * Both cursors were "shown" with setCssStyles({ display: "" }), which\n\t * REMOVES the declaration, so they fell back to display: none.\n\t */\n';
		expect(cursorStyleBlocks(explained)).toEqual([]);
	});

	it("does NOT accept a retired copy of the stylesheet default", () => {
		const live = ".handwriting-pen-cursor,\n.handwriting-eraser-cursor {\n\tdisplay: none;\n}\n";
		expect(penCursorDefaultsToHidden(live)).toBe(true);
		expect(penCursorDefaultsToHidden(`/*\n${live}*/\n`)).toBe(false);
	});

	it("does NOT accept a display: none belonging to some other rule", () => {
		// The second defect, pinned: the pattern this replaced spanned the
		// whole sheet, and styles.css declares display: none twelve times.
		const elsewhere =
			".handwriting-pen-cursor {\n\tposition: absolute;\n}\n\n.handwriting-whats-new {\n\tdisplay: none;\n}\n";
		expect(penCursorDefaultsToHidden(elsewhere)).toBe(false);
		expect(/\.handwriting-pen-cursor[\s\S]*?display:\s*none/.test(elsewhere)).toBe(true);
	});

	it("does NOT accept it from a hover-state rule that merely extends the class", () => {
		const hoverOnly = ".handwriting-pen-cursor.handwriting-pen-hover-space {\n\tdisplay: none;\n}\n";
		expect(penCursorDefaultsToHidden(hoverOnly)).toBe(false);
	});

	// Fixtures for the pan-drag scans, same job as the four above: a green
	// source assertion is only worth what its finder is worth.
	const PEN_RAW = (panBody: string): string =>
		[
			"\tprivate penRaw(samples: PenSample[], ev: PointerEvent): void {",
			'\t\tif (this.mode === "lasso") {',
			"\t\t\tthis.lassoMove(samples);",
			"\t\t\tif (last) this.showLassoCursor(last);",
			"\t\t\treturn;",
			"\t\t}",
			'\t\tif (this.mode === "pan") {',
			panBody,
			"\t\t\treturn;",
			"\t\t}",
			"\t}",
		].join("\n");

	it("slices the pan branch and not the lasso branch above it", () => {
		// The neighbour matters: the lasso branch legitimately paints a
		// reticle, sits immediately above, and would fail the rule if the
		// slice reached back over it.
		const branch = panMoveBranch(PEN_RAW("\t\t\tthis.panMove(ev);"));

		expect(branch).toContain("this.panMove(ev)");
		expect(branch).not.toContain("showLassoCursor");
	});

	it("still catches a reticle call put back into the pan branch", () => {
		const buggy = panMoveBranch(PEN_RAW("\t\t\tthis.panMove(ev);\n\t\t\tthis.showPanCursor(last);"));

		expect(buggy).toMatch(/show\w*Cursor\(/);
	});

	it("does NOT fire on a comment in the pan branch that names the old call", () => {
		// The loud direction again, and the comment this fix actually left in
		// the overlay: it explains the ring by naming what used to draw it.
		const explained = panMoveBranch(
			PEN_RAW("\t\t\t// no showPanCursor here any more; see penReticleShown\n\t\t\tthis.panMove(ev);")
		);

		expect(explained).not.toMatch(/show\w*Cursor\(/);
	});

	it("THROWS rather than passing vacuously when the branch cannot be found", () => {
		// An empty slice would satisfy every "does not contain" above.
		expect(() => panMoveBranch("const nothing = 1;\n")).toThrow(/penRaw/);
		expect(() =>
			panMoveBranch('\tprivate penRaw(): void {\n\t\tif (this.mode === "erase") {\n\t\t}\n\t}')
		).toThrow(/pan branch/);
	});

	it("reads a scroller cursor from its own rule and nowhere else", () => {
		const sheet =
			".cm-scroller.handwriting-pan-drag,\n.cm-scroller.handwriting-pan-drag * {\n\tcursor: grabbing;\n}\n";
		expect(scrollerCursorFor(sheet, "handwriting-pan-drag")).toBe("grabbing");
		expect(scrollerCursorFor(sheet, "handwriting-pen-hover")).toBe(null);
		// Retired into a comment is not declared.
		expect(scrollerCursorFor(`/*\n${sheet}*/\n`, "handwriting-pan-drag")).toBe(null);
		// And a neighbouring rule's cursor is not this rule's.
		expect(
			scrollerCursorFor(`.something-else {\n\tcursor: grabbing;\n}\n`, "handwriting-pan-drag")
		).toBe(null);
	});
});
