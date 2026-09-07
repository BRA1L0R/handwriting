/**
 * THE STYLESHEET ASSERTION READS CODE, NOT THE STYLESHEET'S TEXT.
 *
 * This is the cleanest instance of the comment-satisfies-a-guard family in the
 * repo: the needle is a GENERATED CLASS NAME, and a name is exactly what a
 * comment spells while explaining the rule that carries it. Read raw, a
 * sentence naming `.handwriting-corner-bottom-left` proved the corner was
 * styled just as well as the rule that styles it did.
 *
 * Demonstrated on this branch rather than argued: all six real occurrences of
 * `handwriting-corner-bottom-left` were renamed to a typo - a rename that
 * missed the stylesheet, which is the ordinary way this arrives - and one
 * comment listing the four corner classes was added. All five tests here
 * passed. The suite did NOT: `CornerSafeArea.test.ts` drives off the same
 * constant and failed three assertions, so on today's tree this corner is
 * covered twice. That is luck rather than design - the sibling guard exists
 * for the iOS safe-area offsets, not for this - and it is exactly the cover a
 * NEWLY added corner would not have.
 *
 * `codeOnly` (src/CodeOnly.ts) is the shared stripper, imported not copied,
 * with its four fixtures in `InkSurfaceRules.test.ts` standing over it.
 * `styles.css` contains no `//` sequence at all (verified), so the
 * line-comment half cannot over-blank this input. Matching code can only find
 * FEWER classes, so no styled corner stops being seen; what stops being seen
 * is a corner that was only ever named in a sentence. No assertion in this
 * file pins a documented REASON, so none is left reading raw.
 */

import { describe, expect, it } from "vitest";
import { codeOnly } from "../CodeOnly";
import {
	DEFAULT_TOOLBAR_CORNER,
	TOOLBAR_CORNERS,
	TOOLBAR_CORNER_LABELS,
	collapseChevronGlyph,
	collapseChevronIcon,
	isMiddleAnchor,
	allToolbarCornerClasses,
	normalizeToolbarCorner,
	toolbarCornerClass,
} from "./ToolbarCorner";
import css from "../../styles.css?raw";

describe("ToolbarCorner", () => {
	it("offers six placements and defaults to the one that shipped", () => {
		expect(TOOLBAR_CORNERS).toHaveLength(6);
		expect(DEFAULT_TOOLBAR_CORNER).toBe("top-right");
	});

	// THE FOUR ORIGINAL VALUES ARE LOAD-BEARING: they are in every existing
	// data.json. Adding the middles must not rename one of them, or every
	// user's toolbar moves on upgrade and the normalise hands them the
	// default instead of what they chose.
	it("keeps the four original values exactly as they were persisted", () => {
		for (const corner of ["top-right", "top-left", "bottom-right", "bottom-left"] as const) {
			expect(TOOLBAR_CORNERS).toContain(corner);
			expect(normalizeToolbarCorner(corner)).toBe(corner);
		}
	});

	it("accepts the two middles, and labels them as middles", () => {
		expect(normalizeToolbarCorner("top-center")).toBe("top-center");
		expect(normalizeToolbarCorner("bottom-center")).toBe("bottom-center");
		const labels = new Map(TOOLBAR_CORNER_LABELS.map((r) => [r.value, r.label]));
		expect(labels.get("top-center")).toBe("Top middle");
		expect(labels.get("bottom-center")).toBe("Bottom middle");
		expect(isMiddleAnchor("top-center")).toBe(true);
		expect(isMiddleAnchor("bottom-center")).toBe(true);
		expect(isMiddleAnchor("top-right")).toBe(false);
	});

	// The dropdown is built from the labels, so a placement with no label is
	// a placement the user cannot reach, and a label with no placement is a
	// row that sets nothing.
	it("offers exactly one label per placement, in the same order", () => {
		expect(TOOLBAR_CORNER_LABELS.map((r) => r.value)).toEqual([...TOOLBAR_CORNERS]);
	});

	it("turns anything off disk into a real corner", () => {
		// Settings files get hand-edited, synced across versions and
		// truncated. An unknown value must not leave the strip unpositioned.
		expect(normalizeToolbarCorner("bottom-left")).toBe("bottom-left");
		expect(normalizeToolbarCorner("sideways")).toBe(DEFAULT_TOOLBAR_CORNER);
		expect(normalizeToolbarCorner(undefined)).toBe(DEFAULT_TOOLBAR_CORNER);
		expect(normalizeToolbarCorner(null)).toBe(DEFAULT_TOOLBAR_CORNER);
		expect(normalizeToolbarCorner(3)).toBe(DEFAULT_TOOLBAR_CORNER);
		expect(normalizeToolbarCorner({ corner: "top-left" })).toBe(DEFAULT_TOOLBAR_CORNER);
	});

	it("labels every corner exactly once, for the dropdown", () => {
		expect(TOOLBAR_CORNER_LABELS.map((o) => o.value).sort()).toEqual([...TOOLBAR_CORNERS].sort());
	});

	it("gives each corner its own class, and can list them all to clear", () => {
		const classes = allToolbarCornerClasses();
		expect(new Set(classes).size).toBe(TOOLBAR_CORNERS.length);
		for (const c of TOOLBAR_CORNERS) expect(classes).toContain(toolbarCornerClass(c));
	});

	it("every corner class actually exists in the stylesheet", () => {
		// The one that can rot: a corner nobody styled positions the strip
		// wherever it lands, which reads as a broken toolbar rather than as
		// a missing rule. Same guard the required-CSS packager check uses.
		//
		// Against the cascade, not the document. A corner named in a comment
		// is a corner nobody styled.
		const cssCode = codeOnly(css);
		for (const corner of TOOLBAR_CORNERS) {
			expect(cssCode).toContain(`.${toolbarCornerClass(corner)}`);
		}
	});
});

