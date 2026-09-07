/**
 * NARROWING THE WINDOW MUST NOT MAKE THE STRIP JUMP.
 *
 * "it also still flickers when narrowing the window with window slider"
 * (alan, 2026-09-06), after "kinda stutters, the animation is not smooth".
 *
 * IT IS NOT A TIMING PROBLEM. `RefoldCost.test.ts` measured the resize path
 * before this: 0.17-0.27ms of script per step, zero ResizeObserver loops, a
 * monotone fold sequence. Nothing there is slow. What was wrong is what the
 * frames CONTAINED, and this file is what found it.
 *
 * WHAT IT WAS. `layoutOverflow` priced the row two ways too generously.
 * `offsetWidth` excludes margin, and each of the three group dividers hid an
 * 8px margin inside it - 24px. And `offsetWidth - clientWidth` is the border
 * and not the padding, because clientWidth is the PADDING box, so the strip's
 * own 4px either side never came out of the budget - 8px more. The plan
 * therefore called rows a fit that were up to 30px too wide; the stylesheet's
 * `flex-wrap: wrap` failsafe took the overflow; and the next demotion, a few
 * pixels later, made the row genuinely fit and un-wrapped it. Run against the
 * code this file was written to catch, the assertion below reads
 *
 *     [ '462px:76 -> 460px:42', '428px:76 -> 426px:42',
 *       '394px:76 -> 392px:42', '360px:76 -> 358px:42' ]
 *
 * - four times in one drag the strip dropped a whole line of toolbar and put
 * it straight back, under the hand. That is the flicker.
 *
 * WHAT IS ASSERTED. That a pane which only ever gets narrower only ever makes
 * the strip taller. A rebound - any frame shorter than the frame before it -
 * is the defect, and the failure names the width it happened at.
 *
 * AND WHAT WAS RULED OUT. The standing suspicion was the forced measurement:
 * `layoutOverflow` toggles `is-more-needed` and `is-more-open` ON, reads every
 * `offsetWidth`, and restores both in a `finally` - so a frame that painted
 * between the toggle and the restore would show the folded row wide open.
 * Two independent witnesses here say it never does, and both would have
 * caught it: `open`, read at the top of every frame, and `settled`, the class
 * list a MutationObserver sees the strip left holding at the end of every
 * task. Neither ever contains `is-more-open`, and `mutations` proves the
 * forced writes were happening in front of both of them.
 *
 * NOTHING HERE IS TIMED, for the reason RefoldCost gives: a threshold in
 * milliseconds measures the machine running the suite. Every number below is
 * a geometry or a count and answers the same on any machine.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launch, openStrip, type Browser, type Harness } from "./harness";
import type { DragProbe } from "./stripPage";

let browser: Browser;
let strip: Harness;
let drag: DragProbe;

/**
 * The whole band the strip changes shape in, walked two pixels per frame -
 * the shape of a hand on a window's edge. Above 500px nothing folds and
 * below 116px there is nothing left to do, so a run that stopped short of
 * either end would report a perfectly steady strip by never asking.
 */
const FROM = 520;
const TO = 116;
const STEP = 2;

beforeAll(async () => {
	browser = await launch();
	strip = await openStrip(browser);
	drag = await strip.drag({ from: FROM, to: TO, step: STEP });
}, 180_000);
afterAll(async () => {
	await strip?.close();
	await browser?.close();
});

describe("dragging a pane narrower, one step per frame", () => {
	it("walks the whole band", () => {
		expect(drag.steps.length).toBe((FROM - TO) / STEP + 1);
		// The strip really did change shape during the run - otherwise every
		// assertion below is about a toolbar that never moved.
		const heights = new Set(drag.steps.map((s) => s.height));
		expect(heights.size).toBeGreaterThan(1);
	});

	it("never gets shorter as the pane gets narrower", () => {
		const rebounds: string[] = [];
		for (let i = 1; i < drag.steps.length; i++) {
			const was = drag.steps[i - 1];
			const now = drag.steps[i];
			if (!was || !now) continue;
			if (now.height < was.height) {
				rebounds.push(`${was.width}px:${was.height} -> ${now.width}px:${now.height}`);
			}
		}
		expect(rebounds).toEqual([]);
	});

	it("never puts a line back either", () => {
		// The same fact counted rather than measured, so a future strip whose
		// lines are not all one height still cannot flicker past this file.
		const rebounds: string[] = [];
		for (let i = 1; i < drag.steps.length; i++) {
			const was = drag.steps[i - 1];
			const now = drag.steps[i];
			if (!was || !now) continue;
			if (now.lines < was.lines) rebounds.push(`${was.width}px -> ${now.width}px`);
		}
		expect(rebounds).toEqual([]);
	});

	it("enters the grid once and stays in it", () => {
		// `is-wrapped` is a decision, so it must behave like one: off while the
		// fold can still cope, on from the width it cannot, and never off
		// again. A class that flipped back and forth would be its own flicker
		// even if the height happened to survive it.
		const flips = drag.steps
			.map((s, i) => (i > 0 && s.wrapped !== drag.steps[i - 1]?.wrapped ? s.width : 0))
			.filter((w) => w > 0);
		expect(flips).toHaveLength(1);
		expect(drag.steps[0]?.wrapped).toBe(false);
		expect(drag.steps[drag.steps.length - 1]?.wrapped).toBe(true);
	});
});

describe("what the drag cost", () => {
	it("never made the engine give up on settling a frame", () => {
		// The new state is a `display: grid` whose column count the same pass
		// writes, so the question this answers is whether the strip's own
		// layout can now feed back into the box its observer watches. It
		// cannot - the observer is on the PARENT - and this is that claim
		// checked rather than argued: Chrome raises "ResizeObserver loop
		// completed with undelivered notifications" the moment it does.
		expect(drag.cost.loops).toBe(0);
	});

	it("delivered about one callback per observer per step", () => {
		// One strip, one observer. A ceiling rather than an equality: what it
		// catches is a resize that starts causing further resizes, not the
		// exact number of observers this page happens to build.
		expect(drag.cost.callbacks / drag.steps.length).toBeLessThan(4);
	});

	// NOT ASSERTED, on purpose and for RefoldCost's reason: a threshold in
	// milliseconds measures the machine running the suite, and this repo has
	// paid for that before. Printed so a run can be read.
	it("reports its scripted milliseconds without asserting them", () => {
		const per = drag.cost.ms / Math.max(1, drag.cost.callbacks);
		// eslint-disable-next-line no-console
		console.log(
			`[strip drag] ${drag.steps.length} steps, ${drag.cost.callbacks} callbacks, ` +
				`${drag.cost.ms.toFixed(1)}ms total, ${per.toFixed(3)}ms per callback`
		);
		expect(drag.cost.ms).toBeGreaterThanOrEqual(0);
	});
});

describe("the forced measurement never reaches a frame", () => {
	it("writes the class attribute on the way past, which is what makes this a test", () => {
		// Six writes per pass that does not bail: three forced on, three put
		// back. If this were zero the two assertions below would be green
		// against an instrument that was not watching.
		expect(drag.mutations).toBeGreaterThan(drag.steps.length);
	});

	it("is never what the strip is left holding at the end of a task", () => {
		// `is-more-needed` is a real state and belongs here; `is-more-open` is
		// only ever forced, because nothing in this run opens the row.
		const open = drag.settled.filter((c) => c.includes("is-more-open"));
		expect(open).toEqual([]);
	});

	it("is never on at a frame boundary", () => {
		const open = drag.steps.filter((s) => s.open).map((s) => s.width);
		expect(open).toEqual([]);
	});
});
