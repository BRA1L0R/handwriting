/**
 * THE INK LOSS ON ALAN'S TRACE.
 *
 * Alan drew a stroke gently in the middle and hard near the end. The wet layer
 * drew all of it; the committed stroke lost the light middle, because the
 * release filter called 191 ms of in-contact light writing "release travel",
 * removed it and split the stroke in two.
 *
 * Alan's traces are never committed (public repository), so these cells run only
 * when HW_INK_LOSS_TRACE names his d1c16bdb.json; the gate skips them. The
 * committed synthetic of the same shape is in StrokeBuilder.test.ts.
 *
 * The replay is at 100 percent (world px = the trace's CSS px). There the run's
 * travel (about 184 px) and duration (about 191 ms from the release edge) pass
 * the travel and time gates many times over, and the cells assert that they do.
 * So the red on the old filter and the green on the new one are both the
 * RELEASE_MAX_MS ceiling's verdict (188 ms from the first light sample to the
 * last), never a gate the run failed to reach.
 *
 * The control is Alan's real lift-and-hop on the Surface (bug report 61ed1043,
 * HW_HOP_TRACE): five contacts with no light sample at all, which must replay to
 * five strokes keeping every sample, on the old filter and the new.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { installFakeWindow } from "../../test/routerHarness";
import { replayTrace } from "../../test/pressureFeel";
import type { InkPoint, InkStroke } from "./Stroke";
import { RELEASE_MAX_MS } from "./StrokeBuilder";

declare const process: { env: Record<string, string | undefined> };
const TRACE = process.env.HW_INK_LOSS_TRACE;

/** StrokeBuilder's filter constants, restated only to find the run and check the gates it passes. */
const RELEASE_PRESSURE_MAX = 0.025;
const CONFIDENT_CONTACT_PRESSURE = 0.08;
const RELEASE_MIN_MS = 8;
const RELEASE_MIN_TRAVEL = 3;

interface Passage {
	/** The light run's samples, the release edge excluded. */
	run: InkPoint[];
	/** Edge to run end, the duration RELEASE_MIN_MS gates. */
	durationMs: number;
	/** First light sample to last, the duration RELEASE_MAX_MS caps. */
	lightMs: number;
	travel: number;
}

/** The longest light run that follows a confident contact and is followed by one. */
function interiorPassage(points: InkPoint[]): Passage | null {
	const firstConfident = points.findIndex((p) => p.pressure >= CONFIDENT_CONTACT_PRESSURE);
	if (firstConfident < 0) return null;
	let best: Passage | null = null;
	let i = firstConfident;
	while (i < points.length) {
		if (points[i]!.pressure > RELEASE_PRESSURE_MAX) {
			i++;
			continue;
		}
		let end = i;
		while (end + 1 < points.length && points[end + 1]!.pressure <= RELEASE_PRESSURE_MAX) end++;
		const recovered = points.slice(end + 1).some((p) => p.pressure >= CONFIDENT_CONTACT_PRESSURE);
		if (recovered) {
			const edge = i - 1;
			let travel = 0;
			for (let k = edge + 1; k <= end; k++) travel += Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.y - points[k - 1]!.y);
			const passage = { run: points.slice(i, end + 1), durationMs: points[end]!.t - points[edge]!.t, lightMs: points[end]!.t - points[i]!.t, travel };
			if (!best || passage.run.length > best.run.length) best = passage;
		}
		i = end + 1;
	}
	return best;
}

describe.skipIf(!TRACE || !existsSync(TRACE))("Alan's d1c16bdb: the light middle of the stroke survives lift", () => {
	let uninstall: () => void;
	let contacts: { accepted: InkPoint[]; committed: InkStroke[] }[] = [];

	beforeAll(() => {
		uninstall = installFakeWindow();
		contacts = [];
		replayTrace(TRACE!, undefined, (accepted, committed) => contacts.push({ accepted, committed }));
	});
	afterAll(() => uninstall());

	it("finds the passage the read measured, passing the travel and time gates, longer than the ceiling", () => {
		const pen = contacts.filter((c) => interiorPassage(c.accepted));
		expect(pen, "one contact with an interior light run").toHaveLength(1);
		const passage = interiorPassage(pen[0]!.accepted)!;
		expect(passage.run.length, "the read's 51 samples").toBe(51);
		expect(Math.min(...passage.run.map((p) => p.pressure)), "down to the read's 0.0039").toBeCloseTo(0.0039, 4);
		expect(passage.durationMs, "time gate met").toBeGreaterThanOrEqual(RELEASE_MIN_MS);
		expect(passage.travel, "travel gate met").toBeGreaterThanOrEqual(RELEASE_MIN_TRAVEL);
		expect(passage.durationMs, "the read's 191 ms from the release edge").toBeCloseTo(191, 0);
		expect(passage.lightMs, "188 ms of light samples, over the ceiling").toBeGreaterThan(RELEASE_MAX_MS);
		expect(passage.lightMs).toBeCloseTo(188, 0);
	});

	it("commits every sample of the passage, and the contact stays one stroke", () => {
		const c = contacts.find((k) => interiorPassage(k.accepted))!;
		const committed = new Set(c.committed.flatMap((s) => s.points));
		const passage = interiorPassage(c.accepted)!;
		const lost = passage.run.filter((p) => !committed.has(p));
		expect(lost.length, "samples of the light passage missing from the committed stroke").toBe(0);
		expect(c.committed, "no split around the glide").toHaveLength(1);
	});

	it("commits every sample the wet layer drew, on every contact, a trailing release skid alone excepted", () => {
		for (const [n, c] of contacts.entries()) {
			// A trailing light run within RELEASE_MAX_MS is a lift skid and is still removed; none is on this trace.
			const lastConfident = c.accepted.map((p) => p.pressure >= CONFIDENT_CONTACT_PRESSURE).lastIndexOf(true);
			let tailFrom = c.accepted.length;
			while (lastConfident >= 0 && tailFrom - 1 > lastConfident && c.accepted[tailFrom - 1]!.pressure <= RELEASE_PRESSURE_MAX) tailFrom--;
			const committed = new Set(c.committed.flatMap((s) => s.points));
			const missing = c.accepted.slice(0, tailFrom).filter((p) => !committed.has(p));
			expect(missing.length, `contact ${n + 1}: accepted samples before any terminal skid missing from the committed strokes`).toBe(0);
		}
	});
});

const HOP = process.env.HW_HOP_TRACE;

describe.skipIf(!HOP || !existsSync(HOP))("control: Alan's Surface lift-and-hop 61ed1043 replays to five clean strokes", () => {
	let uninstall: () => void;
	let contacts: { accepted: InkPoint[]; committed: InkStroke[] }[] = [];

	beforeAll(() => {
		uninstall = installFakeWindow();
		contacts = [];
		replayTrace(HOP!, undefined, (accepted, committed) => contacts.push({ accepted, committed }));
	});
	afterAll(() => uninstall());

	it("has no light sample anywhere, so the filter has nothing to judge", () => {
		expect(contacts, "five pen contacts").toHaveLength(5);
		const light = contacts.flatMap((c) => c.accepted).filter((p) => p.pressure <= RELEASE_PRESSURE_MAX);
		expect(light.length, "samples at or below the release pressure").toBe(0);
	});

	it("commits each contact as one stroke holding every accepted sample", () => {
		for (const [n, c] of contacts.entries()) {
			expect(c.committed, `contact ${n + 1}: one stroke`).toHaveLength(1);
			expect(c.committed[0]!.points, `contact ${n + 1}: every sample`).toEqual(c.accepted);
		}
	});
});
