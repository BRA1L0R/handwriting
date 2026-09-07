/**
 * How far a live pen contact's guards reach.
 *
 * Alan, 2026-09-05: "i cant poke another note to switch while my pen eraser
 * end is touching the screen". With the eraser resting on the page, a finger
 * tap in the file explorer, on a tab, on the ribbon - anywhere in the app -
 * did nothing at all until the pen lifted.
 *
 * The mechanism is `armOwnership()` in InlinePenRouter.ts, and it is worth
 * saying exactly what it is, because the obvious suspects are innocent. The
 * stylus-touch eater on the same window already asks `scrollEl.contains(target)`
 * before it does anything, and the pen-hover palm gate lives in `pointerDown`
 * on the scroller, so neither of them can see a touch in another pane. The
 * ownership guard could: it registers WINDOW-capture listeners for the
 * mouse-like fallout a claimed pen leaks (`mousedown`, `mouseup`, `click`,
 * `dblclick`, `auxclick`, `dragstart`, `selectstart`, `contextmenu`) and it
 * never looked at `event.target` at all. A finger poke anywhere on the glass
 * arrives as exactly those compatibility events, and
 * `suppressNativeFallout({ activeStroke: true })` answers true
 * unconditionally, so the poke was eaten before Obsidian's own handlers -
 * which sit at document level, below the window - could see it.
 *
 * The guard is doing its job on the page and only its reach was wrong. Its
 * job is real: a palm resting on the page while writing must still be
 * swallowed, and so must the eraser's caret-drag leak that put it there. But
 * a click in the file explorer was never the palm this guard exists to
 * reject, and it was never the editor's caret either.
 *
 * So the rule is one sentence: a pen or eraser contact on an ink surface
 * guards ONLY that surface and the Obsidian chrome that overlaps it. Outside
 * it, nothing is eaten and touch behaves natively.
 *
 * Split out of the router for the same reason `StylusTouch.ts` was: no
 * obsidian import, loads under vitest, and the rule gets tested as a table
 * rather than inferred from a stroke.
 */

/** The one method the reach test needs. Duck-typed - see `penGuardReachesTarget`. */
interface ContainerLike {
	contains(node: Node | null): boolean;
}

/** Ditto, for the root walk. */
interface ClosestLike {
	closest(selector: string): Element | null;
}

/**
 * What counts as "the ink surface", walking outward from the scroller, first
 * match wins.
 *
 * NOT the scroller itself, and that is the whole reason this is a list rather
 * than `scrollEl`. Two pieces of chrome that a pen stroke legitimately owns
 * sit OUTSIDE it: the pen toolbar strip mounts on `view.dom.parentElement`
 * (InkOverlay.chromeHost - deliberately outside the element pinch zoom
 * scales), and the linked-mentions band `.embedded-backlinks` renders in the
 * same view but outside the scroller, which is the exact place erasing near
 * the band used to press its buttons (orion, 2026-08-26). Scoping to the
 * scroller would fix Alan's complaint and re-open that one.
 *
 * `.workspace-leaf-content` is the leaf's own content container: it is what
 * `leaf.view.containerEl` hands `PdfInkController` (src/main.ts), and it is an
 * ancestor of the note's `scrollDOM` too, so ONE selector covers both
 * surfaces. Everything Alan named is outside it - the file explorer is a
 * different leaf's `.workspace-leaf-content`, tab headers live in
 * `.workspace-tab-header-container` beside the leaves rather than inside one,
 * and the ribbon and settings are outside the workspace entirely.
 *
 * `.markdown-source-view` is the fallback for a note rendered somewhere with
 * no leaf around it (an embed, a popout mid-construction); it is the same
 * ancestor the router already derives for the backlinks band. Neither
 * matching leaves the scroller itself, which guards no less than the code
 * did before this file existed.
 */
export const GUARD_ROOT_SELECTORS = [".workspace-leaf-content", ".markdown-source-view"] as const;

