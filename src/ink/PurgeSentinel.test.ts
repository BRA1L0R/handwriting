/**
 * The purged-canvas sentinel: the decision, and where the readback is
 * allowed to happen.
 *
 * The condition it heals cannot be induced here - it needs WebKit under
 * memory pressure on an iPad - so what is testable is the decision table
 * around it and the guards it sits behind. Both matter more than usual,
 * because the readback is a synchronous `getImageData` and the whole reason
 * it ships switched off is that nobody could establish what it costs on the
 * device (PurgeSentinel.ts, and 1.4.12-design.md §14).
 *
 * The source assertions at the bottom are the half a behavioural test cannot
 * reach: `InkOverlay.repaint` is not constructible in this suite, so "the
 * readback is behind the mobile guard" is pinned by reading the call site.
 * Counted on `codeOnly` output so prose about the guard cannot stand in for
 * the guard, the lesson DeferredUnloadGuard.test.ts wrote down.
 */
import { describe, expect, it, vi } from "vitest";
import overlaySrc from "../inline/InkOverlay.ts?raw";
import rendererSrc from "./StrokeRenderer.ts?raw";
import { codeOnly } from "../CodeOnly";
import {
	PURGE_PROBE_INTERVAL_MS,
	PURGE_SENTINEL_ALPHA,
	PURGE_SENTINEL_CSS,
	PurgeProbeGate,
	paintPurgeSentinel,
	purgeDetected,
	purgeProbeArmed,
	purgeProbeDue,
} from "./PurgeSentinel";

/** The one shape where a probe is due; each test breaks exactly one term. */
const DUE: PurgeProbeGate = {
	armed: true,
	scrollRepaint: true,
	foundWork: false,
	strokeOwnsFrame: false,
	noteHasInk: true,
	now: 10_000,
	lastProbe: 9_000,
};

describe("purgeProbeArmed", () => {
	it("needs mobile AND a recording session", () => {
		expect(purgeProbeArmed(true, true)).toBe(true);
		expect(purgeProbeArmed(true, false)).toBe(false);
		expect(purgeProbeArmed(false, true)).toBe(false);
		expect(purgeProbeArmed(false, false)).toBe(false);
	});
});

describe("purgeProbeDue", () => {
	it("is due on a scroll repaint that drew nothing", () => {
		expect(purgeProbeDue(DUE)).toBe(true);
	});

	it("is refused by every guard on its own", () => {
		// Each row is DUE with one term spoiled, so a guard that stopped
		// being read shows up as exactly one failure and names itself.
		const spoilt: [string, Partial<PurgeProbeGate>][] = [
			["not armed (desktop, or not recording)", { armed: false }],
			["something other than scrolling asked", { scrollRepaint: false }],
			["the frame actually drew", { foundWork: true }],
			["a stroke owns the frame", { strokeOwnsFrame: true }],
			["the note has no ink", { noteHasInk: false }],
		];
		for (const [why, patch] of spoilt) {
			expect(purgeProbeDue({ ...DUE, ...patch }), why).toBe(false);
		}
	});

	it("throttles to one readback per interval, and no faster", () => {
		const last = 1_000;
		expect(purgeProbeDue({ ...DUE, lastProbe: last, now: last })).toBe(false);
		expect(
			purgeProbeDue({ ...DUE, lastProbe: last, now: last + PURGE_PROBE_INTERVAL_MS - 1 })
		).toBe(false);
		expect(
			purgeProbeDue({ ...DUE, lastProbe: last, now: last + PURGE_PROBE_INTERVAL_MS })
		).toBe(true);
	});

	it("is due at once on the first frame of a session", () => {
		// The field starts at -Infinity precisely so a clock that has barely
		// started does not hold the first probe back by 300ms.
		expect(purgeProbeDue({ ...DUE, lastProbe: -Infinity, now: 0 })).toBe(true);
	});
});

describe("purgeDetected", () => {
	it("treats only a zero read as a purge", () => {
		expect(purgeDetected(0)).toBe(true);
		expect(purgeDetected(1)).toBe(false);
		// countPaintedPixels reports a refused readback as -1. A canvas that
		// would not be read is not a canvas that was reclaimed, and healing
		// on it would repaint the world on every probe forever.
		expect(purgeDetected(-1)).toBe(false);
	});
});

