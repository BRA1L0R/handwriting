/**
 * Two things alan sees on ORION and nobody sees on the dev machine: the
 * eraser pop's slider knob sitting off the track's centre line, and the
 * strip's grip showing no dots at all.
 *
 * WHY IT IS WORTH A REAL BROWSER, AND WHY IT IS WORTH PIXELS. Every other
 * file in this directory measures BOXES - `getBoundingClientRect` and
 * `getComputedStyle`. Neither can see either of these defects:
 *
 *   - the track and the thumb are `::-webkit-slider-runnable-track` and
 *     `::-webkit-slider-thumb`. A pseudo-element has no element, so it has no
 *     rect to ask for. The only place their geometry exists is the pixels.
 *   - a dot that is painted in a colour too close to what is behind it is
 *     painted exactly as instructed. There is no box wrong, no declaration
 *     dropped, nothing for a computed-style read to catch.
 *
 * So this file screenshots the real elements, hands the PNG back into the
 * page, and reads the composited pixels out of a canvas. What it measures is
 * what the compositor produced, at a stated device pixel ratio.
 *
 * AND WHY THE RATIO IS THE POINT. `margin-top: -7px` is exactly `(4 - 18) / 2`
 * and therefore exactly right whenever the boxes land on whole device pixels,
 * which is every measurement this suite has ever taken - all of them at ratio
 * 1. Orion is fractional. A test at ratio 1 proves nothing about it, so every
 * measurement below is taken at 1.389 - alan's - AND at 1, so that a fix for
 * one is not a trade against the other.
 *
 * Run: npm run test:render.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { INJECTED, launch, openStrip, stylesCss } from "./harness";

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
});
afterAll(async () => {
	await browser?.close();
});

/** Alan's screen, and the dev machine's. Both, always. */
const RATIOS = [1.389, 1] as const;

/**
 * Sub-pixel positions of the strip to take each measurement at.
 *
 * A pop whose top edge lands on a whole device pixel is the easy case: every
 * edge inside it snaps the same way and a hand-computed offset survives. The
 * defect lives in the OTHER positions, and a real pop's top edge is wherever
 * `hangUnder` put it - a measured, fractional number. Shifting the page by a
 * tenth of a CSS pixel at a time walks the whole snapping cycle, so the
 * worst case is measured rather than hoped past.
 */
const NUDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;

/**
 * What one screenshot of the slider says, all of it in DEVICE pixels
 * measured from the image's top edge.
 *
 * Every figure is a coverage-weighted centroid rather than a first-and-last
 * scan of matching pixels: an edge that lands mid-pixel is painted as partial
 * coverage, and a threshold would throw that half away on one side and keep
 * it on the other - which is a bias of exactly the size being measured.
 */
interface KnobPixels {
	imageWidth: number;
	imageHeight: number;
	/** The accent-filled disc's vertical centre. It is concentric with the thumb. */
	thumbCentre: number;
	/** The painted track line's vertical centre. */
	trackCentre: number;
	/** The thumb disc's painted height, at its widest column. */
	thumbHeight: number;
	/** The track line's painted thickness, averaged over the columns read. */
	trackHeight: number;
	/** How much ink each measurement actually had. Zero is a vacuous pass. */
	thumbMass: number;
	trackMass: number;
	/** How far the accent and the track sat from the background, as read. */
	accentSeparation: number;
	trackSeparation: number;
}

/**
 * Screenshot one element and read its pixels, inside the page.
 *
 * The reference colours are MEASURED off the image, not passed in: the
 * background comes from a corner the control does not paint, the accent from
 * the bluest pixel present, the track from the darkest pixel outside the
 * thumb. A hard-coded expectation would turn a control that painted nothing
 * into a control that painted what the test already believed.
 */
