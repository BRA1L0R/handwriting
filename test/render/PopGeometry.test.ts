/**
 * The tool pop, MEASURED.
 *
 * `MobileTools.test.ts` pins what the pop is MADE of - slider, value, saved
 * pens, palette, and no rotated slot - and says so honestly in its own
 * header: "this suite has no layout".
 *
 * This file measures the boxes. Same code path, same stylesheet, a real
 * engine laying it out. It replaces `SliderChipGeometry.test.ts`, which
 * measured the value readout that 1.4.12 removed.
 *
 * THAT READOUT IS BACK (the owner, 2026-09-06: "as well"), on its own row
 * under the track and inside a box of fixed width, and this file is where the
 * reason it can come back is checked. The old one had no box of its own
 * inside a pop that had no width of its own, so the digits set the pop's
 * width and the pop moved under the finger. So the last describe here sweeps
 * each slider from end to end and measures, at every step, that neither the
 * pop nor the track moved by as much as half a pixel - which is a claim about
 * layout, and therefore a claim only a real engine can settle.
 *
 * WHY IT IS WORTH A REAL BROWSER. The whole of item 1 is a claim about SIZE -
 * "it's supposed to be small and out of the way, the UI, that's why people
 * like it" (alan, 2026-09-05) - and a size is the one thing a suite with no
 * layout cannot check. A structural test would pass just as happily on a flat
 * pop that came out taller than the rotated one it replaced.
 *
 * Run: npm run test:render. Deliberately NOT in `npx vitest run` - see
 * `harness.ts` for what this can and cannot answer.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { hostVars, launch, openStrip } from "./harness";
import type { PopBox } from "./stripPage";

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
});
afterAll(async () => {
	await browser?.close();
});

/**
 * WHAT THE OLD POP MEASURED, on this same harness, before the rebuild - and
 * the reason every ceiling below is a number rather than a feeling.
 *
 * Taken by running this file against the previous commit's `MobileTools.ts`
 * and `styles.css`, with everything else - this file, the probe, the page,
 * the harness - held exactly as it is now:
 *
 *   pen, no pens saved       116.00 x 232      slider 16 x 96, rotated
 *   pen, four pens saved     144.00 x 232      opacity 0.92
 *   highlighter, four saved  144.00 x 232
 *   eraser                   113.48 x 167
 *
 * Two things to read off that. The height is where the redesign has to show,
 * because a pop hangs over the page the user is writing on, and 104px of that
 * 232 was the rotated slider's slot with ~25 more for the readout under it.
 * And the pen pop was TWO WIDTHS - 116 with nothing starred, 144 once four
 * pens were - which is the width the flat pop now holds at all times.
 */
const OLD = {
	penWidth: 144,
	penHeight: 232,
	eraserHeight: 167,
} as const;

/**
 * The pop's declared width. Not a target the design is aiming at - it is the
 * width the OLD pop already reached whenever four pens were saved, which is
 * why widening to it costs nothing: see `.handwriting-slider-pop`.
 */
const POP_WIDTH = 144;

const openPop = async (
	tool: "pen" | "highlighter" | "eraser",
	presets = 0
): Promise<{ box: PopBox; close: () => Promise<void> }> => {
	const h = await openStrip(browser, {});
	const box = await h.pop({ tool, presets });
	return { box, close: h.close };
};

describe("the pop is shorter than the one it replaces", () => {
	it("takes a third off the pen pop's height", async () => {
		const { box, close } = await openPop("pen", 4);
		try {
			// THE CLAIM, in the dimension that matters. A pop hangs over the
			// note; its height is how much of the note it covers.
			expect(box.pop.height).toBeLessThan(OLD.penHeight * 0.7);
			// And it is a real pop, not a collapsed one - a zero-height box
			// would satisfy the line above and mean nothing.
			expect(box.pop.height).toBeGreaterThan(100);
		} finally {
			await close();
		}
	});

	it("is never wider than the pop already got with four pens saved", async () => {
		const { box, close } = await openPop("pen", 4);
		try {
			expect(box.pop.width).toBeLessThanOrEqual(OLD.penWidth);
		} finally {
			await close();
		}
	});

	it("covers less of the page than it used to, all told", async () => {
		const { box, close } = await openPop("pen", 4);
		try {
			const area = box.pop.width * box.pop.height;
			expect(area).toBeLessThan(OLD.penWidth * OLD.penHeight);
		} finally {
			await close();
		}
	});

	it("shortens the eraser's pop too, which shares the container", async () => {
		const { box, close } = await openPop("eraser");
		try {
			expect(box.pop.height).toBeLessThan(OLD.eraserHeight * 0.7);
			// Chips and a slider, no hairlines: the eraser's pop has no
			// sections to divide.
			expect(box.children).toEqual([
				"handwriting-mode-chips",
				"handwriting-eraser-slider",
				"handwriting-slider-num",
			]);
		} finally {
			await close();
		}
	});
});

