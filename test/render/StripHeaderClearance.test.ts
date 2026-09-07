/**
 * ITEM 5, MEASURED: the strip does not sit on the pane's three-dots menu.
 *
 * "the current chevron covers up the 3 settings dots on a pdf page" (alan,
 * 2026-09-05, on an Orion). This is the only assertion in the repo that can
 * answer that with a number rather than with a source match - the boxes are
 * the browser's, from the real `MobileTools` under the real `styles.css`.
 *
 * Every case below reads `wouldOverlap` as well as `overlaps`: the probe
 * measures the strip a second time with its dodge removed, so a green run
 * distinguishes a strip that MOVED out of the way from one that was never in
 * the way. Without that, these tests would pass just as happily against a
 * build with no fix in it.
 *
 * WHAT THIS CAN ANSWER
 *   - whether the strip's rendered box intersects a `.view-actions` box laid
 *     out where Obsidian lays one out, with and without the fix
 *   - that the fix moves the strip ONLY where there is a collision, so the
 *     note surface and the bottom corners are left where they were
 *   - that both branches work: sideways where there is room beside the
 *     actions, and below the header where there is not
 *   - that the collapsed pill is moved too, which is the state a phone is
 *     actually in while writing
 *   - that the dodge does not compound across repeated passes
 *
 * WHAT THIS CANNOT ANSWER
 *   - anything about Obsidian. `.view-actions`, and the header geometry
 *     around it, are rebuilt in `stripPage.ts#buildLeaf` from the class names
 *     the app uses. If Obsidian renames that element or moves it out of the
 *     header, this page goes on passing while the plugin stops working. The
 *     real acceptance is Alan's screen.
 *   - anything about iOS or Android. This is desktop Chromium.
 *   - the safe-area insets, which resolve to 0 here and are a real term in
 *     the corner rules on a notched phone.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openLeaf, type Browser, type LeafOptions } from "./harness";

let browser: Browser;

beforeAll(async () => {
	browser = await launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
});

/** A phone-ish pane, where the strip is most of the pane wide. */
const PHONE = 420;
/** A desktop pane, where the strip is a small part of the width. */
const DESKTOP = 1200;

const base: LeafOptions = {
	header: true,
	corner: "top-right",
	collapsed: false,
	width: DESKTOP,
};

/** Run one case and hand the probe back, closing the page either way. */
async function measure(
	over: Partial<LeafOptions>
): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof openLeaf>>["probe"]>>> {
	const opts = { ...base, ...over };
	const leaf = await openLeaf(browser, opts);
	try {
		return await leaf.probe();
	} finally {
		await leaf.close();
	}
}

