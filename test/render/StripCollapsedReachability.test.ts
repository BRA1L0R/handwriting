/**
 * A collapsed ordinary-note toolbar must leave a reachable way back.
 *
 * Obsidian's mobile header can float over the note content. InkOverlay mounts
 * MobileTools inside that content, while `.view-actions` is a sibling in the
 * leaf header. The wide strip remains partly visible under such chrome; its
 * 34px top-right pill can fit wholly behind the actions and look as though it
 * disappeared. This fixture models that DOM relationship and lets the browser
 * decide what a real hit at the pill's centre reaches.
 *
 * The header geometry is modeled evidence, not a measurement from Alan's
 * iPhone. A physical-device check remains required for the final beta.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openLeaf, type Browser, type BrowserEngine } from "./harness";

describe.each(["chromium", "webkit"] satisfies BrowserEngine[])(
	"the ordinary-note collapsed toolbar under overlaid mobile chrome in %s",
	(engine) => {
		let browser: Browser;

		beforeAll(async () => {
			browser = await launch(engine);
		}, 120_000);

		afterAll(async () => {
			await browser?.close();
		});

		it("keeps the top-right pill hit-reachable and its tap restores the strip", async () => {
			const note = await openLeaf(browser, {
				header: false,
				overlayHeader: true,
				platform: "ios",
				corner: "top-right",
				collapsed: true,
				width: 393,
			});
			try {
				const geometry = await note.probe();
				const state = await note.page.evaluate(() => {
					const pill = document.querySelector<HTMLElement>(".handwriting-pen-pill");
					const actions = document.querySelector<HTMLElement>(".view-actions");
					if (!pill || !actions) throw new Error("the note chrome fixture is incomplete");
					const p = pill.getBoundingClientRect();
					const x = (p.left + p.right) / 2;
					const y = (p.top + p.bottom) / 2;
					const hit = document.elementFromPoint(x, y);
					return {
						hitIsPill: hit !== null && pill.contains(hit),
					};
				});

				// Positive control: the undodged boxes occupy the same top-right
				// pixels, so hit reachability is a meaningful verdict.
				expect(geometry.wouldOverlap).toBe(true);
				expect(state.hitIsPill, "host actions receive the pill-centre hit").toBe(true);

				await note.page.locator(".handwriting-pen-pill").click();
				const reopened = await note.page.evaluate(() => ({
					stripDisplay: getComputedStyle(
						document.querySelector<HTMLElement>(".handwriting-mobile-tools")!
					).display,
					pillDisplay: getComputedStyle(
						document.querySelector<HTMLElement>(".handwriting-pen-pill")!
					).display,
				}));
				expect(reopened.stripDisplay).not.toBe("none");
				expect(reopened.pillDisplay).toBe("none");
			} finally {
				await note.close();
			}
		}, 120_000);
	}
);