describe("the pop does not change shape as it is used", () => {
	/**
	 * THE JUDDER, measured. The pop had no width of its own, so it took its
	 * widest child's - and starring a fourth pen makes the preset row 28px
	 * wider. `hangUnder` re-centres the pop from that measured width on every
	 * refresh, so the pop, and the slider inside it, jumped sideways under
	 * the finger. A declared width is what makes the two measurements equal.
	 */
	it("is the same width with no pens saved and with four", async () => {
		const empty = await openPop("pen", 0);
		const full = await openPop("pen", 4);
		try {
			expect(empty.box.pop.width).toBe(full.box.pop.width);
			expect(empty.box.pop.width).toBe(POP_WIDTH);
			// The two states really are different, or the line above compares
			// a thing with itself. The row went from the lone star to four
			// saved pens and the star - which is exactly the change that took
			// the old pop from 116px to 144px (see OLD).
			const rowOf = (b: PopBox) => b.rows["handwriting-pop-presets"]!;
			expect(rowOf(empty.box).count).toBe(1);
			expect(rowOf(full.box).count).toBe(5);
			// The row's own box cannot report that growth any more: it is
			// `width: 100%` of a pop that no longer moves, which is the fix
			// itself. Its CONTENT is what grew.
		} finally {
			await empty.close();
			await full.close();
		}
	});

	it("is the same width for the pen and the highlighter", async () => {
		const pen = await openPop("pen", 4);
		const hl = await openPop("highlighter", 4);
		try {
			expect(pen.box.pop.width).toBe(hl.box.pop.width);
		} finally {
			await pen.close();
			await hl.close();
		}
	});

	it("keeps every row inside the pop it is declared to fit", async () => {
		const { box, close } = await openPop("pen", 4);
		try {
			// A full preset row is the widest thing the pop holds, and it is
			// sized to the pop's content box exactly. Anything wider would
			// either overflow the border or wrap onto a second line and make
			// the pop taller - both of which are the shape changing.
			for (const [cls, row] of Object.entries(box.rows)) {
				expect(row.width, `${cls} overflows the pop`).toBeLessThanOrEqual(box.pop.width);
			}
			const presets = box.rows["handwriting-pop-presets"]!;
			// Four saved pens plus the star, on ONE line: the row's height is
			// a single cell's, not two.
			expect(presets.count).toBe(5);
			expect(presets.height).toBeLessThan(30);
		} finally {
			await close();
		}
	});
});

describe("the slider is flat and can be hit with a finger", () => {
	for (const tool of ["pen", "highlighter", "eraser"] as const) {
		it(`lays ${tool}'s slider across the pop, unrotated`, async () => {
			const { box, close } = await openPop(tool, 4);
			try {
				// NOT ROTATED. The old slider wore `translate(-50%, -50%)
				// rotate(-90deg)`, which is what let a 100px control live in a
				// 28px-wide column - and what made its drag axis vertical.
				expect(box.slider.transform).toBe("none");
				// Wider than it is tall is the whole of "horizontal", and it
				// cannot be satisfied by a rotated slider whose LAYOUT box is
				// unrotated, because that box was 96 x 22 lying down inside a
				// 28 x 104 slot.
				expect(box.slider.width).toBeGreaterThan(box.slider.height * 2);
				// It spans the pop rather than sitting in a column of it.
				expect(box.slider.width).toBeGreaterThan(box.pop.width * 0.8);
				// MORE TRAVEL than the rotated slot gave it (96px), which is
				// the argument for widening the pop at all.
				expect(box.slider.width).toBeGreaterThan(96);
				// A REAL TARGET. A range input takes a press anywhere in its
				// own box, so the box's height is the finger's target, and
				// the bare control is 4px of track.
				expect(box.slider.height).toBeGreaterThanOrEqual(20);
			} finally {
				await close();
			}
		});
	}
});

