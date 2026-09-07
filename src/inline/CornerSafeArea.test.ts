/**
 * The floating toolbar parks in a screen corner, and a phone's screen corners
 * are not all reachable: the top edge of a notched iphone is behind the
 * dynamic island and the bottom edge is the home indicator's swipe strip. A
 * control parked there is not merely ugly, it is untappable - the same class
 * of defect as the android notification shade (boox go 6, 2026-08-30), and
 * confirmed on hardware for ios (alan, iphone, 2026-09-02: "it's behind the
 * notch").
 *
 * The fix is an unconditional env() on every corner offset, and it is easy to
 * lose by accident, because three separate blocks re-declare `top`/`bottom`
 * for these elements and the last one to match wins. So this asserts the
 * stylesheet text directly - the pattern GuardStyle.test.ts already uses for
 * rules the code depends on but cannot observe in a unit test.
 *
 * What this canNOT prove: that ios actually reports a non-zero inset in
 * Obsidian's webview. That needs the device. It proves the stylesheet asks
 * for the inset everywhere it must, and that android's shade constant did
 * not get dragged along with it.
 */

import { describe, expect, it } from "vitest";
import css from "../../styles.css?raw";
import { TOOLBAR_CORNERS, isMiddleAnchor, toolbarCornerClass } from "./ToolbarCorner";

/** Comments hold commas and selector-shaped text; drop them before parsing. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, " ");

/** The declaration bodies of every rule whose selector list contains `selector`. */
function declarationsFor(selector: string): string[] {
	const out: string[] = [];
	for (const block of bare.match(/[^{}]+\{[^{}]*\}/g) ?? []) {
		const brace = block.indexOf("{");
		const selectors = block
			.slice(0, brace)
			.split(",")
			.map((s) => s.trim().replace(/\s+/g, " "));
		if (selectors.includes(selector)) out.push(block.slice(brace + 1, -1));
	}
	return out;
}

/** Which physical edge a corner is anchored to, and the inset that edge needs. */
function edgeOf(corner: string): "top" | "bottom" {
	return corner.startsWith("top") ? "top" : "bottom";
}

/**
 * The HORIZONTAL edge, which matters for the same reason and is easier to
 * forget: rotate a notched iphone and the island moves to a side, so
 * inset-top collapses and inset-left/right become the large ones. A fix that
 * wraps only the vertical offsets protects portrait and rotates away.
 */
function sideOf(corner: string): "left" | "right" {
	return corner.endsWith("right") ? "right" : "left";
}

/**
 * Every selector that sets a vertical offset for a corner, and the base
 * offset it is documented to use. The android rules are deliberately absent:
 * they are asserted separately, and they must NOT gain a second inset.
 */
function insetBearingSelectors(cls: string): Array<{ selector: string; base: number }> {
	return [
		// The strip and the pill share this one - both are listed on it.
		{ selector: `.handwriting-mobile-tools.${cls}`, base: 8 },
		{ selector: `.handwriting-pen-pill.${cls}`, base: 8 },
		// The pill re-declares the offset to sit concentric with the corner
		// button it replaces: 11px on desktop, 15px on mobile.
		{ selector: `.handwriting-pen-pill.${cls}`, base: 11 },
		{ selector: `.is-mobile .handwriting-pen-pill.${cls}`, base: 15 },
	];
}