describe("paintPurgeSentinel", () => {
	const fakeCtx = () => {
		const calls: string[] = [];
		const ctx = {
			globalAlpha: 1,
			globalCompositeOperation: "xor",
			fillStyle: "#ff0000",
			save: () => void calls.push("save"),
			restore: () => void calls.push("restore"),
			clearRect: vi.fn(() => void calls.push("clear")),
			fillRect: vi.fn(() => void calls.push("fill")),
		};
		return { ctx, calls };
	};

	it("clears before it fills, so painting twice is painting once", () => {
		const { ctx, calls } = fakeCtx();
		paintPurgeSentinel(ctx as unknown as CanvasRenderingContext2D);
		expect(calls).toEqual(["save", "clear", "fill", "restore"]);
		expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, PURGE_SENTINEL_CSS, PURGE_SENTINEL_CSS);
		expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, PURGE_SENTINEL_CSS, PURGE_SENTINEL_CSS);
	});

	it("paints at the band's top-left corner, never anywhere on screen", () => {
		const { ctx } = fakeCtx();
		paintPurgeSentinel(ctx as unknown as CanvasRenderingContext2D);
		const [x, y] = ctx.fillRect.mock.calls[0] as number[];
		expect(x).toBe(0);
		expect(y).toBe(0);
	});

	it("sets its own alpha and compositing rather than inheriting them", () => {
		const { ctx } = fakeCtx();
		paintPurgeSentinel(ctx as unknown as CanvasRenderingContext2D);
		expect(ctx.globalAlpha).toBe(PURGE_SENTINEL_ALPHA);
		expect(ctx.globalCompositeOperation).toBe("source-over");
		expect(ctx.fillStyle).toBe("#000000");
	});

	it("is exactly one 8-bit alpha step: invisible, and it survives the byte", () => {
		expect(PURGE_SENTINEL_ALPHA * 255).toBeCloseTo(1, 12);
		expect(Math.round(PURGE_SENTINEL_ALPHA * 255)).toBe(1);
	});

	it("covers a whole device pixel even where the area budget trimmed below 1", () => {
		// ZoomScale's budget can now hand back a backing scale under 1, so a
		// 1 CSS px marker could cover less than one device pixel.
		expect(PURGE_SENTINEL_CSS).toBeGreaterThanOrEqual(2);
	});
});

describe("the readback is behind the guards, in the source", () => {
	const overlay = codeOnly(overlaySrc);
	const renderer = codeOnly(rendererSrc);

	it("the overlay reads the sentinel exactly once, and only under purgeProbeDue", () => {
		expect(overlay.match(/readPurgeSentinel\(/g) ?? []).toHaveLength(1);
		expect(overlay).toMatch(
			/purgeProbeDue\(\{[\s\S]{0,600}?\}\)[\s\S]{0,200}?readPurgeSentinel\(/
		);
	});

	it("the armed flag is the mobile AND recording pair, read at the paint", () => {
		expect(overlay).toMatch(
			/purgeProbeArmed\(\s*Platform\.isMobileApp\s*,\s*diagnosticsEnabled\(\)\s*\)/
		);
		// And nothing else may arm it: one call, feeding both the marker and
		// the gate, so the paint and the read can never disagree.
		expect(overlay.match(/purgeProbeArmed\(/g) ?? []).toHaveLength(1);
	});

	it("the marker is painted only when armed, on both the full and partial paths", () => {
		// `probeArmed` is followed by the width-floor argument now, not a bare
		// close-paren - matches either shape, but still pins that `probeArmed`
		// is the argument in that position and nothing renamed it away.
		expect(overlay).toMatch(/"pen",\s*probeArmed[,)]/);
		expect(overlay).toMatch(/if \(probeArmed\) paintPurgeSentinel\(/);
	});

	it("drawCommitted paints it only when its caller asks", () => {
		expect(renderer).toMatch(/sentinel = false/);
		expect(renderer).toMatch(/if \(sentinel\) paintPurgeSentinel\(ctx\);/);
	});

	it("stays the only getImageData in production source, through countPaintedPixels", () => {
		// This repo has exactly one readback call site and a comment on the
		// wet renderer saying "never on the hot path". The heal must not
		// become the second one.
		expect(codeOnly(overlaySrc)).not.toMatch(/getImageData\(/);
	});
});