const readKnob = async (page: Page, dataUrl: string): Promise<KnobPixels> =>
	page.evaluate(async (url: string) => {
		const img = new Image();
		img.src = url;
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d context for the knob screenshot");
		ctx.drawImage(img, 0, 0);
		const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const px = (x: number, y: number): [number, number, number] => {
			const i = (y * width + x) * 4;
			return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
		};
		// The accent is a purple; the track, the pop behind it and the thumb's
		// own drop shadow are all neutral greys. Blueness tells the one from
		// the other three, which DARKNESS cannot do - the shadow is darker
		// than the background and sits directly under the thumb, so a
		// darkness centroid would be dragged downward by it.
		const blueness = (p: [number, number, number]): number => p[2] - (p[0] + p[1]) / 2;

		const bg = px(1, 1);
		const bgBlue = blueness(bg);

		let accentBlue = bgBlue;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const b = blueness(px(x, y));
				if (b > accentBlue) accentBlue = b;
			}
		}
		const accentSeparation = accentBlue - bgBlue;
		if (accentSeparation < 20) {
			throw new Error(
				`no accent-coloured thumb in the screenshot: bluest pixel is ${accentBlue.toFixed(
					2
				)} against a background of ${bgBlue.toFixed(2)}`
			);
		}
		const accentAt = (x: number, y: number): number => {
			const a = (blueness(px(x, y)) - bgBlue) / accentSeparation;
			return a < 0 ? 0 : a > 1 ? 1 : a;
		};

		// The thumb's columns: everywhere the accent shows at all.
		let first = -1;
		let last = -1;
		for (let x = 0; x < width; x++) {
			let col = 0;
			for (let y = 0; y < height; y++) col += accentAt(x, y);
			if (col > 0.5) {
				if (first < 0) first = x;
				last = x;
			}
		}
		if (first < 0) throw new Error("the thumb painted no accent columns");

		let thumbMass = 0;
		let thumbMoment = 0;
		let thumbHeight = 0;
		for (let x = first; x <= last; x++) {
			let col = 0;
			for (let y = 0; y < height; y++) {
				const a = accentAt(x, y);
				col += a;
				thumbMass += a;
				thumbMoment += a * (y + 0.5);
			}
			if (col > thumbHeight) thumbHeight = col;
		}

		// The track's columns: clear of the thumb's disc, its 2px ring and
		// its 3px shadow blur, and clear of the control's own rounded ends.
		const clear = Math.ceil(8 * (width / 128));
		const columns: number[] = [];
		for (let x = 2; x < width - 2; x++) {
			if (x < first - clear || x > last + clear) columns.push(x);
		}
		if (columns.length < 8) throw new Error(`only ${columns.length} columns clear of the thumb`);

		const bgBlueChannel = bg[2];
		let trackBlueChannel = bgBlueChannel;
		for (const x of columns) {
			for (let y = 0; y < height; y++) {
				const v = px(x, y)[2];
				if (v < trackBlueChannel) trackBlueChannel = v;
			}
		}
		const trackSeparation = bgBlueChannel - trackBlueChannel;
		if (trackSeparation < 8) {
			throw new Error(
				`no track line in the screenshot: darkest pixel clear of the thumb is ${trackBlueChannel} against a background of ${bgBlueChannel}`
			);
		}
		let trackMass = 0;
		let trackMoment = 0;
		for (const x of columns) {
			for (let y = 0; y < height; y++) {
				const raw = (bgBlueChannel - px(x, y)[2]) / trackSeparation;
				const a = raw < 0 ? 0 : raw > 1 ? 1 : raw;
				trackMass += a;
				trackMoment += a * (y + 0.5);
			}
		}

		return {
			imageWidth: width,
			imageHeight: height,
			thumbCentre: thumbMoment / thumbMass,
			trackCentre: trackMoment / trackMass,
			thumbHeight,
			trackHeight: trackMass / columns.length,
			thumbMass,
			trackMass,
			accentSeparation,
			trackSeparation,
		};
	}, dataUrl);