describe("the stylesheet check reads rules, not sentences", () => {
	// Fixtures, so a green run above is evidence. A guard whose only proof is
	// that it currently passes proves nothing.
	// The default corner rather than TOOLBAR_CORNERS[0]: an indexed read is
	// `ToolbarCorner | undefined` under noUncheckedIndexedAccess.
	const CLASS = toolbarCornerClass(DEFAULT_TOOLBAR_CORNER);

	it("accepts a real rule", () => {
		// Anti-vacuity: a stripper that blanked everything would pass both
		// negatives below while proving the opposite of what they claim.
		expect(codeOnly(`.handwriting-mobile-tools.${CLASS} { top: 0; }\n`)).toContain(`.${CLASS}`);
	});

	it("does NOT accept a comment that merely names the class", () => {
		// THE DEFEAT, verbatim.
		const named = `/* Corners get one positioning rule each: .${CLASS} and three more. */\n`;
		expect(codeOnly(named)).not.toContain(`.${CLASS}`);
	});

	it("does NOT accept a rule that has been commented out", () => {
		const retired = `/*\n.handwriting-mobile-tools.${CLASS} { top: 0; }\n*/\n`;
		expect(codeOnly(retired)).not.toContain(`.${CLASS}`);
	});
});

/**
 * WHICH WAY THE COLLAPSE CHEVRON POINTS.
 *
 * It names the edge the strip collapses INTO. A corner has two edges and the
 * horizontal one is the one that reads; a middle has only one, and it is
 * vertical. Pointing a top-middle strip's chevron sideways would name an edge
 * the strip is nowhere near - and before this rule existed it did exactly
 * that, because the mapping was a two-way `endsWith("left")` test and a
 * middle is neither.
 */
describe("collapseChevronIcon: the arrow names the edge the strip goes to", () => {
	it("points sideways for the four corners, as it always has", () => {
		expect(collapseChevronIcon("top-right")).toBe("chevron-right");
		expect(collapseChevronIcon("bottom-right")).toBe("chevron-right");
		expect(collapseChevronIcon("top-left")).toBe("chevron-left");
		expect(collapseChevronIcon("bottom-left")).toBe("chevron-left");
	});

	it("points at the edge for the two middles", () => {
		expect(collapseChevronIcon("top-center")).toBe("chevron-up");
		expect(collapseChevronIcon("bottom-center")).toBe("chevron-down");
	});

	it("has a glyph fallback for every placement, matching the icon", () => {
		const want: Record<string, string> = {
			"top-right": ">",
			"top-left": "<",
			"top-center": "^",
			"bottom-right": ">",
			"bottom-left": "<",
			"bottom-center": "v",
		};
		for (const corner of TOOLBAR_CORNERS) {
			expect(collapseChevronGlyph(corner), corner).toBe(want[corner]);
		}
	});
});
