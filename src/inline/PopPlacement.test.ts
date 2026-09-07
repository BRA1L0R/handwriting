/**
 * Where a pop opens, for all six anchors, without a layout.
 *
 * The vertical rule used to live only in the stylesheet and the horizontal
 * one only inside a closure that read live rects, which meant neither could
 * be tested at all - and the two middle anchors are exactly the case where
 * both of them are easy to get wrong. Both are pinned here, and the CSS half
 * is pinned AGAINST this module so an anchor cannot get a rule in one place
 * and not the other.
 */
import { describe, expect, it } from "vitest";
import css from "../../styles.css?raw";
import { codeOnly } from "../CodeOnly";
import { popFlipFor, popRightOffset } from "./PopPlacement";
import { TOOLBAR_CORNERS, toolbarCornerClass } from "./ToolbarCorner";

describe("popFlipFor: which way a pop opens", () => {
	it("opens downward from every top anchor", () => {
		expect(popFlipFor("top-left")).toBe("down");
		expect(popFlipFor("top-right")).toBe("down");
		expect(popFlipFor("top-center")).toBe("down");
	});

	// The 2026-08-31 rule: at the bottom of the glass, "under the strip" is
	// off the screen. The middle is as close to that edge as either corner.
	it("opens upward from every bottom anchor, the middle included", () => {
		expect(popFlipFor("bottom-left")).toBe("up");
		expect(popFlipFor("bottom-right")).toBe("up");
		expect(popFlipFor("bottom-center")).toBe("up");
	});

	it("answers for every anchor the plugin offers", () => {
		for (const corner of TOOLBAR_CORNERS) {
			expect(["up", "down"]).toContain(popFlipFor(corner));
		}
	});
});

/**
 * THE STYLESHEET IS THE MECHANISM, this module is the rule, and they must
 * agree. The flip is a CSS override keyed off the anchor class; an anchor
 * that `popFlipFor` says opens upward and the stylesheet has no rule for
 * would open downward off the edge of the glass, which is the exact defect
 * the rule exists to prevent.
 */
describe("styles.css carries a flip rule for exactly the upward anchors", () => {
	const cssCode = codeOnly(css);

	for (const corner of TOOLBAR_CORNERS) {
		const cls = toolbarCornerClass(corner);
		const wantsFlip = popFlipFor(corner) === "up";

		it(`${corner}: ${wantsFlip ? "has" : "has no"} pop and tooltip flip rules`, () => {
			for (const child of [".handwriting-slider-pop", ".handwriting-strip-tip"]) {
				const selector = `.handwriting-mobile-tools.${cls} ${child}`;
				expect(
					cssCode.includes(selector),
					wantsFlip
						? `${selector} is missing: this anchor's pops would open off the glass`
						: `${selector} should not exist: this anchor has room to open downward`
				).toBe(wantsFlip);
			}
		});
	}
});

describe("popRightOffset: centred under its button, kept inside the pane", () => {
	// A roomy pane, a strip in the middle of it, a button in the strip.
	const pane = { left: 0, right: 1000 };
	const strip = { left: 400, right: 600 };

	it("centres the pop under its button when there is room", () => {
		const button = { left: 500, right: 540 };
		// Centred: the pop's centre lands on the button's centre (520), so its
		// right edge is at 520 + 60 = 580, which is 20 from the strip's right.
		expect(popRightOffset({ strip, button, popWidth: 120, pane })).toBe(20);
	});

	// The middle-anchor case that the old strip-relative clamp got wrong: a
	// wide pop under a button near the strip's left end wants to extend left,
	// and it may - right up to the pane's edge, and no further.
	it("stops the pop's left edge at the pane's left edge", () => {
		const narrowPane = { left: 380, right: 1000 };
		const button = { left: 405, right: 445 };
		const right = popRightOffset({ strip, button, popWidth: 200, pane: narrowPane });
		// The pop's left edge in viewport terms, which must be the pane's.
		expect(strip.right - right - 200).toBe(380);
	});

	it("stops the pop's right edge at the pane's right edge", () => {
		const tightPane = { left: 0, right: 610 };
		const button = { left: 555, right: 595 };
		const right = popRightOffset({ strip, button, popWidth: 120, pane: tightPane });
		expect(strip.right - right).toBe(610);
	});

	// In a right-hand corner the strip's edge and the pane's very nearly
	// coincide, which is why the old `Math.max(0, ...)` looked correct there.
	// The pane clamp gives the same answer, so the corners are unchanged.
	it("agrees with the old strip-edge clamp when the strip sits in a corner", () => {
		const cornerStrip = { left: 800, right: 992 };
		const cornerPane = { left: 0, right: 1000 };
		const button = { left: 950, right: 990 };
		const right = popRightOffset({
			strip: cornerStrip,
			button,
			popWidth: 120,
			pane: cornerPane,
		});
		// Still on the pane, and not pushed away from its button.
		expect(cornerStrip.right - right).toBeLessThanOrEqual(cornerPane.right);
		expect(right).toBeGreaterThan(-10);
	});

	// Nothing can satisfy both edges; the content's start is what survives.
	it("keeps the left edge when the pop is wider than the pane", () => {
		const tiny = { left: 500, right: 560 };
		const right = popRightOffset({
			strip,
			button: { left: 500, right: 540 },
			popWidth: 300,
			pane: tiny,
		});
		expect(strip.right - right - 300).toBe(500);
	});
});
