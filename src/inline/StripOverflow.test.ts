/**
 * The fold, attacked with numbers.
 *
 * `MobileTools` measures and moves; `overflowPlan` decides. The suite has no
 * layout at all - every `FakeEl` answers 0 to every dimension - so the rule
 * could not be tested at all if it lived inside the code that measures. It
 * does not, and this is the whole of it.
 *
 * THE WIDTHS BELOW ARE THE REAL ONES, off styles.css: a mobile strip button
 * is 40px (`.is-mobile .handwriting-mobile-tool`), the row's gap is 2px, and
 * a divider is a 9px box with its hairline painted down the middle. So a
 * button costs 42 including its gap and a divider costs 11 - the same eleven
 * it always did, and now the same eleven `offsetWidth` reports, which it did
 * not while the 8px was margin. Using the real numbers is what
 * lets the last two cases below say something about Alan's actual phone
 * rather than about arithmetic.
 */
import { describe, expect, it } from "vitest";
import { gridColumns, overflowPlan, type StripItem } from "./StripOverflow";
import { DEFAULT_FOLD_ORDER } from "./MobileTools";

/** A button and its gap; a divider and its gap. */
const BTN = 42;
const DIV = 11;
const COLLAPSE = 42;
const CHEVRON = 42;

/**
 * The eleven buttons a phone built BEFORE 2026-09-05, in strip order.
 *
 * Kept as it was, deliberately. The cases below it record widths Alan read
 * back off his own screen against exactly this row, and re-baselining them
 * would throw away that evidence to no purpose: what they pin is the
 * ALGORITHM - which id leaves at which width - and the algorithm did not
 * change when Pan came back.
 *
 * What DID change is that Pan is built on every device now and folds instead
 * (see `PHONE_TODAY` below), so this list is one button short of a phone as
 * it ships. Keyboard is here, which is the phone-with-a-stylus case - a phone
 * whose owner has never held a pen builds one fewer, and one of the cases
 * below is exactly that.
 */
const PHONE: StripItem[] = [
	{ id: "handwriting:inline-tool-pen", width: BTN },
	{ id: "handwriting:inline-tool-highlighter", width: BTN },
	{ id: "handwriting:inline-tool-eraser", width: BTN },
	{ id: "handwriting:inline-tool-lasso", width: BTN },
	{ id: "handwriting:inline-tool-space", width: BTN },
	{ id: "handwriting:pen-ink-toggle", width: BTN },
	{ id: "handwriting:delete-selected-ink", width: BTN },
	{ id: "handwriting:copy-selected-ink", width: BTN },
	{ id: "handwriting:paste-ink", width: BTN },
	{ id: "editor:undo", width: BTN },
	{ id: "editor:redo", width: BTN },
];

/** The collapse button plus the three group dividers. */
const FIXED = COLLAPSE + 3 * DIV;

/**
 * Alan's order as it stood for the cases below, amended by him on 2026-09-05.
 * Delete is deliberately absent. Pan is absent too, because it was not a
 * foldable button yet - the tests further down use the SHIPPING order instead,
 * imported rather than restated so that reordering the default breaks them.
 */
const DEMOTE = [
	"editor:redo",
	"handwriting:pen-ink-toggle",
	"handwriting:paste-ink",
	"handwriting:copy-selected-ink",
	"handwriting:inline-tool-space",
];

const plan = (available: number, items: StripItem[] = PHONE): ReturnType<typeof overflowPlan> =>
	overflowPlan({ available, fixed: FIXED, items, chevron: CHEVRON, demote: DEMOTE });

/** What the row costs with nothing folded. */
const FULL = FIXED + PHONE.length * BTN;

describe("overflowPlan: a row that fits is left alone", () => {
	it("gives no chevron and moves nothing when there is room to spare", () => {
		expect(plan(FULL + 200)).toEqual({ moved: [], chevron: false, fits: true });
	});

	// The off-by-one that would put a chevron on a strip that fits exactly -
	// and on a desktop, where the row is meant to be untouched.
	it("counts an exactly-fitting row as fitting", () => {
		expect(plan(FULL)).toEqual({ moved: [], chevron: false, fits: true });
	});

	it("folds as soon as it is one pixel short", () => {
		expect(plan(FULL - 1).chevron).toBe(true);
	});
});