/** Open the eraser pop at `ratio`, nudge the page, and read the knob. */
const knobAt = async (
	ratio: number
): Promise<{ worst: KnobPixels & { nudge: number }; all: (KnobPixels & { nudge: number })[] }> => {
	const h = await openStrip(browser, { deviceScaleFactor: ratio });
	try {
		// Through the same probe every other pop measurement uses, so this
		// file measures the pop the rest of the suite measures.
		await h.pop({ tool: "eraser", presets: 0 });
		const slider = h.page.locator('input[aria-label="Eraser size"]');
		// Mid-travel, so there is track to read on BOTH sides of the thumb.
		// The value is set directly rather than dragged: this measures where
		// the engine paints the thumb, not what the strip does with a change.
		await slider.evaluate((el: HTMLInputElement) => {
			const min = Number(el.min || "0");
			const max = Number(el.max || "100");
			el.value = String((min + max) / 2);
		});
		const all: (KnobPixels & { nudge: number })[] = [];
		for (const nudge of NUDGES) {
			await h.page.evaluate((n: number) => {
				document.body.style.paddingTop = `${n}px`;
			}, nudge);
			const shot = await slider.screenshot();
			const read = await readKnob(h.page, `data:image/png;base64,${shot.toString("base64")}`);
			all.push({ ...read, nudge });
		}
		const worst = all.reduce((a, b) =>
			Math.abs(a.thumbCentre - a.trackCentre) >= Math.abs(b.thumbCentre - b.trackCentre)
				? a
				: b
		);
		return { worst, all };
	} finally {
		await h.close();
	}
};

describe("the eraser pop's knob sits on the track's centre line", () => {
	/**
	 * ONE DEVICE PIXEL. Not one CSS pixel: at 1.389 a CSS pixel is nearly a
	 * pixel and a half of screen, and the thing alan can see is screen.
	 */
	const TOLERANCE = 1;

	for (const ratio of RATIOS) {
		it(`centres the thumb on the track at device pixel ratio ${ratio}`, async () => {
			const { worst, all } = await knobAt(ratio);

			// THE RATIO REALLY APPLIED. A screenshot taken at ratio 1 while
			// the test believes it is at 1.389 is the exact failure this file
			// exists to avoid, and it looks like a pass.
			expect(worst.imageWidth / 128).toBeCloseTo(ratio, 1);

			// There was ink to measure. Without this a control that painted
			// nothing divides zero by zero and reports NaN, and NaN fails no
			// comparison it is not asked to.
			expect(worst.thumbMass).toBeGreaterThan(50 * ratio * ratio);
			expect(worst.trackMass).toBeGreaterThan(50 * ratio * ratio);
			// And the two things measured are the two things meant: an 18px
			// disc inside a 22px control, and a 4px line.
			expect(worst.thumbHeight).toBeGreaterThan(10 * ratio);
			expect(worst.trackHeight).toBeGreaterThan(2 * ratio);
			expect(worst.trackHeight).toBeLessThan(7 * ratio);

			const offsets = all.map(
				(r) => `${r.nudge}: ${(r.thumbCentre - r.trackCentre).toFixed(3)}`
			);
			// eslint-disable-next-line no-console
			console.log(
				`knob @ dpr ${ratio}: image ${worst.imageWidth}x${
					worst.imageHeight
				} device px; thumb centre ${worst.thumbCentre.toFixed(
					3
				)} (height ${worst.thumbHeight.toFixed(
					2
				)}), track centre ${worst.trackCentre.toFixed(
					3
				)} (thickness ${worst.trackHeight.toFixed(2)}); worst offset ${(
					worst.thumbCentre - worst.trackCentre
				).toFixed(3)} at nudge ${worst.nudge}; by nudge: ${offsets.join(", ")}`
			);
			// THE CLAIM. The knob's centre and the line's centre are the same
			// place, at every sub-pixel position of the pop.
			expect(
				Math.abs(worst.thumbCentre - worst.trackCentre),
				`dpr ${ratio}, thumb ${worst.thumbCentre.toFixed(
					3
				)} vs track ${worst.trackCentre.toFixed(3)} device px; by nudge: ${offsets.join(
					", "
				)}`
			).toBeLessThanOrEqual(TOLERANCE);
		});
	}

	/**
	 * THE ASSERTION THAT WAS WATCHED RED, and the honest reading of what it
	 * caught.
	 *
	 * The one above was not enough on its own. Reverted to `margin-top: -7px`
	 * over a 4px track and run at 1.389, it stayed GREEN: the knob came out
	 * 0.092 device pixels off the line, against 0.028 for the construction
	 * that replaced it. Tighter, but not a defect a tolerance of a device
	 * pixel can see, and headless chromium is not alan's screen.
	 *
	 * What the same revert DOES move, by a whole CSS pixel, is where the
	 * assembly sits inside the control. Measured, thumb centre from the
	 * control's own top edge:
	 *
	 *              ratio 1      ratio 1.389     drift
	 *   -7px       11.014 css   11.945 css      0.931 css
	 *   this       11.014 css   10.944 css      0.070 css
	 *
	 * That is the hand-computed offset failing at a fractional ratio, in the
	 * dimension this engine happens to express it in: a thumb pulled 7px
	 * above its track overflows the slider's container, and the size of that
	 * overflow is what stops being exact when a device pixel is not a CSS
	 * pixel. Two boxes of equal height overflow by nothing, so there is
	 * nothing left to round - which is why the row below is flat.
	 *
	 * A different engine, a different chromium, a GPU rasteriser or a browser
	 * zoom on top of the ratio can spend the same rounding error in the other
	 * dimension, and that is the one alan is looking at. This test cannot
	 * settle which; it can settle that the geometry no longer depends on the
	 * ratio at all.
	 */
	it("puts the knob in the same place whatever the device pixel ratio", async () => {
		const high = await knobAt(1.389);
		const one = await knobAt(1);
		const css = (r: { thumbCentre: number; trackCentre: number }, ratio: number) => ({
			thumb: r.thumbCentre / ratio,
			track: r.trackCentre / ratio,
		});
		const a = css(high.worst, 1.389);
		const b = css(one.worst, 1);
		// eslint-disable-next-line no-console
		console.log(
			`knob placement in the control: thumb ${b.thumb.toFixed(3)} css @1 vs ${a.thumb.toFixed(
				3
			)} css @1.389 (drift ${Math.abs(a.thumb - b.thumb).toFixed(
				3
			)}); track ${b.track.toFixed(3)} vs ${a.track.toFixed(3)} (drift ${Math.abs(
				a.track - b.track
			).toFixed(3)})`
		);
		// A QUARTER OF A CSS PIXEL. Far below the 0.931 the hand-computed
		// offset drifts by, and far above the 0.070 this construction leaves,
		// so it is a line between the two and not a line drawn round the
		// current number.
		expect(Math.abs(a.thumb - b.thumb), "the thumb moves with the device pixel ratio").toBeLessThan(0.25);
		expect(Math.abs(a.track - b.track), "the track moves with the device pixel ratio").toBeLessThan(0.25);
	});
});

