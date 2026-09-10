/**
 * THE IPHONE'S GIANT TWO-COLUMN TOOLBAR, reproduced from release 1.4.12.
 *
 * Obsidian can run a community plugin's JavaScript before its stylesheet has
 * settled. MobileTools measured synchronously in its constructor and watched
 * only the parent afterward. Under host CSS alone, the accessible text inside
 * the collapse button is still in flow, so the button measures about 175px;
 * that number is cached in `--hw-strip-cell`. Loading Handwriting's CSS makes
 * the visible button 40px square but does not resize the absolutely positioned
 * toolbar's parent, leaving two 175px grid tracks across a 393px phone.
 *
 * The fixture deliberately loads the real plugin stylesheet late. It keeps
 * only the host sizing rules that contribute to the poisoned measurement;
 * `harness.ts` preserves host-before-plugin cascade order. The final boxes are
 * the browser's, at the reporter screenshot's exact viewport and DPR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	hostFixture,
	launch,
	openMobileChrome,
	type Browser,
	type BrowserEngine,
} from "./harness";

describe.each(["chromium", "webkit"] satisfies BrowserEngine[])(
	"the mobile toolbar when its stylesheet arrives after construction in %s",
	(engine) => {
		let browser: Browser;

		beforeAll(async () => {
			browser = await launch(engine);
		}, 120_000);

		afterAll(async () => {
			await browser?.close();
		});

		it("replans from the host-sized label box to five square phone columns", async () => {
			const mobile = await openMobileChrome(browser, {
				platform: "ios",
				width: 393,
				height: 852,
				latePluginCss: true,
				hostCss: hostFixture("obsidian-1.13.7-mobile-button.css"),
			});
			try {
				// Do not call the public placement/collapse setters: both legitimately
				// re-run overflow layout and would conceal a startup cache that stayed
				// poisoned until the user's first interaction.
				const probe = await mobile.probeCurrent();
				expect(probe.viewport).toEqual({ width: 393, height: 852, dpr: 3 });
				// Prove the fixture reached the reported bad state before the plugin
				// stylesheet settled: two oversized tracks measured from label text.
				expect(probe.grid.startupButtonWidth).toBeGreaterThan(100);
				expect(probe.grid.startupCell).toBe(
					`${Math.round(probe.grid.startupButtonWidth ?? 0)}px`
				);
				expect(probe.grid.startupColumns).toBe("2");
				// The visible control has settled. This positive control prevents a
				// green result caused by the late stylesheet never loading.
				expect(probe.grid.buttonWidth).toBeCloseTo(40, 1);
				expect(probe.grid.buttonHeight).toBeCloseTo(40, 1);
				// The cached tracks must settle with it. With the full Obsidian sheet,
				// release 1.4.12 stays at `2` / `175px` / 360px; this reduced host
				// fixture preserves that same two-column failure mechanism.
				expect(probe.grid.cell).toBe("40px");
				expect(probe.grid.columns).toBe("5");
				expect(probe.strip.right - probe.strip.left).toBeCloseTo(218, 1);
			} finally {
				await mobile.close();
			}
		}, 120_000);
	}
);
