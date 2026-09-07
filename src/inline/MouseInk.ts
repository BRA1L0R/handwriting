/**
 * The mouse-ink switch (roadmap: mouse input).
 *
 * The router's founding contract says "Mouse -> never touched": on an
 * ordinary note the editor owns the mouse, and claiming it would break text
 * selection for everyone to serve the people without a pen. So mouse inking
 * is an explicit MODE, off by default, flipped by a command and persisted in
 * settings. While it is on, the LEFT button inks exactly the way a pen tip
 * does (Chromium reports pressure 0.5 for a pressed mouse, so the width law
 * has something honest to chew on) and text selection by mouse is knowingly
 * given up. Right and middle stay native: no lasso-by-right-drag, because
 * the context menu owns that button and fighting it helps nobody.
 *
 * DiagSwitch's shape: module state, two functions, no obsidian import.
 */

let enabled = false;
export function mouseInkEnabled(): boolean {
	return enabled;
}

export function setMouseInk(on: boolean): void {
	enabled = on;
}

/**
 * HAS A TOOL BEEN PICKED ON THIS SURFACE SINCE LAUNCH?
 *
 * The half of "a tool is lit" that `penInkEnabled()` is not, and the reason
 * this file needed one at all. The first cut of the widened rule below read
 * "a tool is lit" as `!penOff()` (the router) and `penInksHere()` (the
 * strip) - both of which are the SAME PenInk.ts flag, whose default is TRUE.
 * So on a pen-less device, straight from launch, with nothing picked and the
 * mouse-ink setting off, a plain left-drag across a word INKED instead of
 * selecting it: the grant read "lit" from a switch nobody had touched. That
 * contradicted the ruling it was built for ("no lit tool means the mouse
 * selects text") and `docs/manual.md`'s "By default, only the pen draws".
 *
 * A PICK IS SOMEBODY WRITING THE TOOL STATE, and that is why this flag is
 * set from the two functions that own that state rather than from the six
 * buttons and six commands that reach them: `setInlineTool` (InkOverlay.ts,
 * the nib - which the strip's Pen/Highlighter buttons, the palette's Pen and
 * Highlighter commands, every colour command and every quick-pen preset all
 * end in) and `setTipMode` (TipMode.ts, the tip - which eraser, lasso,
 * insert space and pan all end in, in both directions). A rule spelled out
 * at twelve call sites is a rule that drifts at one of them; these two are
 * the whole of the tool state, so nothing that picks a tool can miss it and
 * nothing that does not pick one can set it by accident. The strip's one
 * mouse branch that gives a nib to the mouse WITHOUT an exec (MobileTools.ts,
 * "give the mouse this tool") calls `markToolPicked` itself, because it is
 * the one pick that never reaches a setter.
 *
 * SESSION STATE, NOT A SETTING AND NOT A KEY. Nothing here is written to
 * data.json or to the device store, deliberately and under the same ruling
 * that took the persistence off the quiet arm below (alan, 2026-09-04: "dont
 * persist a quiet arm"). A launch starts with nothing picked, which is
 * exactly the answer the manual promises. "Restored at load" therefore costs
 * nothing extra: whatever a later slice teaches the plugin to restore will
 * restore it THROUGH `setInlineTool`/`setTipMode` - the only two ways the
 * tool can be set at all - and the pick follows it for free. Today nothing
 * restores a tool, so today a restart selects text.
 *
 * UNPICKED by the two edges that put a tool down: `releaseMouseInkQuietly`
 * (PenToolsMode.ts), which is the one place the mouse put-down is written -
 * both the strip's nib branch and its eraser/lasso/space/pan branch reach it
 * through the host's `disarmMouseInkQuietly` - and `setPenInk(false)`
 * (PenInk.ts), keyboard mode, which is the user saying the tip does nothing
 * here. Pen-off unpicking rather than merely masking is the difference
 * between "keyboard mode, then back" coming up dark (right) and coming up
 * still drawing (wrong).
 */
let toolPicked = false;

export function markToolPicked(): void {
	toolPicked = true;
}

export function clearToolPicked(): void {
	toolPicked = false;
}

/** Read seam for the flag above; the predicate below is what callers want. */
export function toolPickedHere(): boolean {
	return toolPicked;
}

