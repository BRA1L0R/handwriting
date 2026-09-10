import { diagnosticsEnabled } from "../diag/DiagSwitch";

/**
 * The instrument for "it is very very laggy to draw with a mouse on Orion".
 *
 * Orion is a Surface Pro at devicePixelRatio 2 with a 2560x1392 css reveal
 * viewport, so each of the three canvases the slides surface mounts carries a
 * 5120x2784 backing store. Nothing is felt on the dev PC, so the only way to
 * find out where the time goes is to make the machine that feels it say so.
 *
 * Two clocks, because they answer different questions:
 *
 *   the HANDLER clock   wall ms inside `onPointerMove`, per event. This is
 *                       the part the plugin owns. If it is small and the
 *                       drawing still lags, the cost is downstream - the
 *                       compositor uploading a 5120x2784 tile, Reveal's own
 *                       work, the event queue - and no amount of retuning
 *                       the ribbon would move it.
 *   the FRAME clock     the interval between animation frames while a stroke
 *                       is live. This is what the hand actually sees. A
 *                       16.7 ms mean with a handler under a millisecond says
 *                       the lag is perceived, not produced; 40 ms frames say
 *                       something is stalling the compositor.
 *
 * Plus the two counts that would settle an argument on their own: how many
 * coalesced samples a Windows MOUSE delivers per event (a pen delivers
 * several; a mouse is widely believed to deliver one, and "believed" is not
 * a measurement), and how many forced layout reads the move path takes. The
 * last lag on this hardware - the pdf pan - was one layout read per move,
 * and the fix was to carry the value across the drag. The slides surface
 * claims in its own comments to have zero on this path (A2, §3.2). This
 * counter is what turns that claim into a number.
 *
 * THE CALL-SITE RULE (DiagSwitch.ts) applies in full. Every method here is a
 * no-op when the switch is off, and the rAF loop is never started at all, so
 * an ordinary reader's stroke pays one boolean read per event and nothing
 * else. The aggregation is pure and separately tested: the console line is a
 * function of the recorded numbers, not of a live deck.
 */

/** A frame slower than this is one the hand can see. */
export const SLOW_FRAME_MS = 20;

/** One pointermove, as the trace records it. */
export interface MoveTraceEvent {
	/** Wall ms around the whole handler body. */
	ms: number;
	/** Coalesced samples the handler consumed (1 when uncoalesced). */
	samples: number;
	/** Forced layout reads taken while it ran. */
	layoutReads: number;
}

/** The canvas the stroke was drawn on, for the tail of the line. */
export interface MoveTraceCanvas {
	cssWidth: number;
	cssHeight: number;
	dpr: number;
}

/** Everything the line is computed from. */
export interface MoveTraceData {
	events: readonly MoveTraceEvent[];
	/** Intervals between consecutive animation frames, ms. */
	frameIntervals: readonly number[];
	canvas: MoveTraceCanvas;
}