/** WCAG relative luminance, and the ratio built from two of them. */
const luminance = (rgb: [number, number, number]): number => {
	const chan = (v: number): number => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
};
const contrast = (a: [number, number, number], b: [number, number, number]): number => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
};

const parseRgb = (css: string): [number, number, number] => {
	const m = css.match(/(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/);
	if (!m) throw new Error(`not a colour: ${css}`);
	return [Number(m[1]), Number(m[2]), Number(m[3])];
};

interface DotsProbe {
	/** The gradient as the engine resolved it - the token is a colour by here. */
	backgroundImage: string;
	/** The two candidate tokens, resolved, so the assertion can tell them apart. */
	muted: string;
	faint: string;
	/** The darkest pixel the dots painted, and the strip behind them. */
	darkest: [number, number, number];
	behind: [number, number, number];
	/** How many device pixels came out at least half-way to the darkest. */
	inked: number;
	total: number;
}

describe("the strip's grip is visible", () => {
	for (const ratio of RATIOS) {
		it(`paints its dots in a token above the faintest at device pixel ratio ${ratio}`, async () => {
			const h = await openStrip(browser, { deviceScaleFactor: ratio });
			try {
				const dots = h.page.locator(".handwriting-tools-grip-dots");
				expect(await dots.count(), "the grip's dots are not in the strip").toBe(1);

				const probe = await h.page.evaluate(async () => {
					const el = document.querySelector<HTMLElement>(
						".handwriting-tools-grip-dots"
					);
					if (!el) throw new Error("no grip dots");
					const root = getComputedStyle(document.documentElement);
					const strip = el.closest<HTMLElement>(".handwriting-mobile-tools");
					if (!strip) throw new Error("the grip is not inside a strip");
					return {
						backgroundImage: getComputedStyle(el).backgroundImage,
						muted: root.getPropertyValue("--text-muted").trim(),
						faint: root.getPropertyValue("--text-faint").trim(),
						behindCss: getComputedStyle(strip).backgroundColor,
					};
				});

				// The engine has already substituted the token here, so this
				// reads what will be PAINTED and not what the stylesheet
				// spells. The two injected tokens are deliberately different
				// values (see INJECTED in harness.ts), which is what makes
				// these two lines a discrimination rather than a coincidence.
				const asRgb = (hex: string): string => {
					const n = parseInt(hex.slice(1), 16);
					return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
				};
				expect(probe.muted).not.toBe(probe.faint);
				expect(probe.backgroundImage).toContain(asRgb(probe.muted));
				expect(
					probe.backgroundImage,
					"the grip's dots are painted in the faintest token the theme has"
				).not.toContain(asRgb(probe.faint));

				// MEASURED, off the composited pixels: the dots over whatever
				// the strip actually paints behind them.
				const shot = await dots.screenshot();
				const pixels = await h.page.evaluate(async (url: string) => {
					const img = new Image();
					img.src = url;
					await img.decode();
					const canvas = document.createElement("canvas");
					canvas.width = img.naturalWidth;
					canvas.height = img.naturalHeight;
					const ctx = canvas.getContext("2d");
					if (!ctx) throw new Error("no 2d context for the grip screenshot");
					ctx.drawImage(img, 0, 0);
					const { data, width, height } = ctx.getImageData(
						0,
						0,
						canvas.width,
						canvas.height
					);
					let darkest: [number, number, number] = [255, 255, 255];
					let lightest: [number, number, number] = [0, 0, 0];
					for (let i = 0; i < data.length; i += 4) {
						const p: [number, number, number] = [
							data[i] ?? 0,
							data[i + 1] ?? 0,
							data[i + 2] ?? 0,
						];
						const sum = p[0] + p[1] + p[2];
						if (sum < darkest[0] + darkest[1] + darkest[2]) darkest = p;
						if (sum > lightest[0] + lightest[1] + lightest[2]) lightest = p;
					}
					const mid = (darkest[0] + lightest[0]) / 2;
					let inked = 0;
					for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) <= mid) inked++;
					return { darkest, lightest, inked, total: width * height };
				}, `data:image/png;base64,${shot.toString("base64")}`);

				const behind = parseRgb(probe.behindCss);
				const probed: DotsProbe = {
					backgroundImage: probe.backgroundImage,
					muted: probe.muted,
					faint: probe.faint,
					darkest: pixels.darkest,
					behind,
					inked: pixels.inked,
					total: pixels.total,
				};

				// The dots are really there. A grip that painted nothing has
				// its darkest pixel equal to its background, and every
				// contrast below it would come out at 1.00 - which reads like
				// a measurement and is an absence.
				expect(probed.inked, "the grip painted no dots at all").toBeGreaterThan(4);

				const painted = contrast(probed.darkest, probed.behind);
				const asMuted = contrast(parseRgb(asRgb(probe.muted)), behind);
				const asFaint = contrast(parseRgb(asRgb(probe.faint)), behind);
				// eslint-disable-next-line no-console
				console.log(
					`grip dots @ dpr ${ratio}: painted rgb(${probed.darkest.join(
						", "
					)}) on rgb(${behind.join(", ")}) = ${painted.toFixed(
						2
					)}:1; the token it uses would give ${asMuted.toFixed(
						2
					)}:1 and the faintest token ${asFaint.toFixed(2)}:1; ${probed.inked}/${
						probed.total
					} device px inked`
				);

				// NOT A THRESHOLD NOBODY AGREED TO. The claim is an ORDERING:
				// the dots contrast MORE than the faintest token would have
				// given, which is the whole of the change and is the only
				// thing this harness's injected palette can honestly settle -
				// a real theme picks different values for both tokens.
				// The painted dots land on the MUTED side of the midpoint
				// between the two tokens. Stronger than "not the faintest" -
				// one shade off the faintest would satisfy that - and it
				// invents no number: both ends of the comparison are the
				// theme's own tokens as this page resolved them.
				//
				// Not `toBeCloseTo(asMuted)`: the darkest pixel a 2px dot
				// leaves is a shade lighter than the token itself, because
				// chromium interpolates and dithers a radial gradient, and
				// pinning that gap would pin the rasteriser, not the design.
				expect(painted).toBeGreaterThan(asFaint);
				expect(painted).toBeGreaterThan((asMuted + asFaint) / 2);
			} finally {
				await h.close();
			}
		});
	}

	it("still injects a faintest token distinct from the muted one", () => {
		// The negative control for the pair of assertions above, stated where
		// it can be read: if these two were ever set to the same value, the
		// "not the faintest token" assertion would pass on the wrong token.
		expect(INJECTED.cosmetic["--text-faint"]).not.toBe(INJECTED.cosmetic["--text-muted"]);
	});
});

