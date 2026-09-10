/**
 * The eraser pop's knob under the mouse: the accent, not white.
 *
 * "leave the slider knob alone no white button when clicked that's a little
 * flashy" (the owner, 2026-09-07). On every desktop with a mouse the thumb
 * turned WHITE on hover and on press, and nobody designed that: Obsidian's own
 * `input[type='range']:not(:disabled)::-webkit-slider-thumb:hover` and its
 * `:active` twin paint `var(--slider-thumb-background-hover)` - white in both
 * of the app's themes - at specificity (0,3,2), and the plugin's thumb rule
 * `.handwriting-slider-pop .handwriting-eraser-slider::-webkit-slider-thumb`
 * is (0,2,1). Same shape as the thumb's `top` the day before: a host
 * declaration the plugin never overrode, invisible to every measurement that
 * did not load the host's sheet.
 *
 * WHY PIXELS AND NOT `getComputedStyle`. A computed read would do for the
 * cascade, but the claim the owner made is about what he SEES, and the only
 * thing a thumb pseudo-element has is its paint. So this file hovers the real
 * control with the real mouse, holds the button down on it, and reads the
 * colour the compositor produced at the disc's centre.
 *
 * WHY A DISTANCE AND NOT `not.toEqual`. "Not equal to white" is satisfied by
 * a pixel one shade off white, which this project has shipped as a pass
 * before. The claim is measured: the painted centre is within `TOLERANCE`
 * of the accent as the page resolved it, and nearer the accent than the
 * host's hover colour by a margin the same tolerance cannot bridge.
 *
 * Run: npm run test:render.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { hostFixture, hostVars, launch, openStrip } from "./harness";

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
});
afterAll(async () => {
	await browser?.close();
});

/** The dev machine's ratio and alan's, as every knob measurement takes. */
const RATIOS = [1, 1.389] as const;

/**
 * The host's range rules REDUCED to what moves or recolours a thumb, and the
 * app's own values for the tokens the hover rule reads. `white` IS the
 * value the installed app ships for `--slider-thumb-background-hover`, in
 * both themes; the others cannot recolour the disc's centre and are given
 * so the fixture is a render rather than a pile of invalid declarations.
 */
const HOST_RANGE_CSS = hostFixture("obsidian-range-rules.css");
const HOST_RANGE_VARS = hostVars({
	"--slider-thumb-y": "-6px",
	"--slider-thumb-background-hover": "white",
	"--background-modifier-border-focus": "#8a8a8a",
	"--slider-thumb-shadow-hover": "0 0 2px 0 rgba(0, 0, 0, 0.1), 0 2px 6px 0 rgba(0, 0, 0, 0.1)",
});

/**
 * Long enough for the host's `transition: all 0.1s linear` on the thumb to
 * finish. A read taken inside the transition measures a blend of the two
 * colours and would pass or fail by timing.
 */
const SETTLE_MS = 300;

/**
 * Euclidean distance in 8-bit RGB, out of a possible 441. Twenty-four is
 * about five per cent of that: wide enough for the strip's own 0.92
 * opacity, through which the pop and its thumb are composited over the
 * page and which alone lifts the accent by about 16 as read (measured
 * 2026-09-07: rgb(133, 120, 220) painted for rgb(123, 108, 217) declared,
 * at rest, hover and press alike), and eight times narrower than the gap
 * between that accent and the host's white (~201, measured below).
 */
const TOLERANCE = 24;

type Rgb = [number, number, number];

