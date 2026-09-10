import { beforeEach, describe, expect, it } from "vitest";
import {
	consumeHintLagMs,
	discardHintSamples,
	presentLagMs,
	recordPresentAge,
	resetLatencyEstimate,
} from "./LatencyEstimate";

function feed(ms: number, times: number): void {
	for (let i = 0; i < times; i++) recordPresentAge(ms);
}

describe("presentation latency estimate", () => {
	beforeEach(() => resetLatencyEstimate());

	it("has no opinion until it has seen enough", () => {
		expect(presentLagMs()).toBeUndefined();
		feed(10, 23);
		expect(presentLagMs()).toBeUndefined();
		feed(10, 1);
		expect(presentLagMs()).toBe(10);
	});

	it("reports the median of what it has seen", () => {
		feed(6, 20);
		feed(30, 10);
		// 30 samples: twenty 6s then ten 30s, median sits in the 6s.
		expect(presentLagMs()).toBe(6);
	});

	it("does not let one stall move the horizon", () => {
		feed(8, 30);
		expect(presentLagMs()).toBe(8);
		// A GC pause or a dragged window. Plausible enough to be recorded,
		// and a mean would move; the median must not.
		recordPresentAge(200);
		expect(presentLagMs()).toBe(8);
	});

	it("drops samples that are stalls rather than latency", () => {
		feed(10, 12);
		// Twelve more, all past the plausible ceiling. If these counted, the
		// estimate would both warm up and read ~300ms.
		feed(600, 12);
		expect(presentLagMs()).toBeUndefined();
	});

	it("ignores garbage rather than poisoning the window", () => {
		feed(10, 24);
		recordPresentAge(Number.NaN);
		recordPresentAge(-5);
		recordPresentAge(Number.POSITIVE_INFINITY);
		expect(presentLagMs()).toBe(10);
	});

	it("forgets a machine's old behaviour as the window rolls", () => {
		feed(10, 64);
		expect(presentLagMs()).toBe(10);
		// A full window of a slower state - plugged in to battery, another
		// app taking the GPU - and the estimate follows rather than
		// averaging the two forever.
		feed(40, 64);
		expect(presentLagMs()).toBe(40);
	});
});

describe("the hint's fresh-batch buffer", () => {
	beforeEach(() => resetLatencyEstimate());

	it("has no opinion on a batch under the minimum, and spends it anyway", () => {
		feed(50, 23);
		expect(consumeHintLagMs()).toBeUndefined();
		// SPENT, not banked: the 23 do not wait for a 24th to complete them.
		// Letting them accumulate is what let a stale trickle qualify before.
		feed(50, 1);
		expect(consumeHintLagMs()).toBeUndefined();
		feed(50, 24);
		expect(consumeHintLagMs()).toBe(50);
	});

	it("returns the median of exactly the batch it detaches, once", () => {
		feed(50, 24);
		expect(consumeHintLagMs()).toBe(50);
		// The same interval cannot be read twice.
		expect(consumeHintLagMs()).toBeUndefined();
	});

	it("a consumed batch cannot colour the next one", () => {
		feed(10, 24);
		expect(consumeHintLagMs()).toBe(10);
		feed(50, 24);
		expect(consumeHintLagMs()).toBe(50);
	});

	it("keeps the latest values when one interval overflows the buffer", () => {
		// Capacity is 64. Forty low then sixty high inside ONE interval: the
		// earliest lows are pushed out, and the median must describe what the
		// buffer still holds rather than blending in samples it dropped.
		feed(10, 40);
		feed(90, 60);
		expect(consumeHintLagMs()).toBe(90);
		expect(consumeHintLagMs()).toBeUndefined();
	});

	it("filters exactly what the estimator filters", () => {
		feed(50, 20);
		recordPresentAge(Number.NaN);
		recordPresentAge(-1);
		recordPresentAge(501);
		recordPresentAge(Number.POSITIVE_INFINITY);
		// Four rejects buy nothing: still twenty real samples, under the bar.
		expect(consumeHintLagMs()).toBeUndefined();
		feed(50, 24);
		expect(consumeHintLagMs()).toBe(50);
	});

	it("takes 500 at the boundary, like the estimator", () => {
		feed(500, 24);
		expect(consumeHintLagMs()).toBe(500);
	});

	it("discard clears pending evidence without touching the estimate", () => {
		feed(50, 30);
		const before = presentLagMs();
		expect(before).toBe(50);
		discardHintSamples();
		expect(presentLagMs()).toBe(before);
		expect(consumeHintLagMs()).toBeUndefined();
	});
});

describe("the hint buffer does not disturb the prediction estimate", () => {
	/** The estimator exactly as it behaved before the hint buffer existed. */
	function referenceMedian(samples: number[]): number | undefined {
		const ring: number[] = [];
		let next = 0;
		for (const ms of samples) {
			if (!Number.isFinite(ms) || ms < 0 || ms > 500) continue;
			if (ring.length < 64) ring.push(ms);
			else {
				ring[next] = ms;
				next = (next + 1) % 64;
			}
		}
		if (ring.length < 24) return undefined;
		const sorted = [...ring].sort((a, b) => a - b);
		const mid = sorted.length >> 1;
		return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
	}

	/** Deterministic and deliberately awkward: warmup, odd and even ring
	 * lengths, repeated wraps, both boundaries and every kind of reject. */
	function mixedStream(): number[] {
		const stream: number[] = [];
		for (let i = 0; i < 300; i++) {
			stream.push(i % 37);
			if (i % 11 === 0) stream.push(-1);
			if (i % 13 === 0) stream.push(501);
			if (i % 17 === 0) stream.push(Number.NaN);
			if (i % 29 === 0) stream.push(500);
			if (i % 31 === 0) stream.push(0);
		}
		return stream;
	}

	it("matches the pre-hint estimator after every attempted sample", () => {
		resetLatencyEstimate();
		const seen: number[] = [];
		for (const ms of mixedStream()) {
			recordPresentAge(ms);
			seen.push(ms);
			expect(presentLagMs()).toBe(referenceMedian(seen));
		}
	});

	it("consuming and discarding hint batches leave the estimate alone", () => {
		resetLatencyEstimate();
		const seen: number[] = [];
		let i = 0;
		for (const ms of mixedStream()) {
			recordPresentAge(ms);
			seen.push(ms);
			// Interleave the hint's own operations at an awkward cadence.
			if (i % 7 === 0) consumeHintLagMs();
			if (i % 9 === 0) discardHintSamples();
			expect(presentLagMs()).toBe(referenceMedian(seen));
			i++;
		}
	});
});
