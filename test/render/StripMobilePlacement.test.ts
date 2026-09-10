/**
 * ISSUE #10, IN A REAL LAYOUT ENGINE.
 *
 * The reported phone has host controls over both extremes of the editor. The
 * old two-row model can therefore offer only a top placement intersecting the
 * header or a bottom placement intersecting the floating navigation bar. This
 * fixture makes both collisions positive controls, then measures the new
 * middle row under the real stylesheet at the report's phone-like viewport.
 *
 * The boxes standing in for host chrome are parameters, not an assertion
 * about Obsidian's DOM. Hardware remains the final check for Samsung WebView
 * safe-area reporting and touch feel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openMobileChrome, type Browser } from "./harness";

let browser: Browser;

beforeAll(async () => {
	browser = await launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
});

describe("the mobile toolbar has a usable row between host chrome", () => {
	it("reproduces both extremes, then keeps all three middle anchors clear", async () => {
		const mobile = await openMobileChrome(browser);
		try {
			const top = await mobile.probe("top-right");
			expect(top.viewport).toEqual({ width: 360, height: 780, dpr: 3 });
			expect(top.hitsHeader, "the top collision control is inert").toBe(true);
			expect(top.hitsBottomNav).toBe(false);

			const bottom = await mobile.probe("bottom-right");
			expect(bottom.hitsHeader).toBe(false);
			expect(bottom.hitsBottomNav, "the bottom collision control is inert").toBe(true);

			// At 360 CSS px the real overflow plan renders a 218px strip. The
			// outer columns use the stylesheet's 8px inset; the centre column
			// uses the full pane's midpoint rather than either remaining gap.
			for (const corner of ["middle-left", "middle-center", "middle-right"] as const) {
				const probe = await mobile.probe(corner);
				expect(probe.hitsHeader, corner).toBe(false);
				expect(probe.hitsBottomNav, corner).toBe(false);
				expect(probe.pane.right - probe.pane.left, `${corner} pane width`).toBeCloseTo(360, 1);
				expect(probe.strip.right - probe.strip.left, `${corner} strip width`).toBeCloseTo(
					218,
					1
				);
				if (corner === "middle-left") {
					expect(probe.strip.left, corner).toBeCloseTo(probe.pane.left + 8, 1);
				} else if (corner === "middle-center") {
					expect((probe.strip.left + probe.strip.right) / 2, corner).toBeCloseTo(
						(probe.pane.left + probe.pane.right) / 2,
						1
					);
				} else {
					expect(probe.strip.right, corner).toBeCloseTo(probe.pane.right - 8, 1);
				}
				expect(probe.strip.left, corner).toBeGreaterThanOrEqual(probe.pane.left);
				expect(probe.strip.right, corner).toBeLessThanOrEqual(probe.pane.right);
				expect(probe.strip.top, corner).toBeGreaterThanOrEqual(probe.pane.top);
				expect(probe.strip.bottom, corner).toBeLessThanOrEqual(probe.pane.bottom);
				expect((probe.strip.top + probe.strip.bottom) / 2, corner).toBeCloseTo(
					(probe.pane.top + probe.pane.bottom) / 2,
					1
				);
			}

			// The collapsed form is 34px wide and uses the mobile pill's
			// concentric 15px side inset, while the centre remains pane-centred.
			for (const corner of ["middle-left", "middle-center", "middle-right"] as const) {
				const probe = await mobile.probe(corner, true);
				expect(probe.hitsHeader, `${corner} pill`).toBe(false);
				expect(probe.hitsBottomNav, `${corner} pill`).toBe(false);
				expect(probe.strip.right - probe.strip.left, `${corner} pill width`).toBeCloseTo(34, 1);
				expect(probe.strip.bottom - probe.strip.top, `${corner} pill height`).toBeCloseTo(34, 1);
				if (corner === "middle-left") {
					expect(probe.strip.left, `${corner} pill`).toBeCloseTo(probe.pane.left + 15, 1);
				} else if (corner === "middle-center") {
					expect((probe.strip.left + probe.strip.right) / 2, `${corner} pill`).toBeCloseTo(
						(probe.pane.left + probe.pane.right) / 2,
						1
					);
				} else {
					expect(probe.strip.right, `${corner} pill`).toBeCloseTo(probe.pane.right - 15, 1);
				}
				expect(probe.strip.left, `${corner} pill`).toBeGreaterThanOrEqual(probe.pane.left);
				expect(probe.strip.right, `${corner} pill`).toBeLessThanOrEqual(probe.pane.right);
				expect(probe.strip.top, `${corner} pill`).toBeGreaterThanOrEqual(probe.pane.top);
				expect(probe.strip.bottom, `${corner} pill`).toBeLessThanOrEqual(probe.pane.bottom);
				expect((probe.strip.top + probe.strip.bottom) / 2, `${corner} pill`).toBeCloseTo(
					(probe.pane.top + probe.pane.bottom) / 2,
					1
				);
			}
		} finally {
			await mobile.close();
		}
	}, 120_000);
});
