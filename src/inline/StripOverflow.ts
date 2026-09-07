/**
 * Which strip buttons fold onto a second row when the first one will not fit.
 *
 * THE PROBLEM, in the owner's words (2026-09-05): "13 buttons is too much,
 * especially on phone". Three of those thirteen have gone elsewhere this
 * release - the colour into the nib pops, Pan to devices with no finger,
 * Keyboard to devices that have held a pen - and on a phone that still leaves
 * a row wider than the glass.
 *
 * WHAT IT DID BEFORE. `.handwriting-mobile-tools` carries `flex-wrap: wrap`
 * with the comment "Phones: the row is wider than the screen wants; wrap
 * instead of clip", so the overflow already existed and was already visible -
 * as a ragged second line that appeared without being asked for and put
 * whichever buttons happened not to fit underneath the others. Wrapping is
 * the right FAILSAFE and the wrong design: nobody chose what went below the
 * fold, and it changed with the pane's width.
 *
 * WHAT IT DOES NOW. A `chevron-down` "More" button appears at the end of the
 * row, and named buttons move under it in a fixed order until the row fits.
 * When the row fits there is no chevron, one row, and nothing has moved -
 * which is every desktop and every tablet.
 *
 * THE ORDER IS ALAN'S, amended once (2026-09-05, after he read the first
 * one): "delete and keyboard mode should be swapped, and keyboard mode wont
 * even appear if they dont use a pen right?" So Delete STAYS - it is the
 * frequent action, and dimming rather than hiding it was already his ruling
 * this same day - and Keyboard leaves early, being both rarer and, on a
 * mouse-only device, absent to begin with.
 *
 * PURE, and separate from `MobileTools` for the reason every measured thing
 * in this plugin ends up separate from the thing that measures: the suite has
 * no layout at all (`FakeEl.offsetWidth` is 0), so a rule that lived inside
 * the measuring code could only be tested by not testing it. What is
 * measured is widths; what is decided is this, and this can be attacked with
 * numbers.
 */

/** One first-row candidate, and the width it costs INCLUDING its own gap. */
export interface StripItem {
	id: string;
	width: number;
}

export interface OverflowInput {
	/** Content width the row may occupy, in px. */
	available: number;
	/**
	 * Width consumed by everything on the row that can never move - the
	 * collapse chevron, the recording dot, the group dividers - including
	 * their gaps. Folded into one number because none of it is a decision:
	 * the plan can only choose among `items`.
	 */
	fixed: number;
	/** The tool buttons, in the order they sit on the strip. */
	items: readonly StripItem[];
	/** What the "More" button costs when it appears, including its gap. */
	chevron: number;
	/** Button ids, in the order they leave the first row. */
	demote: readonly string[];
}

export interface OverflowPlan {
	/**
	 * Ids that belong on the second row, IN THE ORDER THEY READ THERE -
	 * which is the reverse of the order they were demoted in, so the button
	 * that only just failed to fit sits first. On a phone that comes out as
	 * Copy, Paste, Keyboard, Redo, which is the reading the owner was given
	 * and agreed to.
	 */
	moved: string[];
	/** Whether the "More" button is on the row at all. */
	chevron: boolean;
	/**
	 * Whether the row this plan describes ACTUALLY FITS.
	 *
	 * False is the case the paragraph above admits to: every demotable button
	 * has gone and the row is still too wide, so the stylesheet's wrap takes
	 * over. `MobileTools` needs that as a fact rather than as an inference,
	 * because a wrapped strip is laid out differently - dividers off, an even
	 * grid on - and "did the plan work" is the only honest way to know it
	 * wrapped without measuring the strip's own height, which is an output of
	 * the very layout the answer would feed.
	 */
	fits: boolean;
}

/**
 * Fit the row, or fold it.
 *
 * Returns the empty plan whenever the row already fits - no chevron, nothing
 * moved - so "it fits" and "it fits once four things move" are different
 * answers rather than the same answer with a count.
 *
 * A row that cannot fit even with every demotable button gone still gets the
 * chevron and the full demotion: the alternative is a plan that hides buttons
 * AND still clips, and the strip wraps underneath either way. Nothing here
 * can produce a clipped, chevron-less row that the user has no way to reach
 * the missing buttons from. That case reports `fits: false`, which is what
 * puts the strip into its grid (`gridColumns` below, `is-wrapped` in
 * MobileTools) rather than leaving it to the stylesheet's greedy failsafe.
 */