/**
 * THE ONE PREDICATE: is a tool lit on this surface right now?
 *
 * `penInksHere` is the caller's OWN existing reading of "does the tip do
 * anything at all" - `!this.penOff()` for the router (its callback, wired to
 * `!penInkEnabled()` by both surfaces) and `h.penInksHere()` for the strip
 * (its host seam, wired to `penInkEnabled()` by both surfaces). Taken as a
 * boolean, exactly as `mouseDrawsFromLitTool` takes its device flag, so this
 * file keeps its no-imports shape and neither caller has to learn a new seam.
 *
 * ONE FUNCTION, not two, and that is load-bearing: the merged pen-button
 * slice made the button LIGHT (`nibIsLit`, MobileTools.ts) and the drawing
 * GRANT (`InlinePenRouter.mouseActsAsPen`) read the same expression so that
 * they can never disagree in either direction - lit and not drawing was
 * alan's original symptom, dark and drawing its exact inverse. Both now
 * reach "lit" through here.
 */
export function toolIsLit(penInksHere: boolean): boolean {
	return penInksHere && toolPicked;
}

/**
 * Does the mouse draw right now because a tool is lit and this device
 * reads as pen-less (`deviceHasNeverSeenAPen`, PenToolsMode.ts - read ITS
 * docstring before trusting that name; it is not a durable flag)?
 *
 * Alan's ruling, 2026-09-05, verbatim: "button should become the truth" -
 * widened the same day, his own addendum: a device that has never seen a
 * pen has nothing else FOR the mouse to be, so whichever tool is lit - pen,
 * highlighter, eraser, lasso, insert-space or pan - is what the mouse now
 * draws with; no lit tool means the mouse selects text, same as ever. On a
 * device that HAS seen a pen this answers false unconditionally, by
 * construction (`deviceHasNeverSeenAPen` is false there), and the
 * persisted `enabled` flag below - the "Mouse" command and the settings
 * switch, both explicit and both untouched by this rule - is the only
 * thing that can turn the mouse on. See `mouseActsAsPen`, which ORs the
 * two rather than letting this one override the explicit setting.
 *
 * PURE AND BOOLEAN-IN, deliberately, rather than reading
 * `deviceHasNeverSeenAPen()` itself: this file cannot import
 * PenToolsMode.ts without a real cycle - PenToolsMode.ts already imports
 * `disarmMouseInkQuietly` and `mouseActsAsPen` from here (see
 * `releaseMouseInkQuietly`'s own comment there: "the import already runs
 * the other way... so the cycle would be real"). Callers that already
 * reach into both files - `InlinePenRouter`, which already imports
 * `penSeenThisSession` from PenToolsMode.ts - supply the two booleans, so
 * the RULE itself still lives once, here, rather than at each call site.
 *
 * `toolLit` IS `toolIsLit(...)` ABOVE at both call sites, and only that -
 * pen ink enabled AND a tool picked. It used to be the pen-ink flag alone,
 * which defaults to true, so this function granted the mouse the tip on a
 * pen-less device at launch with nothing picked. See `toolPicked` above.
 *
 * The four cases are the whole of it:
 *
 *   deviceHasNeverSeenAPen   toolLit   -> mouse draws (this function)
 *          false               false      false
 *          false               true       false  (defers to `enabled`)
 *          true                false      false  (nothing to draw with)
 *          true                true       true   (the lit tool IS the draw)
 */
export function mouseDrawsFromLitTool(deviceHasNeverSeenAPen: boolean, toolLit: boolean): boolean {
	return deviceHasNeverSeenAPen && toolLit;
}

/**
 * Is this pointer a mouse that is currently standing in for a pen?
 *
 * The whole of the mode's meaning, in one place. `InlinePenRouter` has carried
 * this expression as a private method since the mode was added and it is the
 * gate on every one of that file's pen paths; it now calls this, and so does
 * `pointerRaisesPenTools` (PenToolsMode.ts), which is what the two ink
 * surfaces read. Written once because a rule implemented twice is this
 * project's most expensive recurring defect and it would be a poor joke to
 * add another while closing one.
 *
 * Takes the TYPE rather than the event: the strip and the surfaces have a
 * `pointerType` string in hand and no event, and the router has both.
 *
 * WIDENED, 2026-09-05 (see `mouseDrawsFromLitTool` above for the full
 * ruling): a mouse also acts as the tip whenever that predicate says so.
 * `toolLit` and `deviceHasNeverSeenAPen` both default to `false` so every
 * caller not yet updated to pass them - `pointerRaisesPenTools` among them,
 * deliberately left alone; this brief is about drawing, not toolbar
 * visibility - keeps exactly its old answer, `enabled` alone.
 */
export function mouseActsAsPen(
	pointerType?: string,
	toolLit = false,
	deviceHasNeverSeenAPen = false
): boolean {
	return pointerType === "mouse" && (enabled || mouseDrawsFromLitTool(deviceHasNeverSeenAPen, toolLit));
}