/**
 * The element a pen contact's guards may act inside. Resolved once per claim,
 * not per event: `closest` walks the tree, and `mousemove` is on the guarded
 * list.
 *
 * Falls back to the scroller for anything it cannot resolve - a test fake with
 * no `closest`, a detached scroller, a selector that matches nothing. Wrapped,
 * because this runs on the claim path and a throw here would take the pen down
 * with it (the same bulkhead reasoning `ensurePenTools` carries).
 */
export function penGuardRoot(scrollEl: HTMLElement): HTMLElement {
	const el = scrollEl as unknown as Partial<ClosestLike>;
	if (typeof el.closest !== "function") return scrollEl;
	try {
		for (const selector of GUARD_ROOT_SELECTORS) {
			const found = el.closest(selector);
			if (found) return found as HTMLElement;
		}
	} catch {
		/* a scroller that cannot be walked guards itself, as before */
	}
	return scrollEl;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Is this event's target inside the ink surface? The value to pass as
 * `targetInsideSurface` below.
 *
 * UNPLACEABLE TARGETS ANSWER YES, and that direction is deliberate. This
 * function is the only thing standing between a palm and the editor, so it
 * must never hand a contact back merely because it could not work out where
 * the contact was. Everything Alan's bug is about - a finger on a nav item, a
 * tab, a ribbon icon - arrives as an Element with a real ancestor chain and is
 * answered honestly; `null`, `window`, a `Document`, a `ShadowRoot`, and a
 * root with no `contains` are all "not shown to be somebody else's", so the
 * guard keeps them.
 *
 * `contains`, never `instanceof`: a popout window's elements belong to another
 * realm and `instanceof` refuses them - the router and MobileTools both spell
 * this out, having each been bitten by it.
 *
 * A TEXT NODE is placed, not rejected. `Node.contains` is a Node-level walk
 * and answers correctly for one, and `selectstart` in particular can carry a
 * text target; treating "not an Element" as unplaceable would have quietly
 * widened the guard back out over the whole app for that event alone.
 *
 * A DETACHED element answers no, which is the one place this leans the other
 * way. `contains` cannot say "elsewhere" and "gone" apart, and an event whose
 * target was removed from the document between dispatch and this listener has
 * nothing left to protect - letting it through reaches a node that no longer
 * exists.
 */
export function penGuardReachesTarget(root: HTMLElement | null, target: unknown): boolean {
	if (!root) return true;
	const holder = root as unknown as Partial<ContainerLike>;
	if (typeof holder.contains !== "function") return true;
	if (target === null || target === undefined) return true;
	const type = (target as Partial<Node>).nodeType;
	if (type !== ELEMENT_NODE && type !== TEXT_NODE) return true;
	return holder.contains(target as Node);
}

/**
 * Should the pen's guard eat this event? The whole rule, in one place.
 *
 * Reach is asked FIRST and answers on its own: outside the surface there is
 * nothing to guard, however live the pen is. Inside it, either kind of pen
 * presence - a contact (which includes the short fallout tail after the nib
 * lifts, since `contextmenu` and `click` land after `pointerup`) or a hover
 * near the glass - is enough, because both are the hand that is holding the
 * pen over the page it is writing on.
 *
 * This is a PRE-gate, not a replacement. Its callers still ask their own
 * timing question afterwards, which is what makes the palm rejection provably
 * untouched: `suppressNativeFallout` answering true implies `ownsNativeFallout`
 * answering true implies `penContactLive`, so on the surface this predicate
 * cannot be the one that says no. The only decision it can change is one about
 * a target somewhere else.
 */
export function penGuardEatsEvent(opts: {
	targetInsideSurface: boolean;
	penContactLive: boolean;
	penHoverLive: boolean;
}): boolean {
	if (!opts.targetInsideSurface) return false;
	return opts.penContactLive || opts.penHoverLive;
}