describe("overflowPlan: what folds, and in what order", () => {
	// THE READING ALAN WAS GIVEN and agreed to: "Pen · Highlighter | Eraser ·
	// Lasso · Insert space | Delete · Undo · chevron; second row: Copy ·
	// Paste · Keyboard · Redo". 411px of content width is what produces
	// exactly that - a large phone in landscape, or a small tablet.
	it("produces Alan's stated phone reading at the width that produces it", () => {
		const got = plan(411);
		expect(got.chevron).toBe(true);
		expect(got.moved).toEqual([
			"handwriting:copy-selected-ink",
			"handwriting:paste-ink",
			"handwriting:pen-ink-toggle",
			"editor:redo",
		]);
		// The first row is therefore the seven he read back, in strip order.
		const stayed = PHONE.filter((i) => !got.moved.includes(i.id)).map((i) => i.id);
		expect(stayed).toEqual([
			"handwriting:inline-tool-pen",
			"handwriting:inline-tool-highlighter",
			"handwriting:inline-tool-eraser",
			"handwriting:inline-tool-lasso",
			"handwriting:inline-tool-space",
			"handwriting:delete-selected-ink",
			"editor:undo",
		]);
	});

	// A NARROWER phone takes the fifth entry too, and that is the rule
	// working rather than the rule breaking: Insert space is last in the
	// order Alan gave precisely so it is the last thing to go. Stated here
	// rather than left to be discovered on the device, because his reading
	// above describes a wider screen than a 390px handset gives.
	it("takes insert space as well once the row is narrower still", () => {
		const got = plan(364);
		expect(got.moved).toEqual([
			"handwriting:inline-tool-space",
			"handwriting:copy-selected-ink",
			"handwriting:paste-ink",
			"handwriting:pen-ink-toggle",
			"editor:redo",
		]);
	});

	// The reason the amendment exists. Delete is the frequent action and
	// stays on the first row at every width, which is the same ruling that
	// made the selection three dim rather than hide earlier the same day.
	it("never moves Delete, at any width", () => {
		for (const available of [411, 364, 300, 200, 100, 1]) {
			expect(plan(available).moved).not.toContain("handwriting:delete-selected-ink");
		}
	});

	// THE CHEVRON IS BUTTON-SIZED, so the first demotion buys exactly
	// nothing: it frees 42px and the chevron that made it possible costs 42.
	// Two is the smallest fold that gains any width at all. Written down
	// because it is not obvious from the rule and it is what makes "one
	// button too wide" fold two buttons rather than one.
	it("never folds exactly one button, because the chevron eats that width", () => {
		for (let available = FULL - 1; available > FULL - 400; available -= 7) {
			const moved = plan(available).moved;
			expect(moved.length, `at available=${available}`).not.toBe(1);
		}
	});

	// The stopping rule itself, isolated from that: with a chevron narrower
	// than a button there IS width to gain from the first demotion, and the
	// walk stops the moment the row fits instead of emptying the list.
	it("stops as soon as the row fits, rather than emptying the list", () => {
		const got = overflowPlan({
			available: FULL - 1,
			fixed: FIXED,
			items: PHONE,
			chevron: 20,
			demote: DEMOTE,
		});
		expect(got.moved).toEqual(["editor:redo"]);
	});

	it("reads the second row in the reverse of the order things left", () => {
		const got = plan(364);
		const leftIn = [...got.moved].reverse();
		expect(leftIn).toEqual(DEMOTE);
	});
});

describe("overflowPlan: buttons that are not on this strip", () => {
	/** A phone whose owner has never held a pen: no Keyboard button built. */
	const NO_PEN = PHONE.filter((i) => i.id !== "handwriting:pen-ink-toggle");

	// The bug this rules out: a demotion list that assumed every button
	// exists would count the absent Keyboard as a demotion and stop one
	// button early - on exactly the devices with the least room.
	it("skips an absent button without spending a demotion on it", () => {
		const fullNoPen = FIXED + NO_PEN.length * BTN;
		// Room for the row less two buttons, so two real demotions are needed.
		const got = overflowPlan({
			available: fullNoPen - 2 * BTN + CHEVRON - 1 + BTN,
			fixed: FIXED,
			items: NO_PEN,
			chevron: CHEVRON,
			demote: DEMOTE,
		});
		expect(got.moved).not.toContain("handwriting:pen-ink-toggle");
		// Redo went first, then the list SKIPPED Keyboard and took Paste -
		// it did not stop at the missing entry and it did not count it.
		expect(got.moved).toEqual(["handwriting:paste-ink", "editor:redo"]);
	});
});

describe("overflowPlan: a row that cannot fit however much folds", () => {
	// Every demotable button goes AND the chevron stays, so the folded ones
	// are still reachable. A plan that hid buttons and offered no way back
	// would be strictly worse than the wrap it replaced; the stylesheet's
	// `flex-wrap: wrap` is still underneath this as the failsafe.
	it("folds everything it may and still offers the chevron", () => {
		const got = plan(1);
		expect(got.chevron).toBe(true);
		expect(got.moved.length).toBe(DEMOTE.length);
		expect([...got.moved].reverse()).toEqual(DEMOTE);
	});
});