/**
 * THE TRAP, and the only reason the number could be given back.
 *
 * "Weird distortion on the pen slider as i slide it up and down, like the
 * slider is just vibrating" (alan, on hardware, 2026-09-02). It was the POP
 * that moved: it had no width of its own, so its width was its widest child's,
 * and `hangUnder` re-centres it from that measured width on every refresh - so
 * "3" becoming "64" slid the whole control sideways under the finger.
 *
 * Two independent things now stop that, and this file measures each of them
 * separately rather than trusting either alone: the pop DECLARES its width, so
 * nothing it holds can set it; and the readout has a box of its own of FIXED
 * width, so the track above it does not depend on the digits either. A sweep
 * from one end of a slider's range to the other is the honest way to ask -
 * every value the control can hold, in the widths the engine really gave them.
 */
describe("the value under the track cannot move the track", () => {
	/**
	 * HALF A CSS PIXEL. Not zero: these are measured rects, and a rect that
	 * differs in the last place of a `toFixed(2)` is not a knob that moved.
	 * Half a pixel is under the threshold at which anything is visible, and
	 * well under the several pixels the old readout used to shift the pop by.
	 */
	const TOLERANCE = 0.5;

	/**
	 * The readout's format, RESTATED rather than imported: the value
	 * rounded to the control's own step, with the px unit. Asking the
	 * component how it formats and then checking it formatted that way
	 * would pass on any format at all, including the bare number this
	 * replaced.
	 */
	const DECIMALS = { pen: 1, highlighter: 0, eraser: 0 } as const;
	const shown = (tool: keyof typeof DECIMALS, v: string): string =>
		`${Number(v).toFixed(DECIMALS[tool])}px`;

	for (const tool of ["pen", "highlighter", "eraser"] as const) {
		it(`sweeps ${tool}'s slider end to end without moving anything`, async () => {
			const h = await openStrip(browser, {});
			try {
				const probe = await h.readout({ tool, presets: 4 });
				// A sweep of one step is not a sweep, and every comparison
				// below would be a value against itself.
				expect(probe.steps.length).toBeGreaterThan(1);

				// ACCEPTANCE 1: the readout says what the control holds, at
				// every value the control can hold, IN PIXELS AND ROUNDED TO
				// THE STEP. This asserted the raw value string until the owner
				// ruled for pixels; the pen is the tool that proves the
				// rounding does something, since its 0.66 shows as 0.7px.
				for (const step of probe.steps) {
					expect(step.text, `${tool} at ${step.value}`).toBe(shown(tool, step.value));
				}

				const first = probe.steps[0]!;
				const last = probe.steps[probe.steps.length - 1]!;
				// The ends of the range, which is where the digits differ most.
				expect(Math.abs(first.popWidth - last.popWidth)).toBeLessThanOrEqual(TOLERANCE);
				expect(Math.abs(first.trackLeft - last.trackLeft)).toBeLessThanOrEqual(TOLERANCE);
				expect(Math.abs(first.trackWidth - last.trackWidth)).toBeLessThanOrEqual(TOLERANCE);
				expect(Math.abs(first.popHeight - last.popHeight)).toBeLessThanOrEqual(TOLERANCE);
				expect(Math.abs(first.numWidth - last.numWidth)).toBeLessThanOrEqual(TOLERANCE);
				// And not just the ends: the two numbers a moving pop would
				// move took exactly ONE value each across the whole sweep.
				expect(new Set(probe.steps.map((s) => s.popWidth)).size).toBe(1);
				expect(new Set(probe.steps.map((s) => s.trackLeft)).size).toBe(1);

				// THE RESERVATION HOLDS: the glyphs fit the box that was set
				// aside for them, so nothing is being held still by overflow
				// that a wider face would spill. Measured as ink, from a
				// Range, rather than as the box's own width.
				for (const step of probe.steps) {
					expect(step.textWidth, `${tool}'s "${step.text}" overflows`).toBeLessThanOrEqual(
						step.numWidth + 0.01
					);
				}

				// A REAL ROW, not a collapsed one: a zero-width box would
				// satisfy every line above and show the user nothing.
				expect(first.numWidth).toBeGreaterThan(0);

				// AND THE COMPARISON IS NOT VACUOUS. The eraser's readouts run
				// "3px" to "64px" and the highlighter's "4px" to "24px", so
				// those two sweeps really do put different numbers of glyphs
				// into the box that did not move. The pen's cannot: its range
				// is 0.66-6.6 rounded to its 0.1 step, so every value it shows
				// is "d.dpx" - FIVE characters, every time.
				//
				// This said four until the owner ruled for pixels, when the
				// readout stopped being the raw value string; the reservation
				// went 4ch -> 6ch with it, sized for the widest label any of
				// the three can show, which is the pen's "6.6px". The box is
				// deliberately not sized to the character count: `ch` is the
				// width of a "0" and the unit's two letters are narrower, so
				// the spare is real rather than slack. The overflow assertion
				// above is what actually holds that honest.
				const lengths = new Set(probe.steps.map((s) => s.text.length));
				if (tool === "pen") expect([...lengths]).toEqual([5]);
				else expect(lengths.size).toBeGreaterThan(1);
			} finally {
				await h.close();
			}
		});
	}
});