function round2(n: number): string {
	return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * The one line the stroke prints, as a pure function of what was recorded.
 *
 * Shaped to be pasted into a bug report and read at a glance rather than
 * parsed: counts first, then the two distributions, then the machine it was
 * measured on. An empty stroke still prints - "0 events" is itself a finding
 * (the handler never ran, so the lag is not in it).
 */
export function formatMoveTrace(data: MoveTraceData): string {
	const { events, frameIntervals, canvas } = data;
	const n = events.length;
	let total = 0;
	let max = 0;
	let samples = 0;
	let layoutReads = 0;
	for (const e of events) {
		total += e.ms;
		if (e.ms > max) max = e.ms;
		samples += e.samples;
		layoutReads += e.layoutReads;
	}
	const mean = n > 0 ? total / n : 0;
	const perEvent = n > 0 ? samples / n : 0;
	let slow = 0;
	for (const ms of frameIntervals) if (ms > SLOW_FRAME_MS) slow++;
	return (
		`[slides] move trace: ${n} events, mean ${round2(mean)} ms, ` +
		`max ${round2(max)} ms, samples/event ${round2(perEvent)}, ` +
		`layout reads ${layoutReads}, frames ${frameIntervals.length}, ` +
		`slow frames ${slow} (>${SLOW_FRAME_MS} ms), ` +
		`canvas ${Math.round(canvas.cssWidth)}x${Math.round(canvas.cssHeight)}` +
		`@dpr ${round2(canvas.dpr)}`
	);
}

/** The clock and the frame source, so the recorder is testable without a DOM. */
export interface MoveTraceHost {
	now(): number;
	requestAnimationFrame(fn: (t: number) => void): number;
	cancelAnimationFrame(handle: number): void;
}

/**
 * The live recorder. One per deck; one recording per stroke.
 *
 * `begin` is called where the stroke is promoted and `end` where it commits,
 * and both are gated at the call site. `end` returns the line rather than
 * printing it, so the caller owns the console and the tests own the string.
 */
export class SlidesMoveTrace {
	private events: MoveTraceEvent[] = [];
	private frameIntervals: number[] = [];
	private frame: number | null = null;
	private lastFrameAt = 0;
	private recording = false;
	/**
	 * Layout reads since the current handler started.
	 *
	 * A counter on the recorder rather than a return value threaded through
	 * `measureGeometry`, because the reads that matter are the ones nobody
	 * expects - a helper three calls down that happens to touch a rect. A
	 * counter can be bumped from anywhere on the path; a return value can
	 * only be bumped from where somebody already suspected it.
	 */
	private layoutReads = 0;
	/**
	 * Coalesced samples the current handler has reported.
	 *
	 * Reported BY the handler rather than counted by the wrapper, because the
	 * wrapper would have to call `getCoalescedEvents()` a second time to find
	 * out - and that call would land inside the window being timed, inflating
	 * the very number the trace exists to establish. The body already has the
	 * list; it just says how long it was.
	 */
	private samples = 0;

	constructor(private readonly host: MoveTraceHost) {}

	/** Is a stroke being recorded right now? */
	get active(): boolean {
		return this.recording;
	}

	/**
	 * Start recording a stroke, and start the frame loop.
	 *
	 * The switch is re-read here rather than trusted from the call site: the
	 * loop this starts outlives the call, and a loop that keeps running after
	 * recording stops is exactly the per-frame cost the switch exists to
	 * prevent.
	 */
	begin(): void {
		if (!diagnosticsEnabled()) return;
		if (this.recording) this.stopFrames();
		this.events = [];
		this.frameIntervals = [];
		this.layoutReads = 0;
		this.recording = true;
		this.lastFrameAt = this.host.now();
		this.pump();
	}

	private pump(): void {
		this.frame = this.host.requestAnimationFrame(() => {
			this.frame = null;
			if (!this.recording) return;
			const t = this.host.now();
			this.frameIntervals.push(t - this.lastFrameAt);
			this.lastFrameAt = t;
			this.pump();
		});
	}

	private stopFrames(): void {
		if (this.frame !== null) {
			this.host.cancelAnimationFrame(this.frame);
			this.frame = null;
		}
	}

	/** A layout read happened on the move path. Free when not recording. */
	countLayoutRead(): void {
		if (this.recording) this.layoutReads++;
	}

	/** How many coalesced samples this handler consumed. Free when off. */
	countSamples(n: number): void {
		if (this.recording) this.samples += n;
	}

	/** Wall clock at the top of the handler; undefined when not recording. */
	markHandlerStart(): number | undefined {
		if (!this.recording) return undefined;
		this.layoutReads = 0;
		this.samples = 0;
		return this.host.now();
	}

	/**
	 * Close the handler opened by `markHandlerStart`. `startedAt` undefined
	 * means the recorder was off when the handler began, so there is nothing
	 * to record even if it has since been turned on - a half-timed event
	 * would report a handler that started before its own clock.
	 *
	 * The clock is read FIRST, before anything else this method does, so the
	 * bookkeeping below is outside the measurement.
	 */
	endHandler(startedAt: number | undefined): void {
		if (startedAt === undefined || !this.recording) return;
		const ms = this.host.now() - startedAt;
		this.events.push({ ms, samples: this.samples, layoutReads: this.layoutReads });
		this.layoutReads = 0;
		this.samples = 0;
	}

	/** Stop, and hand back the one line. Null when nothing was recorded. */
	end(canvas: MoveTraceCanvas): string | null {
		if (!this.recording) return null;
		this.recording = false;
		this.stopFrames();
		return formatMoveTrace({
			events: this.events,
			frameIntervals: this.frameIntervals,
			canvas,
		});
	}

	/** Drop the recording and the loop, for teardown. */
	dispose(): void {
		this.recording = false;
		this.stopFrames();
		this.events = [];
		this.frameIntervals = [];
	}
}