const distance = (a: Rgb, b: Rgb): number =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const parseRgb = (css: string): Rgb => {
	const m = css.match(/(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/);
	if (!m) throw new Error(`not a colour: ${css}`);
	return [Number(m[1]), Number(m[2]), Number(m[3])];
};

const show = (c: Rgb): string => `rgb(${c.map((v) => v.toFixed(1)).join(", ")})`;

/**
 * The colour painted at the centre of a screenshot: a 3x3 device-pixel patch,
 * averaged. The thumb is an 18px disc with a 2px ring, so its 14px centre is
 * solid fill at either ratio and the patch never touches the ring.
 */
const centreColour = async (page: Page, png: { toString(encoding: "base64"): string }): Promise<Rgb> =>
	page.evaluate(async (url: string) => {
		const img = new Image();
		img.src = url;
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d context for the thumb screenshot");
		ctx.drawImage(img, 0, 0);
		const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const cx = Math.floor(width / 2);
		const cy = Math.floor(height / 2);
		const sum: [number, number, number] = [0, 0, 0];
		let n = 0;
		for (let y = cy - 1; y <= cy + 1; y++) {
			for (let x = cx - 1; x <= cx + 1; x++) {
				const i = (y * width + x) * 4;
				sum[0] += data[i] ?? 0;
				sum[1] += data[i + 1] ?? 0;
				sum[2] += data[i + 2] ?? 0;
				n++;
			}
		}
		return [sum[0] / n, sum[1] / n, sum[2] / n] as [number, number, number];
	}, `data:image/png;base64,${png.toString("base64")}`);

interface ThumbColours {
	/** Painted centre of the thumb with the mouse elsewhere. */
	rest: Rgb;
	/** With the mouse over the thumb. */
	hover: Rgb;
	/** With the mouse over the thumb and the button held down. */
	active: Rgb;
	/** `--interactive-accent` as the page resolved it. */
	accent: Rgb;
	/** `--slider-thumb-background-hover` as the page resolved it. */
	hostHover: Rgb;
	/**
	 * The tell that the fixture reached the thumb. Chromium's
	 * `getComputedStyle` does not resolve `::-webkit-slider-thumb` (it hands
	 * back the input's own style; measured 2026-09-07), so the pseudo-element
	 * cannot be asked. What can be: the host's hover rule is in a sheet of
	 * this page, and the input matches that rule's subject with the
	 * pseudo-element and its state stripped off.
	 */
	hostHoverRules: number;
	sliderIsSubject: boolean;
}

/** Open the eraser pop under the host's range rules and read the knob three ways. */
const thumbColours = async (ratio: number): Promise<ThumbColours> => {
	const h = await openStrip(browser, {
		deviceScaleFactor: ratio,
		hostCss: [HOST_RANGE_CSS, HOST_RANGE_VARS],
	});
	try {
		await h.pop({ tool: "eraser", presets: 0 });
		const slider = h.page.locator('input[aria-label="Eraser size"]');
		// Mid-travel: the thumb's centre is then the control's centre, which
		// is where `hover()` puts the mouse and where the patch is read.
		await slider.evaluate((el: HTMLInputElement) => {
			const min = Number(el.min || "0");
			const max = Number(el.max || "100");
			el.value = String((min + max) / 2);
		});
		const tokens = await slider.evaluate((el: HTMLInputElement) => {
			// A token's value is text until an element uses it; resolve
			// both through a scratch element so `white` and `#7b6cd9`
			// come back as the same `rgb()` form the pixels are compared in.
			const root = getComputedStyle(document.documentElement);
			const resolve = (token: string): string => {
				const probe = document.createElement("span");
				probe.style.color = root.getPropertyValue(token).trim();
				document.body.append(probe);
				const c = getComputedStyle(probe).color;
				probe.remove();
				return c;
			};
			// The host's hover rule, found in the page's sheets by what it
			// does: it recolours `::-webkit-slider-thumb:hover` from the
			// host's token. Its subject, less the pseudo-element and the
			// state, is what the slider must match for the rule to reach it.
			let hostHoverRules = 0;
			let sliderIsSubject = false;
			for (const sheet of Array.from(document.styleSheets)) {
				for (const rule of Array.from(sheet.cssRules)) {
					if (!(rule instanceof CSSStyleRule)) continue;
					if (!rule.selectorText.includes("::-webkit-slider-thumb:hover")) continue;
					if (!rule.style.getPropertyValue("background").includes("--slider-thumb-background-hover")) continue;
					hostHoverRules++;
					for (const part of rule.selectorText.split(",")) {
						const subject = part.trim().replace(/::-webkit-slider-thumb:(hover|active)$/, "");
						if (el.matches(subject)) sliderIsSubject = true;
					}
				}
			}
			return {
				accent: resolve("--interactive-accent"),
				hostHover: resolve("--slider-thumb-background-hover"),
				hostHoverRules,
				sliderIsSubject,
			};
		});

		await h.page.mouse.move(0, 0);
		await h.page.waitForTimeout(SETTLE_MS);
		const rest = await centreColour(h.page, await slider.screenshot());

		await slider.hover();
		await h.page.waitForTimeout(SETTLE_MS);
		const hover = await centreColour(h.page, await slider.screenshot());

		await h.page.mouse.down();
		await h.page.waitForTimeout(SETTLE_MS);
		const active = await centreColour(h.page, await slider.screenshot());
		await h.page.mouse.up();

		return {
			rest,
			hover,
			active,
			accent: parseRgb(tokens.accent),
			hostHover: parseRgb(tokens.hostHover),
			hostHoverRules: tokens.hostHoverRules,
			sliderIsSubject: tokens.sliderIsSubject,
		};
	} finally {
		await h.close();
	}
};

describe("the eraser pop's knob keeps the accent under the mouse, with the host's own range rules in the cascade", () => {
	for (const ratio of RATIOS) {
		it(`paints the accent, not the host's hover colour, on hover and on press at device pixel ratio ${ratio}`, async () => {
			const c = await thumbColours(ratio);

			// THE FIXTURE REALLY REACHED THE THUMB: the host's hover rule is
			// in the page, once, and this slider is its subject. Without
			// this, a fixture that never landed would make the assertions
			// below a comparison of the plugin's sheet with itself. (The
			// pseudo-element itself cannot be asked; see `ThumbColours`.)
			// Watched red without the fix, 2026-09-07: hover and active both
			// read rgb(255, 255, 255) at both ratios, 201 from the accent.
			expect(c.hostHoverRules, "the host's hover rule is not in the page exactly once").toBe(1);
			expect(c.sliderIsSubject, "the host's hover rule does not reach this slider").toBe(true);

			// THE TWO ENDS ARE TWO. A tolerance means nothing if the accent
			// and the host's hover colour sit inside it.
			const gap = distance(c.accent, c.hostHover);
			expect(gap, "the accent and the host's hover colour are not distinguishable").toBeGreaterThan(
				4 * TOLERANCE
			);

			// eslint-disable-next-line no-console
			console.log(
				`thumb @ dpr ${ratio}: rest ${show(c.rest)}, hover ${show(c.hover)}, active ${show(
					c.active
				)}; accent ${show(c.accent)}, host hover ${show(c.hostHover)}; distance to accent: rest ${distance(
					c.rest,
					c.accent
				).toFixed(1)}, hover ${distance(c.hover, c.accent).toFixed(1)}, active ${distance(
					c.active,
					c.accent
				).toFixed(1)}; distance to host hover: hover ${distance(c.hover, c.hostHover).toFixed(
					1
				)}, active ${distance(c.active, c.hostHover).toFixed(1)}; accent to host hover ${gap.toFixed(1)}`
			);

			// THE NEGATIVE CONTROL: at rest the disc is the accent. If this
			// fails the read is not on the disc and nothing below means
			// anything.
			expect(distance(c.rest, c.accent), `at rest the thumb is ${show(c.rest)}`).toBeLessThanOrEqual(
				TOLERANCE
			);

			// THE CLAIM, both states: the painted centre is within tolerance
			// of the accent, and nearer the accent than the host's colour.
			const states: readonly (readonly [string, Rgb])[] = [
				["hover", c.hover],
				["active", c.active],
			];
			for (const [state, colour] of states) {
				expect(
					distance(colour, c.accent),
					`on ${state} the thumb is ${show(colour)}, ${distance(colour, c.accent).toFixed(
						1
					)} from the accent ${show(c.accent)} and ${distance(colour, c.hostHover).toFixed(
						1
					)} from the host's ${show(c.hostHover)}`
				).toBeLessThanOrEqual(TOLERANCE);
				expect(
					distance(colour, c.accent),
					`on ${state} the thumb is nearer the host's colour than the accent`
				).toBeLessThan(distance(colour, c.hostHover));
			}
		});
	}
});
