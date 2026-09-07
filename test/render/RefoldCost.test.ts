/**
 * WHAT A RE-FOLD COSTS. A measurement, and a guard - NOT a fix.
 *
 * "It kinda stutters, the animation is not smooth" (alan, 2026-09-05,
 * narrowing the window with the fold-order control open). Two causes were
 * proposed: that every resize event re-folds synchronously instead of
 * coalescing into a frame, and that `FoldOrderControl.measure` writes the
 * preview pane's width and forces layout on those same events.
 *
 * NEITHER REPRODUCES HERE, and this file is what says so. Measured on this
 * harness, narrowing 5px at a time with a frame allowed to settle between
 * steps - i.e. the shape of a window drag - across the whole band where the
 * fold actually changes (760px down to 565px, where the second row goes from
 * empty to five buttons):
 *
 *   ResizeObserver callbacks   2.0 - 2.9 per step
 *   scripted time              0.17 - 0.27 ms per step
 *   ResizeObserver loops       0
 *   fold sequence              0, 2, 3, 4, 5 - monotone, no step taken twice
 *
 * Two to three callbacks per resize is the number of observers watching, not
 * an amplification: the control watches its own root, and every live strip
 * watches its pane. A fifth of a millisecond is about one percent of a frame.
 * On that evidence nothing in this plugin's resize path can be the stutter,
 * and no product code was changed for it. The remaining candidates - the
 * editor and the settings modal reflowing, which are Obsidian's - are outside
 * what any harness here can see, and Alan's screen is the only place they can
 * be judged.
 *
 * WHAT THIS THEREFORE GUARDS. `FoldOrderControl.measure` carries a comment
 * saying it is "RE-ENTRANT BY SHAPE" - it writes the stage's height, the
 * stage is inside the element its own observer watches - and that what stops
 * the loop is IDEMPOTENCE rather than the `measuring` latch. Nothing checked
 * that. A change that broke the idempotence would turn every resize into a
 * deferred second layout pass, which is exactly what a stutter is, and the
 * engine would say so: Chrome raises "ResizeObserver loop completed with
 * undelivered notifications". `loops` is that sentence, counted.
 *
 * NOTHING HERE IS TIMED. The millisecond figures above are reported and not
 * asserted, on purpose: a threshold in milliseconds measures the machine
 * running the suite, and this repo has paid for that before (1.4.9, CI).
 * What is asserted is structural and answers the same on any machine.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openFoldOrder, type Browser } from "./harness";

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
}, 120_000);
afterAll(async () => {
	await browser?.close();
});

/**
 * The band the fold actually moves in, walked the way a window drag walks it.
 * Above 715px nothing folds, so a sweep that stopped there would report a
 * perfectly cheap resize by never asking the expensive question.
 */
const FROM = 760;
const STEP = 5;
const STEPS = 40;

describe("narrowing the window with the fold-order control open", () => {
	it("settles every resize inside its own frame, and folds monotonically", async () => {
		const h = await openFoldOrder(browser, {
			viewport: FROM,
			realStrip: true,
			modalWidth: 700,
			sidebar: 250,
		});
		try {
			await h.armReflow();
			const folded: number[] = [];
			const widths: number[] = [];
			for (let i = 0; i < STEPS; i++) {
				const w = FROM - i * STEP;
				await h.setWidth(w);
				const p = await h.probe();
				widths.push(w);
				folded.push(p.previewSecondRow.length);
			}
			const cost = await h.readReflow();

			// PRECONDITION: the sweep has to have crossed the interesting
			// ground. A run where nothing ever folded would satisfy every
			// assertion below and measure nothing.
			expect(folded[0], "the widest step already had a folded row").toBe(0);
			expect(Math.max(...folded), "nothing ever folded over the sweep").toBeGreaterThan(2);

			// THE LOOP. Zero is the whole claim: a resize callback that
			// resizes something it is watching cannot settle inside the frame,
			// and the engine defers the rest to the next one. Every one of
			// these is a frame the user paid for and saw an unfinished layout
			// in.
			expect(
				cost.loops,
				"a resize callback resized something an observer was watching"
			).toBe(0);

			// NO AMPLIFICATION. One callback per observer per resize is the
			// floor and roughly what is seen; a ceiling well above it catches
			// a resize that starts causing further resizes without pinning the
			// exact count of observers this page happens to build.
			expect(cost.callbacks / STEPS).toBeLessThan(8);

			// MONOTONE. Narrowing may fold more buttons or leave the count
			// alone; it may never hand one back. A count that goes up and down
			// across neighbouring widths is a toolbar visibly flickering
			// between two layouts, which is the other thing "stutters" could
			// have meant - and it does not happen.
			for (let i = 1; i < folded.length; i++) {
				expect(
					folded[i]!,
					`folded ${folded[i - 1]} at ${widths[i - 1]}px and ${folded[i]} at ${widths[i]}px`
				).toBeGreaterThanOrEqual(folded[i - 1]!);
			}
		} finally {
			await h.close();
		}
	}, 120_000);
});