describe("overflowPlan: the chevron pays for itself", () => {
	// The chevron is on the row for the whole of the calculation, so its
	// width comes out of the budget BEFORE anything is demoted. Without
	// that, a row one button over would demote one button and still clip -
	// by exactly the chevron's width.
	it("charges the chevron before deciding how much to fold", () => {
		// Exactly one button too wide. One demotion frees 42; the chevron
		// costs 42; so one demotion is NOT enough and a second is needed.
		const got = plan(FULL - BTN);
		expect(got.moved.length).toBeGreaterThan(1);
		// A free chevron would have stopped at one, which is the bug.
		const free = overflowPlan({
			available: FULL - BTN,
			fixed: FIXED,
			items: PHONE,
			chevron: 0,
			demote: DEMOTE,
		});
		expect(free.moved).toEqual(["editor:redo"]);
	});
});

/**
 * THE ORDER THAT SHIPS, imported rather than restated.
 *
 * The cases above pin the algorithm against a fixed list; these pin the
 * DEFAULT the plugin actually loads with. Importing it is the point: reorder
 * `DEFAULT_FOLD_ORDER` and these fail, which is what makes them worth having
 * once the order is a setting a user can also change.
 */
describe("overflowPlan: the shipping fold order, and the second row it produces", () => {
	/** A phone as it ships since 2026-09-05: twelve buttons, Pan among them. */
	const PHONE_TODAY: StripItem[] = [
		{ id: "handwriting:inline-tool-pen", width: BTN },
		{ id: "handwriting:inline-tool-highlighter", width: BTN },
		{ id: "handwriting:inline-tool-eraser", width: BTN },
		{ id: "handwriting:inline-tool-lasso", width: BTN },
		{ id: "handwriting:inline-tool-space", width: BTN },
		{ id: "handwriting:inline-tool-pan", width: BTN },
		{ id: "handwriting:pen-ink-toggle", width: BTN },
		{ id: "handwriting:delete-selected-ink", width: BTN },
		{ id: "handwriting:copy-selected-ink", width: BTN },
		{ id: "handwriting:paste-ink", width: BTN },
		{ id: "editor:undo", width: BTN },
		{ id: "editor:redo", width: BTN },
	];

	const FULL_TODAY = FIXED + PHONE_TODAY.length * BTN;

	const today = (available: number, demote: readonly string[] = DEFAULT_FOLD_ORDER) =>
		overflowPlan({ available, fixed: FIXED, items: PHONE_TODAY, chevron: CHEVRON, demote });

	// ALAN'S CHECK, in numbers. 411px is the same content width his original
	// reading came from, and with twelve buttons it folds exactly five. The
	// expected order is DERIVED from the reversal rule rather than asserted:
	// the loop pushes redo, pan, keyboard, paste, copy in fold order, and
	// `.reverse()` makes the second row read from the button that nearly
	// stayed to the one that left first.
	it("folds five at 411px and the second row reads Copy, Paste, Keyboard, Pan, Redo", () => {
		const got = today(411);
		expect(got.chevron).toBe(true);
		expect(got.moved).toEqual([
			"handwriting:copy-selected-ink",
			"handwriting:paste-ink",
			"handwriting:pen-ink-toggle",
			"handwriting:inline-tool-pan",
			"editor:redo",
		]);
		// And the first row is what is left, in strip order.
		const stayed = PHONE_TODAY.filter((i) => !got.moved.includes(i.id)).map((i) => i.id);
		expect(stayed).toEqual([
			"handwriting:inline-tool-pen",
			"handwriting:inline-tool-highlighter",
			"handwriting:inline-tool-eraser",
			"handwriting:inline-tool-lasso",
			"handwriting:inline-tool-space",
			"handwriting:delete-selected-ink",
			"editor:undo",
		]);
	});

	// Pan is SECOND in the default order, so it is the second thing to go and
	// it goes before Keyboard. A two-button fold is the smallest that gains
	// any width (the chevron eats the first), which makes this the narrowest
	// interesting case.
	it("sends redo first and pan second", () => {
		const got = today(FULL_TODAY - 42);
		expect(got.moved).toEqual(["handwriting:inline-tool-pan", "editor:redo"]);
	});

	// THE SETTING'S WHOLE POINT: a different order folds different buttons,
	// in the order the user gave, and the second row still reads as the
	// reverse of the order things left in.
	it("follows a custom order, and the second row is that order reversed", () => {
		const mine = [
			"handwriting:inline-tool-space",
			"handwriting:copy-selected-ink",
			"handwriting:inline-tool-pan",
			"handwriting:paste-ink",
			"handwriting:pen-ink-toggle",
			"editor:redo",
		];
		// The WIDTH decides how many go - five, exactly as with the default
		// order at this width - and the ORDER decides which five and in what
		// sequence. That separation is the point of the setting.
		const got = today(411, mine);
		expect(got.moved).toEqual([
			"handwriting:pen-ink-toggle",
			"handwriting:paste-ink",
			"handwriting:inline-tool-pan",
			"handwriting:copy-selected-ink",
			"handwriting:inline-tool-space",
		]);
		// Read back the other way: the ids that left, in the order they left,
		// are the first five of the custom list.
		expect([...got.moved].reverse()).toEqual(mine.slice(0, 5));
	});

	// An id in the order that this device does not build is skipped without
	// costing a demotion - the guard that keeps a phone with no Keyboard
	// button from stopping one entry early.
	it("skips an id the strip does not have", () => {
		const noKeyboard = PHONE_TODAY.filter((i) => i.id !== "handwriting:pen-ink-toggle");
		const got = overflowPlan({
			available: 411,
			fixed: FIXED,
			items: noKeyboard,
			chevron: CHEVRON,
			demote: DEFAULT_FOLD_ORDER,
		});
		expect(got.moved).not.toContain("handwriting:pen-ink-toggle");
		expect(got.moved).toContain("handwriting:inline-tool-pan");
	});
});

