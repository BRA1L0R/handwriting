import { afterEach, describe, expect, it } from "vitest";
import { setDiagnosticsEnabled } from "../diag/DiagSwitch";
import {
	MoveTraceEvent,
	MoveTraceHost,
	SLOW_FRAME_MS,
	SlidesMoveTrace,
	formatMoveTrace,
} from "./SlidesMoveTrace";

const ORION = { cssWidth: 2560, cssHeight: 1392, dpr: 2 };

function ev(ms: number, samples = 1, layoutReads = 0): MoveTraceEvent {
	return { ms, samples, layoutReads };
}

/** A clock and a frame source the test drives by hand. */
class FakeHost implements MoveTraceHost {
	t = 0;
	private next = 1;
	private pending = new Map<number, (t: number) => void>();

	now(): number {
		return this.t;
	}
	requestAnimationFrame(fn: (t: number) => void): number {
		const h = this.next++;
		this.pending.set(h, fn);
		return h;
	}
	cancelAnimationFrame(handle: number): void {
		this.pending.delete(handle);
	}
	/** Advance the clock and deliver whatever frame is outstanding. */
	tick(ms: number): void {
		this.t += ms;
		const [h, fn] = [...this.pending.entries()][0] ?? [];
		if (h === undefined || !fn) return;
		this.pending.delete(h);
		fn(this.t);
	}
	get frameQueued(): boolean {
		return this.pending.size > 0;
	}
}

afterEach(() => setDiagnosticsEnabled(false));

describe("formatMoveTrace", () => {
	it("prints the whole line from a fixed sequence", () => {
		const line = formatMoveTrace({
			events: [ev(1, 1), ev(2, 1), ev(3, 2), ev(2, 2)],
			frameIntervals: [16, 17, 34, 16, 21],
			canvas: ORION,
		});
		expect(line).toBe(
			"[slides] move trace: 4 events, mean 2.00 ms, max 3.00 ms, " +
				"samples/event 1.50, layout reads 0, frames 5, slow frames 2 (>20 ms), " +
				"canvas 2560x1392@dpr 2.00"
		);
	});

	it("sums the layout reads across events", () => {
		const line = formatMoveTrace({
			events: [ev(1, 1, 1), ev(1, 1, 0), ev(1, 1, 3)],
			frameIntervals: [],
			canvas: ORION,
		});
		expect(line).toContain("layout reads 4");
		expect(line).toContain("frames 0, slow frames 0");
	});

	it("does not count a frame exactly on the threshold as slow", () => {
		const line = formatMoveTrace({
			events: [],
			frameIntervals: [SLOW_FRAME_MS, SLOW_FRAME_MS + 0.01],
			canvas: ORION,
		});
		expect(line).toContain("slow frames 1 (>20 ms)");
	});

	it("prints an empty stroke rather than dividing by zero", () => {
		const line = formatMoveTrace({ events: [], frameIntervals: [], canvas: ORION });
		expect(line).toBe(
			"[slides] move trace: 0 events, mean 0.00 ms, max 0.00 ms, " +
				"samples/event 0.00, layout reads 0, frames 0, slow frames 0 (>20 ms), " +
				"canvas 2560x1392@dpr 2.00"
		);
	});

	it("rounds the canvas box and keeps two decimals on the dpr", () => {
		const line = formatMoveTrace({
			events: [],
			frameIntervals: [],
			canvas: { cssWidth: 1279.6, cssHeight: 720.4, dpr: 1.25 },
		});
		expect(line).toContain("canvas 1280x720@dpr 1.25");
	});
});

describe("SlidesMoveTrace recording", () => {
	it("records nothing and starts no frame loop while diagnostics are off", () => {
		const host = new FakeHost();
		const t = new SlidesMoveTrace(host);
		t.begin();
		expect(t.active).toBe(false);
		expect(host.frameQueued).toBe(false);
		expect(t.markHandlerStart()).toBeUndefined();
		t.countSamples(4);
		t.countLayoutRead();
		expect(t.end(ORION)).toBeNull();
	});

	it("times handlers, counts samples and layout reads, and closes the line", () => {
		setDiagnosticsEnabled(true);
		const host = new FakeHost();
		const t = new SlidesMoveTrace(host);
		t.begin();
		expect(t.active).toBe(true);

		const a = t.markHandlerStart();
		t.countSamples(2);
		host.t += 4;
		t.endHandler(a);

		const b = t.markHandlerStart();
		t.countSamples(1);
		t.countLayoutRead();
		host.t += 1;
		t.endHandler(b);

		expect(t.end(ORION)).toBe(
			"[slides] move trace: 2 events, mean 2.50 ms, max 4.00 ms, " +
				"samples/event 1.50, layout reads 1, frames 0, slow frames 0 (>20 ms), " +
				"canvas 2560x1392@dpr 2.00"
		);
		expect(t.active).toBe(false);
	});

	it("keeps pumping frames and records their intervals until the stroke ends", () => {
		setDiagnosticsEnabled(true);
		const host = new FakeHost();
		const t = new SlidesMoveTrace(host);
		t.begin();
		host.tick(16);
		host.tick(30);
		host.tick(16);
		expect(host.frameQueued).toBe(true);
		const line = t.end(ORION);
		expect(line).toContain("frames 3, slow frames 1 (>20 ms)");
		// The loop is not left running behind the stroke that started it.
		expect(host.frameQueued).toBe(false);
	});

	it("stops the frame loop on dispose", () => {
		setDiagnosticsEnabled(true);
		const host = new FakeHost();
		const t = new SlidesMoveTrace(host);
		t.begin();
		host.tick(16);
		t.dispose();
		expect(host.frameQueued).toBe(false);
		expect(t.active).toBe(false);
		expect(t.end(ORION)).toBeNull();
	});

	it("drops a handler that began before recording did", () => {
		setDiagnosticsEnabled(true);
		const host = new FakeHost();
		const t = new SlidesMoveTrace(host);
		const stale = t.markHandlerStart();
		expect(stale).toBeUndefined();
		t.begin();
		t.endHandler(stale);
		expect(t.end(ORION)).toContain("0 events");
	});

	it("clears the previous stroke's numbers when a new one begins", () => {
		setDiagnosticsEnabled(true);
		const host = new FakeHost();
		const t = new SlidesMoveTrace(host);
		t.begin();
		const a = t.markHandlerStart();
		t.countSamples(9);
		host.t += 40;
		t.endHandler(a);
		host.tick(50);
		t.end(ORION);

		t.begin();
		const b = t.markHandlerStart();
		t.countSamples(1);
		host.t += 1;
		t.endHandler(b);
		expect(t.end(ORION)).toBe(
			"[slides] move trace: 1 events, mean 1.00 ms, max 1.00 ms, " +
				"samples/event 1.00, layout reads 0, frames 0, slow frames 0 (>20 ms), " +
				"canvas 2560x1392@dpr 2.00"
		);
	});
});