/**
 * THE HOST'S OWN RANGE RULES, which nothing above loads.
 *
 * Obsidian styles `input[type='range']::-webkit-slider-thumb` itself, and two
 * of its declarations are `position: relative; top: var(--slider-thumb-y)`:
 * an upward shift sized for ITS 6px track and ITS thumb, -6px on desktop and
 * -9px on mobile. Our thumb rule is more specific, so it wins every property
 * it declares - and leaves every one it does not to the host. Every measurement above
 * injects styles.css alone, so a host declaration we fail to override is
 * invisible to it, which is how a knob a radius above its line reached two
 * machines in two themes (alan and a second user, 2026-09-06) with this file
 * green.
 *
 * The fixture is the host's range rules REDUCED to what moves a thumb (see the
 * file's own comment for where they came from). The shift's value is a
 * parameter of the measurement, and both values the app ships are run. The
 * assertions above are left exactly as they are: they stay the negative
 * control, the knob without the host's stylesheet, and this block is the same
 * measurement with it.
 */
const HOST_RANGE_CSS = readFileSync(here("./fixtures/obsidian-range-rules.css"), "utf8");

/** The two values of `--slider-thumb-y` the installed app ships, in CSS px. */
const HOST_SHIFTS = [-6, -9] as const;

/** Every pop the same input class builds. */
const POPS = {
	eraser: "Eraser size",
	pen: "Pen size",
	highlighter: "Highlighter size",
} as const;