describe("styles.css - toolbar corners clear the phone's unsafe edges", () => {
	for (const corner of TOOLBAR_CORNERS) {
		const cls = toolbarCornerClass(corner);
		const edge = edgeOf(corner);

		// A MIDDLE HAS NO SIDE. It is centred between both edges, so demanding
		// `left: env(safe-area-inset-left)` of it would be demanding the wrong
		// rule - and getting it would push the strip off centre by the inset.
		// The vertical requirement is unchanged, and it is the one that
		// matters most here: a notched phone's island is centred, which is
		// exactly where a top-middle strip sits.
		const axes = isMiddleAnchor(corner) ? [edgeOf(corner)] : [edgeOf(corner), sideOf(corner)];

		it.each(axes)(`${corner}: every rule that sets %s adds the safe-area inset`, (axis) => {
			const seen = new Set<string>();
			for (const { selector } of insetBearingSelectors(cls)) {
				if (seen.has(selector)) continue;
				seen.add(selector);

				const bodies = declarationsFor(selector);
				expect(bodies.length, `rule missing: ${selector}`).toBeGreaterThan(0);

				for (const body of bodies) {
					const decl = body.match(new RegExp(`(?:^|;)\\s*${axis}\\s*:([^;]*)`));
					expect(decl, `${selector} sets no ${axis}`).not.toBeNull();
					// A bare pixel offset here is the bug: it measures from the
					// screen edge, which on a notched phone is behind the chrome.
					expect(
						decl![1],
						`${selector} sets ${axis} from the raw screen edge, not the safe area`
					).toMatch(new RegExp(`env\\(\\s*safe-area-inset-${axis}\\s*,\\s*0px\\s*\\)`));
				}
			}
		});
	}

	// HOW the middles centre, pinned because the obvious way is the wrong
	// way here: `applyHeaderClearance` writes an inline `transform` on both
	// elements to dodge the pane's actions row, and it replaces the whole
	// property - so centring that lived in a CSS transform would be erased
	// the first time the strip dodged. Auto margins survive that, and leave
	// transform free for the dodge and for drag-to-anchor.
	it("the middles centre with auto margins, not with a transform", () => {
		for (const corner of TOOLBAR_CORNERS.filter((c) => isMiddleAnchor(c))) {
			const cls = toolbarCornerClass(corner);
			for (const selector of [
				`.handwriting-mobile-tools.${cls}`,
				`.handwriting-pen-pill.${cls}`,
			]) {
				const bodies = declarationsFor(selector);
				expect(bodies.length, `rule missing: ${selector}`).toBeGreaterThan(0);
				const body = bodies.join(";");
				expect(body, `${selector} does not pin both horizontal insets`).toMatch(
					/(?:^|;)\s*left\s*:\s*0/
				);
				expect(body, `${selector} does not pin both horizontal insets`).toMatch(
					/(?:^|;)\s*right\s*:\s*0/
				);
				expect(body, `${selector} does not centre with auto margins`).toMatch(
					/margin-left\s*:\s*auto/
				);
				expect(body, `${selector} does not centre with auto margins`).toMatch(
					/margin-right\s*:\s*auto/
				);
				expect(
					body,
					`${selector} centres with a transform, which applyHeaderClearance overwrites`
				).not.toMatch(/transform\s*:/);
			}
		}
	});

	// THE PILL IS A CIRCLE AT EVERY PLACEMENT, and only the middles could
	// ever have broken it. Centring sets `width: fit-content` so the STRIP
	// shrink-wraps and the auto margins have something to centre - but that
	// rule names the pill too, and there it beat the 34px circle and shrank
	// it to the width of the chevron inside: a 34px-tall ellipse under the
	// 50% radius (alan, 2026-09-05, on bottom middle: "the icon is all
	// squished"). The pill re-asserts its width AFTER that rule, so what
	// this pins is the LAST width to win, not the absence of any.
	it("the pill is still a circle at the middles, and the strip still shrink-wraps", () => {
		for (const corner of TOOLBAR_CORNERS.filter((c) => isMiddleAnchor(c))) {
			const cls = toolbarCornerClass(corner);

			// Document order, so the last declaration is the one that paints.
			const widths = declarationsFor(`.handwriting-pen-pill.${cls}`)
				.join(";")
				.match(/(?:^|;)\s*width\s*:\s*([^;]+)/g);
			expect(widths, `.handwriting-pen-pill.${cls} declares no width at all`).not.toBeNull();
			expect(
				widths![widths!.length - 1],
				`.handwriting-pen-pill.${cls} ends up shrink-wrapped, so its circle is an ellipse`
			).toMatch(/34px/);

			const strip = declarationsFor(`.handwriting-mobile-tools.${cls}`).join(";");
			expect(
				strip,
				`.handwriting-mobile-tools.${cls} must shrink-wrap or the auto margins centre nothing`
			).toMatch(/width\s*:\s*fit-content/);
		}
	});

	it("the inset is unconditional, not gated behind a platform class", () => {
		// env() is 0px wherever no inset is reported, so gating it would add a
		// branch that buys nothing and rots the moment a new platform ships.
		for (const corner of TOOLBAR_CORNERS) {
			const cls = toolbarCornerClass(corner);
			const bodies = declarationsFor(`.handwriting-mobile-tools.${cls}`);
			expect(bodies.length, `base strip rule missing for ${corner}`).toBe(1);
		}
		expect(bare).not.toMatch(/\.handwriting-ios\s+\.handwriting-(mobile-tools|pen-pill)/);
	});

	it("android keeps its notification-shade constants, and only on android", () => {
		// The 48/55 clear a pullable shade, which is an android interaction and
		// NOT a safe-area allowance. If these ever appear on a rule without the
		// android class, ios has been handed 48px it does not want.
		for (const [selector, expected] of [
			[".handwriting-android .handwriting-mobile-tools.handwriting-corner-top-right", 48],
			[".handwriting-android .handwriting-mobile-tools.handwriting-corner-top-left", 48],
			[".handwriting-android .handwriting-pen-pill.handwriting-corner-top-right", 55],
			[".handwriting-android .handwriting-pen-pill.handwriting-corner-top-left", 55],
		] as Array<[string, number]>) {
			const bodies = declarationsFor(selector);
			expect(bodies.length, `android rule missing: ${selector}`).toBeGreaterThan(0);
			const joined = bodies.join(";");
			expect(joined).toMatch(
				new RegExp(`top:\\s*calc\\(\\s*env\\(\\s*safe-area-inset-top\\s*,\\s*0px\\s*\\)\\s*\\+\\s*${expected}px\\s*\\)`)
			);
		}

		// The shade constants live nowhere else: every 48px/55px top offset in
		// the stylesheet must be under .handwriting-android.
		for (const block of bare.match(/[^{}]+\{[^{}]*\}/g) ?? []) {
			const brace = block.indexOf("{");
			const selector = block.slice(0, brace);
			const body = block.slice(brace + 1, -1);
			if (!/top:\s*calc\([^;]*\+\s*(48|55)px/.test(body)) continue;
			expect(selector, `shade constant outside android: ${selector.trim()}`).toMatch(
				/\.handwriting-android\b/
			);
		}
	});
});

/*
 * THE POP'S WIDTH IS DECLARED, and that is load-bearing.
 *
 * `hangUnder` re-centres the pop from its own measured `offsetWidth` on every
 * refresh, so whatever decides that width decides whether the pop sits still
 * under a dragging finger. It used to be decided by the pop's CONTENTS - the
 * pop had no width of its own, so it took its widest child's - and the two
 * things that made a child change width both moved the pop:
 *
 *   - the live value readout, which gained and lost a character as the number
 *     under the slider crossed a whole pixel ("like the slider is just
 *     vibrating", alan, hardware, 2026-09-02);
 *   - the preset row, which is 28px wider with four pens saved than with
 *     none, so starring a pen jumped the pop sideways.
 *
 * The readout was patched by padding its label to a constant character count
 * and pinning a monospace family so a serif theme could not undo the padding.
 * That fixed the readout and nothing else, and this block used to assert it.
 * 1.4.12 removed the readout and gave the pop a width instead, which covers
 * every child at once, so what is worth pinning here is the width.
 *
 * Read through `bare` and `declarationsFor` rather than off the raw text, the
 * same as the corner rules above and for the same two reasons: commenting the
 * declaration out leaves the text in `css`, and a later rule beats an earlier
 * one, so the FIRST match is the wrong one to read.
 */
/**
 * The recording dot is COLOURED, and by the theme.
 *
 * It asked for `--text-accent`, which is the link colour and which plenty
 * of themes neutralise; on the owner's own theme it resolved grey for the
 * whole pulse ("grey all the way through", 2026-09-06) - the one thing an
 * indicator that says RECORDING may not be. `--interactive-accent` is what
 * the app paints its own switches with, so a theme keeping any accent keeps
 * this one. What this pins is both halves: a theme token rather than a
 * hardcoded colour, and specifically the one that survives a theme.
 */
describe("styles.css - the recording dot wears an accent a theme keeps", () => {
	const body = (): string => {
		// The rule that STARTS with the class, not the wrapped-grid rule that
		// merely ends with it (`.is-wrapped .handwriting-recording-dot`).
		const at = css.indexOf("\n.handwriting-recording-dot {");
		expect(at, "the recording dot has no rule in styles.css any more").toBeGreaterThan(-1);
		const end = css.indexOf("}", at);
		expect(end, "the recording dot's rule has no end").toBeGreaterThan(at);
		return css.slice(at, end);
	};

	it("takes its colour from the accent themes actually keep", () => {
		expect(body(), "the dot no longer asks for the interactive accent").toMatch(
			/color\s*:\s*var\(--interactive-accent\)/
		);
	});

	it("never hardcodes a colour, so a deliberate theme accent still wins", () => {
		expect(
			body(),
			"the dot hardcodes a colour, which overrides whatever accent the theme chose"
		).not.toMatch(/color\s*:\s*(#|rgb|hsl)/);
	});
});

describe("styles.css - the slider pop declares its own width", () => {
	const POP = ".handwriting-slider-pop";
	/** Every width declared inside a rule, in source order. */
	function widthsIn(body: string): string[] {
		return [...body.matchAll(/(?:^|;)\s*width\s*:([^;]*)/g)].map((m) => m[1]!.trim());
	}

	it("gives the pop a width rather than letting its contents pick one", () => {
		expect(declarationsFor(POP).length, `${POP} rule missing`).toBeGreaterThan(0);
		const widths = declarationsFor(POP).flatMap(widthsIn);
		expect(
			widths.length,
			"the pop takes its widest child's width, so the preset row moves it"
		).toBeGreaterThan(0);
		for (const w of widths) {
			expect(w, `${POP} width is content-driven: ${w}`).toMatch(/^\d+(\.\d+)?px$/);
		}
	});

	it("states the box model that width is measured in", () => {
		// A declared width means one thing under border-box and another under
		// content-box, and the host's stylesheet is the one that would
		// otherwise decide which. 16px of padding and 2px of border is the
		// difference between a 144px pop and a 162px one.
		const boxes = declarationsFor(POP).flatMap((body) =>
			[...body.matchAll(/(?:^|;)\s*box-sizing\s*:([^;]*)/g)].map((m) => m[1]!.trim())
		);
		expect(boxes, `${POP} inherits its box model`).toContain("border-box");
	});

	it("nothing anywhere in the stylesheet takes the width away again", () => {
		// The same sweep the android shade constants get above, and for the
		// same reason: `declarationsFor` matches a selector LIST, so a
		// compound or descendant selector - `.is-mobile .handwriting-slider-pop`
		// - could set `width: auto` from outside its reach.
		for (const block of bare.match(/[^{}]+\{[^{}]*\}/g) ?? []) {
			const brace = block.indexOf("{");
			const selector = block.slice(0, brace);
			if (!selector.includes(POP)) continue;
			for (const w of widthsIn(block.slice(brace + 1, -1))) {
				expect(w, `${POP} width undone by ${selector.trim()}`).not.toMatch(
					/^(auto|max-content|min-content|fit-content)/
				);
			}
		}
	});
});