/**
 * Arm mouse ink QUIETLY: a mouse clicking a tool button it cannot yet use
 * means "give the mouse this tool" (MobileTools.ts), and the exec beside this
 * has already named what was picked - one click, one toast (alan,
 * 2026-08-31). The toggle command stays the loud path.
 *
 * QUIET IS FOR THIS SESSION; LOUD IS FOR DISK. ALAN, 2026-09-04: "dont
 * persist a quiet arm". This used to call a writer main.ts registered here,
 * the eraser slider's pattern, so that a tool click would not "lose the
 * setting on restart" - which turned out to be the defect rather than the
 * feature. Users reported mouse ink "keeps turning on by itself": one click
 * on the eraser in one note, and every launch afterwards came up with the
 * mouse claimed and text selection gone, with nothing on screen to say why.
 * Nobody asks for the MODE here - they ask for the eraser, and arming the
 * mouse is only what that request needs in order to mean anything.
 *
 * So this flips the flag and stops. The two LOUD writers - the mouse-ink
 * toggle command and the settings switch, the two places the mode is asked
 * for by name - own `settings.mouseInk` between them, and main.ts's
 * `setMouseInk(this.settings.mouseInk)` at load is unchanged: an explicit ON
 * still comes back, and a quiet arm is simply not there to be found.
 */
export function armMouseInkQuietly(): void {
	if (enabled) return;
	enabled = true;
}

/**
 * The other direction, and the same silence: putting a tool DOWN with a mouse
 * hands the pointer back to text.
 *
 * ALAN, 2026-09-03. Clicking the tool you are holding already dropped mouse
 * ink for the two nibs, but the eraser, lasso, insert-space and pan only
 * toggled back to the last nib - which for a mouse is not putting anything
 * down, since the pointer is still claimed and still cannot select text. The
 * only way back to the cursor from the eraser was to click a button you were
 * not using. His words: "much more consistent for them all to be dropped and
 * revert back to mouse cursor".
 *
 * Quiet for the reason `armMouseInkQuietly` is: the tool command that runs
 * beside this already toasts, and one click owes one toast (alan,
 * 2026-08-31). The toggle command stays the loud path.
 *
 * Session-only for the reason `armMouseInkQuietly` is, and under the same
 * ruling (alan, 2026-09-04): this hands THIS session's pointer back to text
 * and writes nothing. Someone who turned the mode on BY NAME still has it at
 * the next launch - putting a tool down was never asked to be the off switch
 * for their setting, only for the claim on the pointer in front of them.
 *
 * Callers must also put the nib light out - turning mouse ink off darkens it
 * "at any point" - which is why the two are paired once in
 * `releaseMouseInkQuietly` (PenToolsMode.ts) rather than at each call site.
 * This module cannot do it itself: `PenToolsMode` imports `mouseActsAsPen`
 * from here, so importing it back would be a real cycle.
 */
export function disarmMouseInkQuietly(): void {
	if (!enabled) return;
	enabled = false;
}

/**
 * Told to the tool's own toggle command: THIS particular off-toggle is a
 * mouse put-down, not a pen or touch tap.
 *
 * The strip's put-down branch (MobileTools.ts, `disarmMouseInkQuietly`'s
 * caller) still has to run the eraser/lasso/insert-space/pan command itself
 * - that command is what actually reverts the mode, `enterTipMode`'s half of
 * it - and that command still shows exactly one Notice, same as any other
 * press of it (one click, one toast). The trouble is which words: that
 * Notice was written for the OTHER caller of the same off edge, a pen or
 * touch tap that really did just pick the nib the tip fell back to, and
 * says so - "Handwriting: highlighter". A mouse put-down picked nothing; it
 * got its cursor back, and the correct words for that are already sitting in
 * the loud mouse-ink-toggle command's own off branch, "Handwriting: mouse
 * ink off" - alan's device finding, 2026-09-03 ("toast is incorrect ... it
 * says highlighter after doing it").
 *
 * The command has no other way to tell a mouse put-down apart from an
 * ordinary toggle: it never sees a pointer, so `mouseInkEnabled()` alone
 * cannot answer this - a pen user hitting the eraser hotkey with mouse ink
 * left on from an earlier session must NOT get the mouse's wording. Only the
 * strip's click handler knows the pointer type, so it sets this immediately
 * before calling exec, and the command consumes (reads and clears) it while
 * building its own Notice. Read-and-clear, not a plain flag, so a stray
 * later toggle - hotkey, palette, another pointer - can never inherit a
 * signal meant for the one press that set it.
 */
let mousePutDown = false;
export function markMousePutDown(): void {
	mousePutDown = true;
}
export function consumeMousePutDown(): boolean {
	const was = mousePutDown;
	mousePutDown = false;
	return was;
}