describe("the pop is opaque", () => {
	/**
	 * It shipped at `opacity: 0.92`, which put the page's own text and ink
	 * through the palette underneath it. A swatch that shows something else
	 * through itself is not showing its colour, which is the one thing a
	 * swatch is for.
	 */
	it("paints its background rather than letting the page through", async () => {
		const { box, close } = await openPop("pen", 4);
		try {
			expect(Number(box.opacity)).toBe(1);
		} finally {
			await close();
		}
	});
});

/**
 * "On note5c the ink color selection circles come out as ovals, not sure
 * why" - a real user, on a Boox Note5C nobody here has. Nobody has
 * reproduced it, and this describe does not claim to: `.handwriting-pop-colors`
 * had this exact defect and was fixed at 1.4.6 by giving its swatches a
 * FIXED grid track (see that rule) rather than an `auto` one, precisely
 * because an `auto` track's minimum is content-based and can be squeezed.
 * One row up, `.handwriting-pop-presets` is a flex row whose cells are sized
 * the same 22x22 but were never given the flex row's equivalent of that
 * fix - `flex-shrink: 0` - so they carried the default `flex-shrink: 1` and
 * were exactly as squeezable as the swatch grid was before 1.4.6.
 *
 * WHAT NARROWS THE POP on a real device is not established here and this
 * suite cannot establish it: `.handwriting-slider-pop` declares its own
 * width (144px), so nothing in a normal layout - no container this repo
 * builds - narrows it, and `harness.ts` says plainly this facility answers
 * nothing about a real device's font stack, scaling or pixel ratio. What
 * CAN be established with a real engine is the one link in the chain that
 * does not need the device: IF the pop's box ever ends up narrower than the
 * row needs - for whatever reason - does a 22px chip stay 22px square, or
 * does its width give while its `height: 22px` holds. That is what an oval
 * is, and it is what this test forces and measures directly, with an
 * override layered on top of the real stylesheet standing in for whatever
 * narrows the box on the reported hardware.
 */
