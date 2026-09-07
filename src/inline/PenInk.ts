/**
 * The pen-off switch: let the keyboard have the note.
 *
 * TWO REPORTS, both e-ink (1.4.10-design.md §30). Boox 4c: "I couldn't see
 * how to toggle it off or activate the keyboard input when I needed it". Boox
 * 5c: the pen fights the keyboard in live preview. Neither of them is asking
 * for a different TOOL - `InkTool` is `"pen" | "highlighter"` and has no off
 * value, every strip button selects a tool, and collapsing the strip stops
 * nothing. They are asking for the pen to stop being ours for a while, so a
 * tap can place a caret and the software keyboard can come up.
 *
 * So this is not a tool and it is not the tip's mode: it is whether the
 * router CLAIMS the pen at all. Off means the pen is a native pointer on that
 * surface - taps place the caret (which on a touch device raises the
 * keyboard, which is the whole point), drags select, swipes scroll - exactly
 * as if this plugin were not installed. One gate, at the router, rather than
 * an "off" member on `InkTool`: a tool is a thing the tip DOES, and every
 * path that claims a contact would then have to remember to ask whether the
 * tool it holds is the one that means "do not claim". Asking once, at the
 * claim, is the only place the answer can be complete.
 *
 * SESSION ONLY, never written to data.json (design §5). Nobody should open
 * the app tomorrow to a plugin that looks broken because of a toggle they
 * flipped for one paragraph yesterday; the state defaults to ON at every
 * launch and the worst a forgotten toggle costs is a relaunch.
 *
 * EVERY INK SURFACE, pdfs included. Both surfaces pass the same predicate to
 * their router - `penOff: () => !penInkEnabled()` - so one switch answers for
 * the pane the user is looking at, whichever it is.
 *
 * This was note-only for two days and the owner reversed it: "i think the dude
 * was having trouble with his keyboard coming up on pdf when he didnt want it
 * to? so why would you take keyboard mode away from pdf". The reasoning that
 * excluded pdfs - that there is nothing to type into on one - was the wrong
 * half of the question. The state is not "give the note to the keyboard", it
 * is "stop claiming the pen", and a reader who wants their pen to select text,
 * follow a link or reach a form field on a pdf is asking the same thing the
 * two e-ink users asked. A switch that works on one surface and silently does
 * nothing on the other is the surprise; one rule for both is not.
 *
 * MOUSE INK IS UNTOUCHED. `mouseActsAsPen` (MouseInk.ts) is a different
 * question with a different answer: this is about the pen the router claims,
 * and a mouse user who armed mouse ink still has the editor's own text
 * selection to give up or keep.
 *
 * MouseInk's shape, deliberately: module state, two tiny functions, no
 * obsidian import, so it loads under vitest and both the router and the strip
 * can read it without either importing the other.
 */

import { clearToolPicked } from "./MouseInk";

let enabled = true;

export function penInkEnabled(): boolean {
	return enabled;
}

/**
 * OFF ALSO PUTS THE TOOL DOWN (2026-09-05, the tightening of "the button is
 * the truth"). "A tool is lit" is now pen ink enabled AND a tool picked
 * (`toolIsLit`, MouseInk.ts), and keyboard mode is the user saying the tip
 * does nothing here - so it unpicks rather than merely masking. The
 * difference shows on the way BACK: masking would have keyboard mode off,
 * then on again, come up still drawing with a tool nobody re-picked, on a
 * pen-less device where that grant is the whole of the mouse's claim.
 *
 * MOUSE INK, the explicit switch, is untouched by this exactly as the header
 * above says - `clearToolPicked` writes neither `enabled` here nor
 * MouseInk's own flag. Only the derived grant moves.
 *
 * Importing MouseInk.ts is safe and stays safe: it imports nothing at all,
 * which is the shape both files were given for this reason.
 */
export function setPenInk(on: boolean): void {
	enabled = on;
	if (!on) clearToolPicked();
}

/**
 * Test seam, and the reason it exists rather than tests calling
 * `setPenInk(true)`: the default is the fact under test in half of them, and
 * a reset that spells the default out at each call site is a second copy of
 * it that can drift from this one.
 */
export function resetPenInkForTest(): void {
	enabled = true;
}
