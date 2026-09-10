/**
 * The eraser pop's Stroke | Reticle chips under the HOST's own `button` rule,
 * which nothing else in this directory loads.
 *
 * Found by a sweep of the app's stylesheet against the strip and its pops
 * (2026-09-07), the same shape as the slider knob of the day before: Obsidian
 * styles every `button` itself, and one of its declarations is
 * `height: var(--input-height)` - 30px on desktop, 44px on a phone. The
 * chip's own rule sets a 10px face, a 1.4 line and 2px of vertical padding,
 * which is a 20px chip, and says nothing about `height`; so the host's wins,
 * the chip is half again as tall on a desktop and more than twice as tall on
 * a phone, and the pop under it grows by the difference. Every measurement
 * of the pop in this suite is taken without the host's sheet and reads 20.
 *
 * The fixture is the host's button rule REDUCED to what moves a box (see the
 * file's own comment for where it came from). The two token values the app
 * ships are parameters of the measurement, and both are run. The claim is
 * an EQUALITY - the chip is the same height with the host's rule at either
 * value as on the plain page - rather than a number, so a chip redesign
 * moves every side at once.
 *
 * WHY TWO HOST VALUES IN ONE ASSERTION. The first version of this file also
 * checked that the plain chip was shorter than the host's value less four,
 * as a tell that the chip measured was the 20px one and not the host's 30.
 * That is a proxy, and it stopped working the day the chip was made 30px
 * tall on purpose (the owner's own size, 2026-09-07): at `--input-height:
 * 30px` it could no longer tell our 30 from the host's. The equality across
 * the two host values can. If the host's `height` reached the chip, the chip
 * would be 30 under one value and 44 under the other; a chip that reads the
 * same under both is sized by its own rule, whatever number that rule lands
 * on - even one that happens to equal the host's.
 *
 * Run: npm run test:render.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { hostFixture, hostVars, launch, openStrip } from "./harness";

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
});
afterAll(async () => {
	await browser?.close();
});

const HOST_BUTTON_CSS = hostFixture("obsidian-button-rules.css");

/**
 * The two `--input-height` values the installed app ships: its `body`
 * variables, and its `.is-mobile` block through `--touch-size-m`. The other
 * tokens the fixture reads are given the app's desktop values; none of them
 * can move a chip's HEIGHT, which is the thing measured.
 */
const HOST_INPUT_HEIGHTS = [30, 44] as const;

interface ChipProbe {
	/** The pop's own border box height. */
	pop: number;
	/** Each chip's border box height, in document order. */
	chips: number[];
	/** Each chip's computed `display`: the fixture's tell, see below. */
	display: string[];
}

/** Open the eraser pop and measure its chips, with or without the host's rule. */
const chipsAt = async (inputHeight: number | null): Promise<ChipProbe> => {
	const h = await openStrip(
		browser,
		inputHeight === null
			? {}
			: {
					hostCss: [
						HOST_BUTTON_CSS,
						hostVars({
							"--input-height": `${inputHeight}px`,
							"--input-font-weight": "400",
							"--font-ui-small": "13px",
							"--button-radius": "5px",
							"--size-4-1": "4px",
							"--size-4-3": "12px",
						}),
					],
				}
	);
	try {
		await h.pop({ tool: "eraser", presets: 0 });
		return await h.page.evaluate(() => {
			const pop = document.querySelector<HTMLElement>(".handwriting-slider-pop");
			if (!pop) throw new Error("no pop");
			const chips = Array.from(pop.querySelectorAll<HTMLElement>(".handwriting-mode-chip"));
			if (chips.length < 2) throw new Error(`expected two chips, found ${chips.length}`);
			return {
				pop: pop.getBoundingClientRect().height,
				chips: chips.map((c) => c.getBoundingClientRect().height),
				display: chips.map((c) => getComputedStyle(c).display),
			};
		});
	} finally {
		await h.close();
	}
};

/**
 * The chip's height on a desktop, by the owner's ruling (2026-09-07, "i think
 * the eraser pop chips should be bigger" of the 20px chip): 30px, the size
 * the host had been giving these before their height was made their own.
 * A floor, not the number - the equality below is what proves whose rule
 * sizes the chip; this only says the chip is not the 20px one again.
 */
const DESKTOP_CHIP_AT_LEAST = 30;

describe("the eraser pop's chips keep their own height under the host's button rule", () => {
	it("is the same chip with --input-height at either of the host's values as without the host", async () => {
		const plain = await chipsAt(null);
		const hosts: ChipProbe[] = [];
		for (const h of HOST_INPUT_HEIGHTS) hosts.push(await chipsAt(h));

		// THE FIXTURE REALLY REACHED THE CHIP. The host makes every
		// button a flex container, and the chip's own rule leaves
		// `display` alone: a plain page reads `block`, a page with the
		// host's rule reads `flex`. A fixture that never landed would
		// make everything below a comparison of a page with itself.
		expect(plain.display.every((d) => d === "block"), "the plain chip is not a block").toBe(true);
		hosts.forEach((host, k) => {
			expect(
				host.display.every((d) => d === "flex"),
				`the host's button rule did not reach the chip at --input-height: ${HOST_INPUT_HEIGHTS[k]}px`
			).toBe(true);
		});

		// And the two host values are two: an equality between them says
		// nothing if the fixture was handed the same number twice.
		expect(new Set<number>(HOST_INPUT_HEIGHTS).size).toBe(HOST_INPUT_HEIGHTS.length);

		// eslint-disable-next-line no-console
		console.log(
			`chips plain ${plain.chips.map((c) => c.toFixed(2)).join(", ")} (pop ${plain.pop.toFixed(2)}); ${hosts
				.map(
					(host, k) =>
						`with --input-height ${HOST_INPUT_HEIGHTS[k]}px: ${host.chips
							.map((c) => c.toFixed(2))
							.join(", ")} (pop ${host.pop.toFixed(2)})`
				)
				.join("; ")}`
		);

		// THE CHIP IS THE BIGGER ONE. Not the 20px chip the owner sent back.
		for (const c of plain.chips) {
			expect(c, "the chip is the small one again").toBeGreaterThanOrEqual(DESKTOP_CHIP_AT_LEAST);
		}

		// THE CLAIM. The host's `height` does not reach the chip, so the
		// chip - and the pop it sits in - is the same size with the host's
		// sheet in the cascade at EITHER of its values as without it. The
		// two host values differ by 14px; a chip the host sized would too.
		hosts.forEach((host, k) => {
			const inputHeight = HOST_INPUT_HEIGHTS[k];
			host.chips.forEach((c, i) => {
				expect(
					c,
					`chip ${i} is ${c.toFixed(2)}px tall under --input-height: ${inputHeight}px, ${plain.chips[
						i
					]?.toFixed(2)}px without the host`
				).toBeCloseTo(plain.chips[i] ?? NaN, 1);
			});
			expect(
				host.pop,
				`the pop's height moved with the host's button rule at --input-height: ${inputHeight}px`
			).toBeCloseTo(plain.pop, 1);
		});
		const [at30, at44] = hosts;
		at30?.chips.forEach((c, i) => {
			expect(c, `chip ${i} differs between the host's two values`).toBeCloseTo(at44?.chips[i] ?? NaN, 1);
		});
	});
});