describe("the preset chips do not go oval when their row has no room", () => {
	/**
	 * Well under the row's 126px natural need (five 22px cells, four 4px
	 * gaps) once the pop's own padding and border are subtracted - see
	 * `.handwriting-slider-pop`, whose box-sizing is `border-box` and stays
	 * that way under this override, since only `width` is named here.
	 */
	const SQUEEZED_POP_WIDTH = 90;

	it("holds each chip's measured width equal to its measured height", async () => {
		const h = await openStrip(browser, {});
		try {
			await h.page.addStyleTag({
				content: `.handwriting-slider-pop { width: ${SQUEEZED_POP_WIDTH}px !important; }`,
			});
			const box = await h.pop({ tool: "pen", presets: 4 });

			// THE SQUEEZE ACTUALLY HAPPENED, or everything below is vacuous: the
			// row is a full five cells, and its own content box is well short of
			// what those five cells and their gaps need.
			const row = box.rows["handwriting-pop-presets"]!;
			expect(row.count).toBe(5);
			expect(row.width).toBeLessThan(126);

			const chips = await h.page.evaluate(() =>
				[
					...document.querySelectorAll(".handwriting-preset-chip, .handwriting-preset-star"),
				].map((el) => {
					const r = el.getBoundingClientRect();
					return { width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
				})
			);
			expect(chips.length).toBe(5);
			for (const chip of chips) {
				// Not a collapsed box: a 0x0 chip would pass "width equals height"
				// and prove nothing.
				expect(chip.height).toBeGreaterThan(15);
				expect(
					Math.abs(chip.width - chip.height),
					`chip measured ${chip.width} x ${chip.height} - that is an oval`
				).toBeLessThanOrEqual(0.5);
			}
		} finally {
			await h.close();
		}
	});
});

/**
 * THE HOST MAKES THESE CONTROLS OVAL, and the plugin loses the cascade.
 *
 * The report was "the ink color selection circles come out as ovals" on a
 * Boox Note5C (jakolson, 2026-09-07). The squeeze pinned above is a real
 * mechanism but not that one: it needs the pop narrowed, and the pop is a
 * hardcoded 144px. This is the one Architect 2 reproduced against the
 * INSTALLED app - 216 cases, real Chromium, real MobileTools - and it needs
 * nothing narrowed at all.
 *
 * Obsidian 1.13.7 ships `.is-tablet button:not(.clickable-icon) { padding:
 * var(--size-4-1) var(--size-4-5) }`. That selector is (0,2,1). The plugin
 * said `padding: 0` on a single class, which is (0,1,0), so THE HOST WINS:
 * 20px of padding on each side plus two border pixels force a declared 22px
 * control to 42px wide while `height: 22px` holds it at 22. 42 x 22, in BOTH
 * rows - and the colour grid's fixed 22px tracks cannot help, because a track
 * cannot shrink a padding floor. That is why the report says COLOUR circles
 * and why the earlier grid fix did not cover it.
 *
 * The fix ties the host's specificity and wins on sheet order. This test is
 * what proves it, so it must fail on the code as it was: at 42 x 22, both
 * with and without the `flex-shrink: 0` above.
 */
describe("the host's tablet button padding does not turn the pop's circles into ovals", () => {
	/**
	 * Obsidian's OWN rule, hand-reduced to the one declaration that moves the
	 * box, in the style of `test/render/fixtures/`. Source: the CSS bundled in
	 * the installed app (C:/Program Files/Obsidian/resources/obsidian.asar,
	 * app.css sha256 f612f1e8f36486fa57f3b8bd45f0c848409d5b168002e757a13c6d286a7b4c41),
	 * read 2026-09-07 from Obsidian 1.13.7. Layered UNDER the plugin sheet, in
	 * the order Obsidian loads a plugin's stylesheet - which is the whole point:
	 * a rule the plugin never overrode is invisible to every other test here.
	 */
	const HOST_TABLET_BUTTON_CSS = [
		".is-tablet button:not(.clickable-icon) {",
		"\tpadding: var(--size-4-1) var(--size-4-5);",
		"}",
	].join("\n");

	/** The app's own values for the two tokens that rule reads. */
	const HOST_TABLET_VARS = hostVars({ "--size-4-1": "4px", "--size-4-5": "20px" });

	const SIDE = 22;
	const TOL = 0.5;

	type Rect = { w: number; h: number; left: number; right: number; top: number; bottom: number };

	/** Build the pop with the host rule under us, optionally on a tablet. */
	const measure = async (tablet: boolean) => {
		const h = await openStrip(browser, { hostCss: [HOST_TABLET_BUTTON_CSS, HOST_TABLET_VARS] });
		if (tablet) await h.page.evaluate(() => document.body.classList.add("is-tablet"));
		const box = await h.pop({ tool: "pen", presets: 4 });
		const seen = await h.page.evaluate(() => {
			const rect = (el: Element) => {
				const r = el.getBoundingClientRect();
				return {
					w: +r.width.toFixed(2),
					h: +r.height.toFixed(2),
					left: +r.left.toFixed(2),
					right: +r.right.toFixed(2),
					top: +r.top.toFixed(2),
					bottom: +r.bottom.toFixed(2),
				};
			};
			// The harness leaves one pop per tool in the DOM, and only one of
			// them holds a preset row - so anchor on the row and take the pop
			// that owns it, never "the first pop".
			const row = document.querySelector(".handwriting-pop-presets")!;
			const pop = row.closest(".handwriting-slider-pop")!;
			return {
				pop: rect(pop),
				swatches: [...pop.querySelectorAll(".handwriting-color-swatch")].map(rect),
				chips: [...pop.querySelectorAll(".handwriting-preset-chip, .handwriting-preset-star")].map(rect),
			};
		});
		return { h, box, seen };
	};

	/** Square, and not collapsed to nothing - a 0x0 box is square too. */
	const assertSquare = (what: string, rects: Rect[]) => {
		for (const r of rects) {
			expect(r.h, `${what} measured ${r.w} x ${r.h}`).toBeGreaterThan(15);
			expect(
				Math.abs(r.w - r.h),
				`${what} measured ${r.w} x ${r.h} - that is an oval, not a circle`
			).toBeLessThanOrEqual(TOL);
			expect(Math.abs(r.w - SIDE), `${what} is ${r.w}px wide, not ${SIDE}px`).toBeLessThanOrEqual(TOL);
		}
	};

	/** Neighbours in one row must not sit on top of each other. */
	const assertNoOverlap = (what: string, rects: Rect[]) => {
		const rows = new Map<number, Rect[]>();
		for (const r of rects) {
			const key = Math.round(r.top);
			rows.set(key, [...(rows.get(key) ?? []), r]);
		}
		for (const [, row] of rows) {
			const sorted = [...row].sort((a, b) => a.left - b.left);
			for (let i = 1; i < sorted.length; i++) {
				expect(
					sorted[i]!.left,
					`${what} overlap: one ends at ${sorted[i - 1]!.right}, the next starts at ${sorted[i]!.left}`
				).toBeGreaterThanOrEqual(sorted[i - 1]!.right - TOL);
			}
		}
	};

	/** And nothing may hang outside the pop that owns it. */
	const assertInside = (what: string, pop: Rect, rects: Rect[]) => {
		for (const r of rects) {
			expect(r.left, `${what} starts at ${r.left}, outside the pop at ${pop.left}`).toBeGreaterThanOrEqual(pop.left - TOL);
			expect(r.right, `${what} ends at ${r.right}, outside the pop at ${pop.right}`).toBeLessThanOrEqual(pop.right + TOL);
		}
	};

	it("keeps both rows square, unoverlapped and inside the pop with the tablet rule loaded", async () => {
		const { h, box, seen } = await measure(true);
		try {
			// Anti-vacuity: the controls this is about actually exist.
			expect(seen.chips.length).toBe(5);
			expect(seen.swatches.length).toBeGreaterThanOrEqual(4);
			expect(box.rows["handwriting-pop-presets"]!.count).toBe(5);

			assertSquare("a colour swatch", seen.swatches);
			assertSquare("a preset chip", seen.chips);
			assertNoOverlap("colour swatches", seen.swatches);
			assertNoOverlap("preset chips", seen.chips);
			assertInside("a colour swatch", seen.pop, seen.swatches);
			assertInside("a preset chip", seen.pop, seen.chips);
		} finally {
			await h.close();
		}
	});

	it("is square on the desktop cascade too, so the fix did not just move the problem", async () => {
		const { h, seen } = await measure(false);
		try {
			expect(seen.chips.length).toBe(5);
			assertSquare("a colour swatch", seen.swatches);
			assertSquare("a preset chip", seen.chips);
		} finally {
			await h.close();
		}
	});
});
