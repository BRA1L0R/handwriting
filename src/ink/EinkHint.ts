/**
 * Whether it is time to mention Boox mode to someone who has never heard of
 * it.
 *
 * `LatencyEstimate.ts` already knows this machine's ink is arriving late;
 * nothing ever told the WRITER. This module owns only the decision of when to
 * say something once - it does not read the setting, does not show a Notice,
 * and does not know what Boox mode does. Kept pure (no `obsidian` import, no
 * DOM) so the state machine can be driven directly under vitest.
 *
 * ONE FRESH BATCH PER CHECK. The caller hands in the median of the samples
 * collected since its previous check - `consumeHintLagMs()`, which detaches
 * that batch - and never a rolling median. That distinction is the whole
 * correction: a rolling median can hand three consecutive checks the same
 * stale reading when the user has stopped writing, so a run of three would be
 * one observation counted three times rather than three observations. Each
 * value that reaches `noteLag` is now evidence no earlier check has seen.
 *
 * THRESHOLD, run of three. A single slow batch can be one bad stretch - a
 * background tab, a sync, a moment of GC pressure - and firing on it would
 * describe an instant, not the machine. Three consecutive fresh batches over
 * the line is the bar. Equal medians from distinct batches still count: two
 * batches reading 50 are two facts about the machine, not a repeat of one.
 *
 * UNDEFINED RESETS. The caller passes undefined when its batch was too small
 * to have an opinion. That can only mean "not enough evidence", never "known
 * to be fine", so it breaks the run rather than counting either way.
 *
 * LATCH. Said once per session. Nobody wants a nag on every slow patch, and
 * the whole point is a single nudge toward a setting that fixes the cause.
 * `resetEinkHintProgress()` clears a partial run WITHOUT reopening the latch -
 * being told once stays once, even across a mode change.
 */

/** Consecutive-batch floor, in ms, before a hint is worth mentioning. */
const LAG_THRESHOLD_MS = 40;

/** Consecutive at-or-over-threshold fresh batches required before firing. */
const REQUIRED_RUN = 3;

let run = 0;
let offered = false;

/**
 * Feed the median of ONE completed fresh batch, or undefined when the batch
 * was too small to speak. Returns true exactly once - on the check that
 * completes a qualifying run - and false on every other call, including every
 * call after that, for the life of the process (or until `resetEinkHint()`,
 * the test seam).
 */
export function noteLag(batchMedianMs: number | undefined): boolean {
	if (offered) return false;
	if (batchMedianMs === undefined || batchMedianMs < LAG_THRESHOLD_MS) {
		run = 0;
		return false;
	}
	run++;
	if (run < REQUIRED_RUN) return false;
	offered = true;
	return true;
}

/**
 * Runtime reset: drop a partial run, keep the latch. Called when the mode
 * changes under the hint, because a run collected before the change describes
 * a machine that has since been reconfigured - but someone already told once
 * must not be told again.
 */
export function resetEinkHintProgress(): void {
	run = 0;
}

/** Test seam: full reset, latch included. Nothing in the plugin calls this. */
export function resetEinkHint(): void {
	run = 0;
	offered = false;
}
