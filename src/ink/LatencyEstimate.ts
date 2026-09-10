/**
 * What this machine's ink path actually costs, measured while writing.
 *
 * `age@present` is already recorded on every surface that draws wet ink: the
 * rAF after a raw event asks how old the newest sample is by the time a frame
 * goes out. That number is the software latency prediction is aiming into,
 * and until now nothing read it back - the horizon was a constant tuned on
 * one Surface (see DEFAULT_CAPS), and every other machine got that machine's
 * answer. A Surface Pro 8 reporting a delay on the same build with the same
 * setting is what this is for (dumbdreamed, 2026-09-01).
 *
 * Session-wide and shared by all three wet surfaces (inline, page, pdf): they
 * are the same machine, and the estimate wants samples faster than any one of
 * them produces alone.
 *
 * MEDIAN, not mean. A GC pause, a background tab, or a window drag produces a
 * present age in the hundreds of ms; one of those must not move the horizon,
 * and with a mean a single 400ms sample drags 64 good ones by 6ms.
 */

/** Recent present ages, oldest overwritten. */
const WINDOW = 64;

/**
 * Samples needed before the estimate is trusted. Below this the caller keeps
 * the shipped default: a horizon derived from four samples is noise, and the
 * first strokes of a session are exactly when the machine is busiest.
 */
const WARMUP = 24;

/**
 * Anything past this is not latency, it is a stall - a hidden tab, a resume
 * from sleep, the compositor waiting on something else entirely. Dropped
 * rather than clamped: a stall carries no information about the steady state.
 */
const IMPLAUSIBLE_MS = 500;

const ring: number[] = [];
let next = 0;
let cached: number | undefined;
/**
 * Monotonic count of samples this module has ACCEPTED (not attempted): the
 * eink hint's freshness check needs to know how much new evidence has come
 * in since it last looked, and an attempt count would let a stalled device
 * that spams implausible reads inflate a batch with values the reject guard
 * below throws away.
 */
let accepted = 0;

/**
 * HINT EVIDENCE, deliberately NOT the prediction ring.
 *
 * The ring above is a ROLLING window: at any moment it still holds up to
 * WINDOW samples from earlier intervals, so its median answers "how has this
 * machine been lately". A hint that polls on a timer needs the other
 * question - "what did the batch since my last look say" - because three
 * reads of a rolling median can all be satisfied by one bad stretch that has
 * not yet aged out, which is one observation counted three times.
 *
 * So accepted samples are appended here as well, and a check consumes THIS
 * buffer and nothing else. Bounded at the same capacity as the ring; an
 * interval that overflows keeps the LATEST values, because a batch that big
 * is already far past the minimum a decision needs and the newest samples are
 * the ones describing the interval that just ended.
 */
const HINT_CAPACITY = 64;
const HINT_MIN_BATCH = 24;
const pendingHint: number[] = [];
let pendingHintNext = 0;


/** Median of what is in the ring right now. Called on write, never on read. */
function recompute(): void {
	if (ring.length < WARMUP) {
		cached = undefined;
		return;
	}
	const sorted = [...ring].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	cached =
		sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Feed one `age@present` measurement, in ms. Safe to call from the frame
 * callback on the hot path: the median is computed here, so reading it back
 * during a pointer event is a field access.
 */
export function recordPresentAge(ms: number): void {
	if (!Number.isFinite(ms) || ms < 0 || ms > IMPLAUSIBLE_MS) return;
	accepted++;
	// Same accepted values, second home: see the hint buffer above. Push only,
	// no sort, so the hot path cost is unchanged.
	if (pendingHint.length < HINT_CAPACITY) pendingHint.push(ms);
	else {
		pendingHint[pendingHintNext] = ms;
		pendingHintNext = (pendingHintNext + 1) % HINT_CAPACITY;
	}
	if (ring.length < WINDOW) ring.push(ms);
	else {
		ring[next] = ms;
		next = (next + 1) % WINDOW;
	}
	recompute();
}

/**
 * Median present age in ms, or undefined while still warming up. Undefined
 * means "no opinion" - callers fall back to the shipped constant rather than
 * guessing from too little.
 */
export function presentLagMs(): number | undefined {
	return cached;
}

/**
 * Count of samples accepted so far, ever-increasing for the life of the
 * process. Lets a caller (EinkHint.ts) tell a fresh batch of evidence from a
 * repeat read of the same stale median.
 */
export function acceptedSampleCount(): number {
	return accepted;
}

/**
 * Take the batch accepted since the last consume or discard and return its
 * median, or undefined when fewer than HINT_MIN_BATCH samples arrived.
 *
 * DETACHES ON EVERY CALL, the undefined one included: an insufficient batch is
 * SPENT, not carried forward, so a 23-sample interval followed by a 1-sample
 * interval cannot add up to an eligible 24. That accumulation is exactly what
 * made the first version accept stale evidence.
 *
 * The sort happens here, once per check, never per sample.
 */
export function consumeHintLagMs(): number | undefined {
	const batch = pendingHint.slice();
	pendingHint.length = 0;
	pendingHintNext = 0;
	if (batch.length < HINT_MIN_BATCH) return undefined;
	batch.sort((a, b) => a - b);
	const mid = batch.length >> 1;
	return batch.length % 2 === 0 ? (batch[mid - 1]! + batch[mid]!) / 2 : batch[mid]!;
}

/**
 * Drop pending hint evidence without touching the prediction estimate. Used
 * when the mode changes under the hint, or when a check is suppressed and its
 * batch must not age into the next one.
 */
export function discardHintSamples(): void {
	pendingHint.length = 0;
	pendingHintNext = 0;
}

/** Test seam. Nothing in the plugin resets this; a session is one machine. */
export function resetLatencyEstimate(): void {
	ring.length = 0;
	next = 0;
	cached = undefined;
	accepted = 0;
	pendingHint.length = 0;
	pendingHintNext = 0;
}
