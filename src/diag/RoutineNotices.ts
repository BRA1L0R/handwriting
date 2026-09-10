/**
 * Whether the routine success toasts are shown (alan, 2026-09-09).
 *
 * Alan asked for most toasts to move to diagnostics — "just hide it behind
 * dev mode" — and approved root's scope with "yes perfect": tool, colour,
 * size and mode announcements, routine copied/pasted counts and internal
 * status become diagnostic-only. Anything carrying a failure, a no-op
 * explanation, an undo or a recovery path keeps notifying, and `Notice` is
 * never suppressed globally.
 *
 * WHY THIS IS A SNAPSHOT AND NOT A LIVE `this.settings` READ. The switch is
 * the persisted `devDiagnostics` setting, whose own settings row promises
 * "Takes effect after the plugin reloads." Reading the setting at notice
 * time would make a toggle change the toasts immediately and break that
 * promise. So the value is pushed in once at load, beside
 * `setPressureSensitivity` and `setInkThemeAdaptation`, and the settings
 * toggle deliberately does NOT push it again — flipping it does nothing
 * until the reload the row already tells the user about. That is the
 * existing reload semantic, not a second configuration channel.
 *
 * NOT the session switch in `DiagSwitch.ts`. That one is scoped to a
 * recording session and is flipped by a command; `devDiagnostics` is the
 * thing a user turns on in settings and the thing Alan meant by "dev mode".
 * The two are independent — the setting has never primed the session switch
 * — so a routine toast must not read `diagnosticsEnabled()`.
 */

let routineVisible = false;

/** Told once at load from `settings.devDiagnostics`. */
export function setRoutineNoticesVisible(on: boolean): void {
	routineVisible = on;
}

/**
 * Gate a routine success toast on this AT THE CALL SITE, so the message
 * string is never built when the toasts are hidden.
 */
export function routineNoticesVisible(): boolean {
	return routineVisible;
}
