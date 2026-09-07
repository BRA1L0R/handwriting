/**
 * `mouseDrawsFromLitTool` and the widened `mouseActsAsPen`.
 *
 * Alan's ruling, 2026-09-05, verbatim: "button should become the truth" -
 * widened the same day, his own addendum, from the pen nib alone to any lit
 * tool (pen, highlighter, eraser, lasso, insert-space, pan): a device that
 * has never seen a pen has nothing else FOR the mouse to be, so whichever
 * tool is lit is what the mouse now draws with; no lit tool means the mouse
 * selects text, same as ever. See MouseInk.ts for the full ruling and why
 * the predicate is boolean-in rather than reading PenToolsMode.ts itself
 * (a real import cycle - PenToolsMode.ts already imports from this file).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
	clearToolPicked,
	markToolPicked,
	mouseActsAsPen,
	mouseDrawsFromLitTool,
	mouseInkEnabled,
	setMouseInk,
	toolIsLit,
	toolPickedHere,
} from "./MouseInk";
import { penInkEnabled, resetPenInkForTest, setPenInk } from "./PenInk";
import {
	deviceHasNeverSeenAPen,
	markPenHardwareSeen,
	releaseMouseInkQuietly,
	resetPenToolsForTest,
} from "./PenToolsMode";

beforeEach(() => {
	setMouseInk(false);
	resetPenToolsForTest();
	// LAUNCH: pen ink on (its default), nothing picked. Both are module
	// state, and between them they are "is a tool lit".
	resetPenInkForTest();
	clearToolPicked();
});

describe("mouseDrawsFromLitTool: the four cases, pure", () => {
	it("a device that has seen a pen: false, tool lit or not - this predicate never grants it", () => {
		expect(mouseDrawsFromLitTool(false, false)).toBe(false);
		expect(mouseDrawsFromLitTool(false, true)).toBe(false);
	});

	it("pen-less, nothing lit: false - nothing for the mouse to draw with", () => {
		expect(mouseDrawsFromLitTool(true, false)).toBe(false);
	});

	it("pen-less, a tool lit: true - the lit tool IS what the mouse now draws with", () => {
		expect(mouseDrawsFromLitTool(true, true)).toBe(true);
	});
});

describe("mouseActsAsPen: widened without disturbing the explicit switch", () => {
	it("a plain mouse with the persisted/armed switch off and no new grant: false, as ever", () => {
		expect(mouseActsAsPen("mouse")).toBe(false);
		expect(mouseActsAsPen("mouse", false, false)).toBe(false);
	});

	it("the explicit switch alone still wins, exactly as before this rule existed", () => {
		setMouseInk(true);
		expect(mouseActsAsPen("mouse")).toBe(true);
		// The two new parameters default to false/false and change nothing:
		// an existing caller that never learns about this rule keeps its old
		// answer verbatim.
		expect(mouseActsAsPen("mouse", false, false)).toBe(true);
	});

	it("pen-less with a tool lit grants the mouse the tip, with the persisted switch untouched", () => {
		expect(mouseActsAsPen("mouse", true, true)).toBe(true);
		// The grant is session-level only, through this predicate - it never
		// writes the persisted/armed `enabled` flag itself.
		expect(mouseInkEnabled()).toBe(false);
	});

	it("a device that has seen a pen gets no grant from a lit tool alone", () => {
		expect(mouseActsAsPen("mouse", true, false)).toBe(false);
	});

	it("pen-less with nothing lit: still false - text selection, not a stray grant", () => {
		expect(mouseActsAsPen("mouse", false, true)).toBe(false);
	});

	it("never fires for a real pen or touch pointer, regardless of the new grant", () => {
		expect(mouseActsAsPen("pen", true, true)).toBe(false);
		expect(mouseActsAsPen("touch", true, true)).toBe(false);
		expect(mouseActsAsPen(undefined, true, true)).toBe(false);
	});
});

/**
 * The point of DERIVING this rather than storing a flag: a pen-less device
 * that restarts with a tool already lit answers "draws" immediately, with
 * no separate arm step to re-run at load.
 *
 * Read the limitation honestly rather than oversell the name: this base has
 * no persisted pen-seen flag at all (see `deviceHasNeverSeenAPen`'s own
 * docstring, PenToolsMode.ts), so `resetPenToolsForTest()` below is standing
 * in for "before this session's first real pen contact", not literally "a
 * process restart" - a real pen-having device that restarts with a tool lit
 * would ALSO read pen-less here until its pen next touches the glass, which
 * is the documented gap, not a hole in this test.
 */
describe("the addendum's own case: pen-less at reset, a tool already lit, answers 'draws'", () => {
	it("needs no arm step - the answer falls out of the device flag and the lit tool alone", () => {
		// resetPenToolsForTest() just ran (beforeEach): no pen has touched
		// this session yet.
		expect(deviceHasNeverSeenAPen()).toBe(true);
		// A tool being lit is simulated directly - this test is about the
		// derivation, not about how a real caller learns "is a tool lit".
		const toolLit = true;
		expect(mouseDrawsFromLitTool(deviceHasNeverSeenAPen(), toolLit)).toBe(true);
		expect(mouseActsAsPen("mouse", toolLit, deviceHasNeverSeenAPen())).toBe(true);
	});
});