/** Open one pop under the host's range rules at `shift`, and read its knob. */
const knobUnderHost = async (
	tool: keyof typeof POPS,
	shift: number,
	ratio: number
): Promise<{ worst: KnobPixels & { nudge: number }; all: (KnobPixels & { nudge: number })[] }> => {
	const h = await openStrip(browser, {
		deviceScaleFactor: ratio,
		// The host's rules first and ours after, in the order Obsidian loads
		// a plugin's stylesheet. Specificity decides the conflicts either
		// way; the order is kept so the page is the real cascade.
		css: [HOST_RANGE_CSS, `:root { --slider-thumb-y: ${shift}px; }`, stylesCss()].join("\n"),
	});
	try {
		await h.pop({ tool, presets: 0 });
		const slider = h.page.locator(`input[aria-label="${POPS[tool]}"]`);
		await slider.evaluate((el: HTMLInputElement) => {
			const min = Number(el.min || "0");
			const max = Number(el.max || "100");
			el.value = String((min + max) / 2);
		});
		// The read has to SEE above the control. A thumb the host shifted up
		// hangs out of the slider's own box, and a screenshot of that box
		// alone would clip it and centre the visible remainder - a smaller
		// offset than the real one. So the read covers the pop's padding
		// above the control as well: 7 of its 8px, because the pop's border
		// sits at the eighth in the track's own colour, and at a fractional
		// ratio a clip that reaches it takes part of a border row for track
		// (measured: a 2.05 device px step at 1.389). In the eraser's pop that band
		// holds the Stroke/Reticle chips, one of them filled with the accent
		// the thumb is measured by and the other ringed in the track's own
		// colour, so they are made invisible for the read. `visibility`
		// keeps their layout: the slider sits exactly where it sits with
		// them showing.
		await h.page.evaluate(() => {
			for (const el of document.querySelectorAll<HTMLElement>(".handwriting-mode-chips")) {
				el.style.visibility = "hidden";
			}
		});
		const PAD = 7;
		const all: (KnobPixels & { nudge: number })[] = [];
		for (const nudge of NUDGES) {
			await h.page.evaluate((n: number) => {
				document.body.style.paddingTop = `${n}px`;
			}, nudge);
			const box = await slider.boundingBox();
			if (!box) throw new Error(`the ${tool} slider has no box`);
			const shot = await h.page.screenshot({
				clip: { x: box.x, y: box.y - PAD, width: box.width, height: box.height + PAD },
			});
			const read = await readKnob(h.page, `data:image/png;base64,${shot.toString("base64")}`);
			all.push({ ...read, nudge });
		}
		const worst = all.reduce((a, b) =>
			Math.abs(a.thumbCentre - a.trackCentre) >= Math.abs(b.thumbCentre - b.trackCentre)
				? a
				: b
		);
		return { worst, all };
	} finally {
		await h.close();
	}
};

