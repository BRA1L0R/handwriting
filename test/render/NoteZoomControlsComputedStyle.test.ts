/**
 * A computed-style check that `.handwriting-note-viewport-controls.is-inking`
 * resolves to `opacity: 0` and `visibility: hidden` under the real
 * stylesheet, and that "hide" resolves to `display: none` with no button
 * able to take focus. The unit suite (`MobileTools.test.ts`) has no real CSS
 * engine (`FakeEl` is a class-list stand-in), so this is the only place
 * either resolves.
 *
 * The baseline fact - that the group EXISTS at all when `noteViewport` is set
 * - is asserted first, since `MobileTools.test.ts`'s own `fakeHost()` (line
 * 132) never sets it and nothing else in this repo built this group before.
 *
 * Each test opens its own page (a fresh bundle, so fresh module state - no
 * Node-side reset can reach a browser page's own module instance, and none
 * is needed here) and closes it in `afterEach`, not `afterAll`: a page left
 * open past its own test leaks a browser tab per test in this file.
 *
 * Run: npm run test:render. Deliberately NOT in `npx vitest run` - see
 * `harness.ts` for what this can and cannot answer.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { launch, openNoteZoomStrip, type NoteZoomHarness } from "./harness";

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
});
afterAll(async () => {
	await browser?.close();
});

describe("note zoom controls, computed style", () => {
	let h: NoteZoomHarness;
	beforeEach(async () => {
		h = await openNoteZoomStrip(browser);
	});
	afterEach(async () => {
		await h?.close();
	});

	// BASELINE, on a real engine. Everything below is meaningless without
	// this.
	it("the group exists when noteViewport is set", async () => {
		const r = await h.probe({ mode: "auto", inking: false });
		expect(r.exists).toBe(true);
		expect(r.buttonCount).toBe(4);
		expect(r.firstButtonFocusable).toBe(true);
	});

	// The actual computed values, not just the class name.
	it("auto + inking resolves to opacity 0, visibility hidden", async () => {
		const at_rest = await h.probe({ mode: "auto", inking: false });
		expect(at_rest.opacity).toBe("1");
		expect(at_rest.visibility).toBe("visible");
		const inking = await h.probe({ mode: "auto", inking: true });
		expect(inking.opacity).toBe("0");
		expect(inking.visibility).toBe("hidden");
	});

	it("show never steps aside, even while inking", async () => {
		const r = await h.probe({ mode: "show", inking: true });
		expect(r.opacity).toBe("1");
		expect(r.visibility).toBe("visible");
	});

	// Hide is display:none, which is what actually makes "no zoom button may
	// be focusable or announced" true - a display:none ancestor removes
	// every descendant from the tab order and the accessibility tree without
	// touching the DOM (the nodes are still there; querySelectorAll would
	// still find them - the browser's own focus algorithm is the honest
	// check, not a node count).
	it("hide is display:none and no zoom button can take focus", async () => {
		const r = await h.probe({ mode: "hide", inking: false });
		expect(r.display).toBe("none");
		expect(r.buttonCount).toBe(4);
		expect(r.firstButtonFocusable).toBe(false);
	});
});