/**
 * `toolIsLit`: THE PREDICATE THE WHOLE `mouse-lit-truth` DEFECT WAS ABOUT.
 *
 * Both callers used to pass their own reading of the PEN-INK flag straight
 * in as "a tool is lit" - `!penOff()` in the router, `penInksHere()` on the
 * strip - and that flag defaults to TRUE. So on a pen-less device, at
 * launch, with nothing picked and the mouse-ink setting off, the grant below
 * fired and a plain left-drag across a word inked instead of selecting it.
 * The pick is the missing half.
 */
describe("toolIsLit: pen ink enabled AND a tool picked, both halves required", () => {
	it("launch: pen ink on by default, nothing picked - not lit", () => {
		expect(penInkEnabled()).toBe(true);
		expect(toolPickedHere()).toBe(false);
		expect(toolIsLit(penInkEnabled())).toBe(false);
	});

	it("a pick with pen ink on: lit", () => {
		markToolPicked();
		expect(toolIsLit(true)).toBe(true);
	});

	it("a pick in keyboard mode: not lit - the caller's own pen-ink read still gates it", () => {
		markToolPicked();
		expect(toolIsLit(false)).toBe(false);
	});

	it("no pick, pen ink off: not lit, for both reasons at once", () => {
		expect(toolIsLit(false)).toBe(false);
	});
});

/**
 * THE FULL CROSS the brief asks for: pen-seen x picked x pen-ink, read the
 * way each real caller reads it - `mouseActsAsPen(type, toolIsLit(penInk),
 * deviceHasNeverSeenAPen())`, which is verbatim what InlinePenRouter.ts's
 * `mouseActsAsPen` method now evaluates.
 *
 * The explicit mouse-ink switch is OFF throughout, deliberately: it ORs over
 * everything here (its own tests are above) and would mask all eight rows.
 */
describe("the whole cross: pen-seen x picked x pen-ink, mouse-ink switch off", () => {
	const draws = (): boolean =>
		mouseActsAsPen("mouse", toolIsLit(penInkEnabled()), deviceHasNeverSeenAPen());

	const set = (penSeen: boolean, picked: boolean, penInk: boolean): void => {
		if (penSeen) markPenHardwareSeen();
		if (picked) markToolPicked();
		// LAST, because `setPenInk(false)` unpicks - that is the rule, not a
		// side effect to work around, so the rows with penInk false and
		// picked true below are asserting exactly that.
		setPenInk(penInk);
	};

	it("pen-less, nothing picked, pen ink on: SELECTS TEXT - the defect, straight from launch", () => {
		set(false, false, true);
		expect(draws()).toBe(false);
	});

	it("pen-less, picked, pen ink on: DRAWS - the ruling's own case", () => {
		set(false, true, true);
		expect(draws()).toBe(true);
	});

	it("pen-less, nothing picked, pen ink off: selects text", () => {
		set(false, false, false);
		expect(draws()).toBe(false);
	});

	it("pen-less, picked, then pen ink off: selects text - keyboard mode unpicks", () => {
		set(false, true, false);
		expect(toolPickedHere()).toBe(false);
		expect(draws()).toBe(false);
	});

	it("pen seen, nothing picked, pen ink on: no grant - the explicit switch is their only way in", () => {
		set(true, false, true);
		expect(draws()).toBe(false);
	});

	it("pen seen, picked, pen ink on: still no grant - a pen device's mouse is left alone", () => {
		set(true, true, true);
		expect(draws()).toBe(false);
	});

	it("pen seen, nothing picked, pen ink off: no grant", () => {
		set(true, false, false);
		expect(draws()).toBe(false);
	});

	it("pen seen, picked, pen ink off: no grant", () => {
		set(true, true, false);
		expect(draws()).toBe(false);
	});
});

/**
 * The two edges that put a tool DOWN, at the level they are written.
 * `releaseMouseInkQuietly` (PenToolsMode.ts) is the one place the mouse
 * put-down lives - both of the strip's put-down branches reach it through
 * the host - and `setPenInk(false)` is keyboard mode.
 */
describe("the unpick edges", () => {
	it("the mouse put-down unpicks, so the mouse goes back to selecting text", () => {
		markToolPicked();
		expect(mouseActsAsPen("mouse", toolIsLit(true), deviceHasNeverSeenAPen())).toBe(true);
		releaseMouseInkQuietly();
		expect(toolPickedHere()).toBe(false);
		expect(mouseActsAsPen("mouse", toolIsLit(true), deviceHasNeverSeenAPen())).toBe(false);
	});

	it("pen-off unpicks rather than masking: coming back to pen ink lights nothing", () => {
		markToolPicked();
		setPenInk(false);
		setPenInk(true);
		expect(penInkEnabled()).toBe(true);
		expect(toolPickedHere()).toBe(false);
		expect(mouseActsAsPen("mouse", toolIsLit(true), deviceHasNeverSeenAPen())).toBe(false);
	});

	it("neither edge touches the explicit mouse-ink switch's own answer", () => {
		setMouseInk(true);
		markToolPicked();
		releaseMouseInkQuietly();
		// `releaseMouseInkQuietly` disarms the switch too - that half is its
		// own, older rule - but nothing here writes a SETTING, and the next
		// launch's `setMouseInk(settings.mouseInk)` is unaffected either way.
		setMouseInk(true);
		setPenInk(false);
		expect(mouseInkEnabled()).toBe(true);
	});
});