describe("the knob sits on the track's centre line under the host's own range rules", () => {
	/** The same one device pixel the block above holds the knob to. */
	const TOLERANCE = 1;

	for (const shift of HOST_SHIFTS) {
		for (const ratio of RATIOS) {
			for (const tool of Object.keys(POPS) as (keyof typeof POPS)[]) {
				it(`centres the ${tool} thumb with --slider-thumb-y: ${shift}px at device pixel ratio ${ratio}`, async () => {
					const { worst, all } = await knobUnderHost(tool, shift, ratio);

					// The ratio really applied, and there was ink to measure -
					// the same guards as the block above, for the same reasons.
					expect(worst.imageWidth / 128).toBeCloseTo(ratio, 1);
					expect(worst.thumbMass).toBeGreaterThan(50 * ratio * ratio);
					expect(worst.trackMass).toBeGreaterThan(50 * ratio * ratio);
					expect(worst.thumbHeight).toBeGreaterThan(10 * ratio);
					expect(worst.trackHeight).toBeGreaterThan(2 * ratio);
					expect(worst.trackHeight).toBeLessThan(7 * ratio);

					const offsets = all.map(
						(r) => `${r.nudge}: ${(r.thumbCentre - r.trackCentre).toFixed(3)}`
					);
					// eslint-disable-next-line no-console
					console.log(
						`knob under host ${shift}px, ${tool} @ dpr ${ratio}: thumb centre ${worst.thumbCentre.toFixed(
							3
						)}, track centre ${worst.trackCentre.toFixed(3)} device px; worst offset ${(
							worst.thumbCentre - worst.trackCentre
						).toFixed(3)} at nudge ${worst.nudge}; by nudge: ${offsets.join(", ")}`
					);
					// THE CLAIM: with the host's shift in the cascade, the
					// knob's centre and the line's centre are still the same
					// place. Against a thumb rule that leaves `position` to
					// the host this reads the shift itself, about `shift`
					// times `ratio` device pixels, negative.
					expect(
						Math.abs(worst.thumbCentre - worst.trackCentre),
						`host shift ${shift}px, ${tool}, dpr ${ratio}: thumb ${worst.thumbCentre.toFixed(
							3
						)} vs track ${worst.trackCentre.toFixed(3)} device px; by nudge: ${offsets.join(", ")}`
					).toBeLessThanOrEqual(TOLERANCE);
				});
			}
		}
	}
});