export function overflowPlan(input: OverflowInput): OverflowPlan {
	const { available, fixed, items, chevron, demote } = input;
	const width = (id: string): number => items.find((i) => i.id === id)?.width ?? 0;
	let total = fixed;
	for (const item of items) total += item.width;
	// The whole row, as it stands. Note this is `<=`: a row exactly as wide
	// as the space it has fits, and an off-by-one here would put a chevron on
	// every strip that happened to be exact.
	if (total <= available) return { moved: [], chevron: false, fits: true };
	// The chevron is not free, and it is on the row for the whole of the rest
	// of this calculation - so it comes out of the budget BEFORE anything is
	// demoted, or the first demotion would be measured against a row that
	// does not exist.
	//
	// A CONSEQUENCE WORTH KNOWING: the chevron is itself a strip button and
	// is therefore exactly one button wide, so the FIRST demotion nets zero
	// and two is the smallest fold that gains any width. That is why a row
	// one button too wide folds two buttons rather than one, which otherwise
	// looks like an off-by-one. Pinned by a test rather than left here.
	const budget = available - chevron;
	const order: string[] = [];
	for (const id of demote) {
		if (total <= budget) break;
		// An id that is not on this strip costs nothing and moves nothing.
		// The fold list names Keyboard, which is absent on a device that has
		// never held a pen, so a list that assumed every button exists would
		// silently stop demoting one entry early on exactly the devices that
		// need it most. Pan was a second such button until 2026-09-05; it is
		// built on every device now and folds like the rest, but the guard
		// stays - Keyboard still needs it, and a saved fold order can name an
		// id this build does not have.
		if (!items.some((i) => i.id === id)) continue;
		order.push(id);
		total -= width(id);
	}
	// Reversed: last demoted reads first. The second row then runs from the
	// button that nearly stayed to the button that left first, which is the
	// order the owner read back ("Copy, Paste, Keyboard, Redo") for a fold
	// list of redo, keyboard, paste, copy.
	//
	// With Pan second in the default list (redo, pan, keyboard, paste, copy,
	// insert space), a pane narrow enough to fold five reads back as Copy,
	// Paste, Keyboard, Pan, Redo - derived from this line, not asserted, and
	// pinned by a test.
	// `total <= budget` is the loop's own stopping condition, re-read rather
	// than tracked: the loop stops either because the row fits or because the
	// demote list ran out, and this is which of the two happened.
	return { moved: order.reverse(), chevron: true, fits: total <= budget };
}

/**
 * How many columns an even grid of `cells` gets when `perLine` of them fit.
 *
 * WHY A GRID AT ALL. Below the width where `overflowPlan` runs out of buttons
 * to fold, the row is wider than the pane and `flex-wrap: wrap` takes the
 * overflow - greedily, line by line, with whatever is left over sitting alone
 * on the last one. Alan, with a screenshot (2026-09-06): "hide the dividers
 * whenver the strip is wrapped and thenmake the wrap an even grid".
 *
 * WHAT EVEN MEANS HERE. Not "as many per line as fit" - that is the greedy
 * wrap, and it is what leaves one button stranded under eleven. It is the
 * balanced wrap: keep the number of LINES that the widest packing would have
 * used, and then spread the cells across those lines as evenly as they go.
 * Eleven cells that fit five to a line take three lines either way; five,
 * five and one is the ragged answer and four, four, three is this one.
 *
 * The strip must not get taller to look tidier - "it's supposed to be small
 * and out of the way" - which is why the line count is taken first and the
 * column count is derived from it rather than the other way round.
 *
 * PURE, and here rather than in `MobileTools`, for the reason `overflowPlan`
 * is: the suite has no layout, so a rule that lived beside the measuring
 * could only be tested by not testing it.
 */
export function gridColumns(cells: number, perLine: number): number {
	// A pane too narrow for a single button, or a strip with nothing on it.
	// One column is the only answer that is not a division by zero.
	if (cells <= 0 || perLine <= 1) return 1;
	if (cells <= perLine) return cells;
	const lines = Math.ceil(cells / perLine);
	return Math.ceil(cells / lines);
}
