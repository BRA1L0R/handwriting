import type { InkPresence } from "./InlineInkStore";

/**
 * "This tool has nothing to work on" - said once, not once per contact.
 *
 * THE BUG. `InkOverlay.penDown`'s eraser branch and `lassoDown`'s fresh-loop
 * branch each raise a Notice when the page holds no ink, so a tool that can
 * do nothing says why instead of looking broken (the lesson written down in
 * `EmptyPageNotices.test.ts`'s header). Both fire at the gesture's own
 * discovery, which was right, and both fire ONCE PER CONTACT, which was not:
 *
 *   Alan, hardware, 1.4.12, on `vault test 2`: "holding ctrl and touching
 *   eraser end to screen spams toast notification - there is no ink on the
 *   note to erase, even though there is".
 *
 * An eraser is the one tool nobody uses with a single contact. The router
 * already says so in its own words, at the pen-down branch that reclassifies
 * a resting hand: "Eraser scrubbing lifts and re-lands the nib every few
 * hundred ms". Every one of those re-lands is a fresh `pointerdown`, a fresh
 * `penDown`, and - before this module - a fresh Notice. Twenty toasts for one
 * piece of news, each with its own timeout, the oldest one still on screen
 * last. Ctrl has nothing to do with it and is read by no code on this path;
 * it is simply what Alan's hand was holding while he scrubbed.
 *
 * WHY NOT `ownedNotice` (main.ts). That helper solves the neighbouring
 * defect - a TOGGLE spammed by a button, where every press is real news and
 * only the stacking is wrong, so it rewrites one Notice in place. Here the
 * repeats are not news at all: the second contact of a scrub has discovered
 * exactly what the first one did. Rewriting in place would still restart the
 * timeout on every re-land, so the toast would sit there for as long as the
 * scrub lasted and then outlive it. The right shape is to say it once and go
 * quiet until the answer could have changed.
 *
 * WHAT MAKES IT NEWS AGAIN, and nothing else does:
 *
 *   - a different note (`path`), or a different tool (`kind`) - the eraser's
 *     refusal and the lasso's are two pieces of news, not one repeated;
 *   - ink arriving or leaving for that note (`forget`, wired to the store's
 *     `onInkChanged`) - a page that gains ink and loses it again has earned
 *     the sentence a second time;
 *   - a note switch, which the overlay routes through `forgetAll`.
 *
 * A pen-up does NOT clear it, deliberately: that is exactly the boundary a
 * scrub crosses every few hundred ms, and clearing there would restore the
 * spam this exists to stop. Neither does an ABANDONED gesture - a window
 * blur, an alt-tab, a system dialog mid-scrub - for the same reason and one
 * more: nothing about the note or the tool changed while the writer was
 * away, so the answer they were given still holds. `InkOverlay`s
 * `resetGestureState` is the abandon path as well as the switch path, which
 * is why the `forgetAll` for a switch lives in its two callers that really
 * do put a fresh screen up (`update()`s path-change branch and `unmount()`)
 * rather than in the reset they share.
 *
 * Pure and DOM-free (no `Notice` import, no `document`), so the rule is
 * testable on its own rather than only through a rig that fakes obsidian.
 */

/** The tools that can refuse a gesture for want of ink. */
export type EmptyPageTool = "erase" | "select";

/**
 * Should this gesture say anything, and what?
 *
 * Split from the gate so the WORDING and the "only when we are certain" rule
 * are pinnable without any state at all.
 *
 * "unknown" is silence. The store has not read the sidecar yet, so claiming
 * the page is empty would be the very sentence Alan called wrong ("even
 * though there is"). The caller kicks a load instead and the next contact -
 * or the repaint the load triggers - tells the truth.
 */
export function emptyPageNoticeText(
	presence: InkPresence,
	kind: EmptyPageTool
): string | null {
	if (presence !== "none") return null;
	return kind === "erase"
		? "Handwriting: no ink on the page to erase"
		: "Handwriting: no ink on the page to select";
}

/**
 * One overlay's memory of what it has already said.
 *
 * `claim` returns true at most once per (path, kind) episode; the caller only
 * builds a Notice when it does.
 */
/**
 * Does an ink change make the refusal worth saying AGAIN?
 *
 * Only when ink ARRIVED. The gate's own header used to say "ink arriving
 * (or the last of it leaving)", and the second half was wrong on a user's
 * screen: an eraser scrub re-lands the nib every few hundred milliseconds
 * and each re-land is a fresh pointerdown, so erasing the last stroke
 * re-armed this gate and the very next landing of the SAME scrub announced
 * that there was no ink to erase - to the person who had just erased it
 * (alan, 1.4.12: "flip to erase end worked but it also gave me the toast
 * for no ink to erase").
 *
 * Emptying a page is the one ink change that must NOT re-arm it: the user
 * knows the page is empty, because they are the one who emptied it. Ink
 * arriving still re-arms, which is the case the gate exists for - a note
 * that gains ink and later loses it by some other road should speak again.
 * "unknown" re-arms nothing: the store has not read the sidecar, so
 * nothing about that note is known yet, and `sayIfPageEmpty` goes and
 * reads rather than speaking.
 */
export function inkChangeRearmsNotice(presence: InkPresence): boolean {
	return presence === "ink";
}

export class EmptyPageNoticeGate {
	private said = new Set<string>();

	private static key(path: string, kind: EmptyPageTool): string {
		return `${kind}:${path}`;
	}

	/**
	 * True exactly once per episode. A null path is a surface with no file
	 * behind it: nothing certain can be said about a note that isn't there,
	 * so it never speaks - and it never records anything either, because
	 * there is no key that would later be forgotten.
	 */
	claim(path: string | null, kind: EmptyPageTool): boolean {
		if (path === null) return false;
		const key = EmptyPageNoticeGate.key(path, kind);
		if (this.said.has(key)) return false;
		this.said.add(key);
		return true;
	}

	/** This note's ink changed: both its tools may speak again. */
	forget(path: string): void {
		this.said.delete(EmptyPageNoticeGate.key(path, "erase"));
		this.said.delete(EmptyPageNoticeGate.key(path, "select"));
	}

	/** A note switch, or a teardown. */
	forgetAll(): void {
		this.said.clear();
	}
}