describe("the pdf arrangement: the strip mounts on the leaf, header and all", () => {
	// THE DEFECT, and the sideways branch. On a desktop pane there is room to
	// the left of the actions row for the whole strip, so it slides there and
	// stays on the line the corner setting put it on.
	it("slides left of the actions row where there is room beside them", async () => {
		const probe = await measure({ width: DESKTOP });
		expect(probe.wouldOverlap, "the defect reproduces without the fix").toBe(true);
		expect(probe.overlaps, "the strip sits on the pane's three-dots").toBe(false);
		// Left of them, not merely somewhere else.
		expect(probe.strip.right).toBeLessThanOrEqual(probe.actions.left);
		// And still on the header's line: this branch does not drop it.
		expect(probe.strip.top).toBeCloseTo(probe.undodged.top, 1);
	}, 120_000);

	// THE OTHER BRANCH, and the one a phone takes. A full strip is most of a
	// handset wide, so there is no room beside a right-aligned actions row -
	// the first version of this rule shifted it anyway and walked it off the
	// left edge of the pane, where it no longer covered the dots and was no
	// longer reachable either.
	it("drops below the actions row where there is no room beside them", async () => {
		const probe = await measure({ width: PHONE });
		expect(probe.wouldOverlap).toBe(true);
		expect(probe.overlaps).toBe(false);
		// Below, not beside.
		expect(probe.strip.top).toBeGreaterThanOrEqual(probe.actions.bottom);
		// AND STILL ON THE PANE. This is the assertion the first draft of the
		// rule failed while reporting no overlap.
		expect(probe.strip.left).toBeGreaterThanOrEqual(0);
		expect(probe.strip.right).toBeLessThanOrEqual(PHONE);
	}, 120_000);

	// The state a phone is actually in while writing: collapsed to the pill.
	// The pill is 34px, so it fits beside the actions even on a handset -
	// this is the sideways branch at phone width.
	it("moves the collapsed pill, which is what covers the dots while writing", async () => {
		const probe = await measure({ width: PHONE, collapsed: true });
		expect(probe.wouldOverlap, "the pill covers the dots without the fix").toBe(true);
		expect(probe.overlaps).toBe(false);
		expect(probe.strip.right).toBeLessThanOrEqual(probe.actions.left);
	}, 120_000);

	// A narrow pane puts even a LEFT-corner strip under a right-aligned
	// actions row, because the strip is wider than the gap between them. It
	// is moved for the same reason and by the same rule - the fix is driven
	// by where the boxes are, not by which corner was chosen.
	it("clears them from a top-LEFT corner too, when the pane is narrow", async () => {
		const probe = await measure({ width: PHONE, corner: "top-left" });
		expect(probe.wouldOverlap).toBe(true);
		expect(probe.overlaps).toBe(false);
	}, 120_000);

	// ...and is left alone in that corner as soon as there is room, which is
	// the half that keeps this from being "always move the strip".
	it("leaves a top-LEFT strip alone on a pane wide enough for both", async () => {
		const probe = await measure({ width: DESKTOP, corner: "top-left" });
		expect(probe.wouldOverlap).toBe(false);
		expect(probe.overlaps).toBe(false);
		expect(probe.transform === "none" || probe.transform === "").toBe(true);
	}, 120_000);

	// The corner furthest from the header. Nothing to dodge, nothing moved -
	// at either width, because the collision is vertical and this corner has
	// no vertical overlap at all.
	it("leaves a bottom-right strip alone at any width", async () => {
		for (const width of [PHONE, DESKTOP]) {
			const probe = await measure({ width, corner: "bottom-right" });
			expect(probe.wouldOverlap, `at ${width}px`).toBe(false);
			expect(probe.transform === "none" || probe.transform === "").toBe(true);
		}
	}, 120_000);

	/**
	 * THE COMPOUNDING BUG this is written to make impossible. The dodge is a
	 * transform, and a pass that measured the ALREADY-SHIFTED box would shift
	 * it again - and again on every resize, until the strip walked off the
	 * pane. `applyHeaderClearance` clears the transform before it measures;
	 * this is the assertion that it does.
	 */
	it("does not compound when the clearance runs a second time", async () => {
		const leaf = await openLeaf(browser, { ...base, width: PHONE });
		try {
			const once = await leaf.probe();
			await leaf.reapply();
			const twice = await leaf.probe();
			expect(twice.strip.left).toBeCloseTo(once.strip.left, 1);
			expect(twice.strip.top).toBeCloseTo(once.strip.top, 1);
			expect(twice.overlaps).toBe(false);
		} finally {
			await leaf.close();
		}
	}, 120_000);
});

describe("the note arrangement: the strip mounts inside the content area", () => {
	// The reason the fix is a measurement and not a constant. A note's strip
	// is already below the header - InkOverlay's `chromeHost` uses
	// `view.dom.parentElement`, inside `.view-content` - so moving it would
	// be moving chrome that was never in the way, and the "Toolbar corner"
	// setting would stop meaning what it says.
	it("never meets the actions row, at either width, and is not moved", async () => {
		for (const width of [PHONE, DESKTOP]) {
			const probe = await measure({ width, header: false });
			expect(probe.wouldOverlap, `at ${width}px`).toBe(false);
			expect(probe.overlaps).toBe(false);
			// Below the header, which is WHY it does not overlap.
			expect(probe.strip.top).toBeGreaterThanOrEqual(probe.actions.bottom);
			expect(probe.transform === "none" || probe.transform === "").toBe(true);
		}
	}, 120_000);
});