// ----------------------------------------------- did the plan actually work

/**
 * `fits` is the difference between "it folded four buttons and the row now
 * fits" and "it folded every button it had and the row is still too wide".
 * Those were the same answer before - a chevron and a list of ids - and the
 * strip has to tell them apart, because the second one is the state it lays
 * itself out as a grid in.
 */
describe("overflowPlan: whether the row it planned actually fits", () => {
	it("reports a fit when nothing had to move", () => {
		expect(plan(FULL + 200).fits).toBe(true);
	});

	it("reports a fit when folding was enough", () => {
		// Two buttons short of the full row: fewer than the five the order may
		// move, so what comes back is a fold that worked.
		const got = plan(FULL - BTN * 2);
		expect(got.chevron).toBe(true);
		expect(got.moved.length).toBeGreaterThan(0);
		expect(got.moved.length).toBeLessThan(DEMOTE.length);
		expect(got.fits).toBe(true);
	});

	it("reports NO fit when every demotable button has gone and it is still too wide", () => {
		// A pane narrower than the row with everything the order may move
		// already gone.
		const floor = FIXED + (PHONE.length - DEMOTE.length) * BTN + CHEVRON;
		const got = plan(floor - 1);
		expect([...got.moved].sort()).toEqual([...DEMOTE].sort());
		expect(got.fits).toBe(false);
	});

	// The boundary between the two, from the side that matters: one pixel of
	// room decides which layout the strip wears, so an off-by-one here is a
	// strip that drops its dividers a pixel early or keeps them a pixel late.
	it("switches from fit to no-fit at exactly one pixel", () => {
		const floor = FIXED + (PHONE.length - DEMOTE.length) * BTN + CHEVRON;
		expect(plan(floor).fits).toBe(true);
		expect(plan(floor - 1).fits).toBe(false);
	});
});

// ---------------------------------------------------- the shape of the grid

/**
 * THE BALANCED WRAP. `gridColumns` never makes the strip taller than the
 * greedy wrap would have - "it's supposed to be small and out of the way" -
 * and within that height it spreads the controls as evenly as they go.
 */
describe("gridColumns", () => {
	it("gives one line its own length when everything fits on it", () => {
		expect(gridColumns(9, 12)).toBe(9);
		expect(gridColumns(9, 9)).toBe(9);
	});

	it("spreads the remainder instead of stranding it", () => {
		// Eleven cells, five to a line: the greedy wrap is 5, 5, 1 and this is
		// 4, 4, 3. Three lines either way.
		expect(gridColumns(11, 5)).toBe(4);
		// Twelve in three lines comes out square.
		expect(gridColumns(12, 5)).toBe(4);
	});

	it("never uses more lines than the widest packing would have", () => {
		for (let cells = 1; cells <= 20; cells++) {
			for (let perLine = 1; perLine <= 10; perLine++) {
				const cols = gridColumns(cells, perLine);
				expect(cols).toBeLessThanOrEqual(perLine);
				expect(Math.ceil(cells / cols)).toBe(Math.ceil(cells / perLine));
			}
		}
	});

	it("leaves fewer empty cells on the last line than there are lines", () => {
		for (let cells = 1; cells <= 20; cells++) {
			for (let perLine = 2; perLine <= 10; perLine++) {
				const cols = gridColumns(cells, perLine);
				const lines = Math.ceil(cells / cols);
				expect(cols * lines - cells).toBeLessThan(lines);
			}
		}
	});

	// A pane too narrow for one button, and a strip with nothing on it. Both
	// are arithmetic that would otherwise divide by zero.
	it("answers one rather than dividing by zero", () => {
		expect(gridColumns(9, 1)).toBe(1);
		expect(gridColumns(9, 0)).toBe(1);
		expect(gridColumns(0, 5)).toBe(1);
	});
});
