import { afterEach, describe, expect, it } from "vitest";
import { emptyPage, parsePage, serializePage } from "../model/PageData";
import { EXP7_PEN, setPressureSensitivity, widthForPressure } from "./PenStyle";
import { StrokeBuilder } from "./StrokeBuilder";
import { ribbonOf } from "./StrokeOutline";
import { IncrementalShaper, shapedHalfWidths } from "./InkShape";
import { WetInkRenderer } from "./WetInkRenderer";
import { strokeToSvg } from "./SvgExport";
import { drawStroke } from "./StrokeRenderer";
import type { InkStroke } from "./Stroke";

afterEach(() => setPressureSensitivity(true));

function begin(on: boolean, tool: "pen" | "highlighter" = "pen", device?: "mouse", mode?: "uniform") {
	setPressureSensitivity(on);
	const builder = new StrokeBuilder(tool, "#123456", 2.2, undefined, device, mode);
	builder.start(0);
	return builder;
}

function write(on: boolean) {
	const builder = begin(on);
	[0.1, 0.4, 0.8, 0.6].forEach((p, i) => builder.add(i * 12, 0, p, i * 10));
	return builder.finish()!;
}

/** Record actual canvas calls, including uncached width derivation. */
function paint(stroke: InkStroke, smooth: boolean) {
	const calls: unknown[] = [];
	const ctx = new Proxy({}, {
		get: (_target, name) => (...args: unknown[]) => { calls.push([name, ...args]); },
		set: (_target, name, value) => { calls.push([name, value]); return true; },
	}) as CanvasRenderingContext2D;
	drawStroke(ctx, { x: 0, y: 0, zoom: 1 }, stroke, undefined, smooth, false);
	return calls;
}

describe("pressure is an input preference, not a rendering preference", () => {
	it("stores measured pressure when on and effective pressure when off, with the same stroke format", () => {
		const on = write(true), off = write(false);
		expect(on.points.map(p => p.pressure)).toEqual([0.1, 0.4, 0.8, 0.6]);
		expect(off.points.map(p => p.pressure)).toEqual([0.32, 0.32, 0.32, 0.32]);
		expect(off.pressureProfile).toBe("exp7");
		expect(Object.keys(off).sort()).toEqual(Object.keys(on).sort());
		// 0.32 is upstream's historical exp7 off-width, not maximum pressure.
		setPressureSensitivity(true);
		expect(widthForPressure(EXP7_PEN, off.points[0]!.pressure)).toBeCloseTo(2.188058154088379, 12);
	});

	it.each([true, false])("freezes the choice at start (on=%s), including deduplicated points", on => {
		const builder = begin(on);
		const first = builder.add(0, 0, 0.1, 0)!;
		setPressureSensitivity(!on);
		builder.add(0, 0, 0.8, 1);
		expect(first.pressure).toBe(on ? 0.8 : 0.32);
		builder.add(20, 0, 0.9, 10);
		expect(builder.finish()!.points.map(p => p.pressure)).toEqual(on ? [0.8, 0.9] : [0.32, 0.32]);
		builder.start(20);
		expect(builder.add(0, 0, 0.1, 20)!.pressure).toBe(on ? 0.32 : 0.1);
	});

	it("never restyles existing ink, including legacy strokes, when the switch changes", () => {
		const on = write(true), off = write(false);
		const legacy = { ...on, pressureProfile: undefined };
		setPressureSensitivity(true);
		const before = [on, off, legacy].map(ribbonOf);
		const exports = [on, off, legacy].map(s => strokeToSvg(s));
		const screen = [on, off, legacy].flatMap(s => [paint(s, true), paint(s, false)]);
		setPressureSensitivity(false);
		expect([on, off, legacy].map(ribbonOf)).toEqual(before);
		expect([on, off, legacy].map(s => strokeToSvg(s))).toEqual(exports);
		expect([on, off, legacy].flatMap(s => [paint(s, true), paint(s, false)])).toEqual(screen);
	});

	it.each([1, 2])("round-trips effective samples through storage v%s without a mode flag", version => {
		const page = emptyPage("capture");
		page.strokes = [write(true), write(false)];
		const before = page.strokes.map(ribbonOf);
		const encoded = serializePage(page, version);
		setPressureSensitivity(true);
		const loaded = parsePage(encoded, "capture").data;
		expect(loaded.strokes.map(ribbonOf)).toEqual(before);
		setPressureSensitivity(false);
		expect(loaded.strokes.map(ribbonOf)).toEqual(before);
		expect(loaded.strokes[1]!.points.every(p => p.pressure === 0.32)).toBe(true);
	});

	it("feeds effective samples to wet ink, with the same shaped widths before and after commit", () => {
		const builder = begin(false);
		const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
		const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
		const wet = new WetInkRenderer(canvas, false);
		wet.shape = true;
		wet.smooth = true;
		const shaper = new IncrementalShaper();
		const live: number[] = [];
		for (let i = 0; i < 4; i++) {
			const p = builder.add(i * 12, 0, i % 2 ? 0.95 : 0.05, i * 10)!;
			if (i === 0) {
				wet.beginStroke(p, EXP7_PEN, false, builder.resolvedPressureProfile);
				shaper.reset(p, EXP7_PEN);
			} else {
				wet.appendPoint({ x: 0, y: 0, zoom: 1 }, EXP7_PEN, p);
				shaper.push(EXP7_PEN, p);
			}
			live.push(wet.liveHalfWidth(EXP7_PEN, p.pressure));
			expect(live[i]).toBe(shaper.last());
			setPressureSensitivity(true);
		}
		const stroke = builder.finish()!;
		expect(live).toEqual(shapedHalfWidths(stroke.points, EXP7_PEN));
		expect(stroke.points.every(p => p.pressure === 0.32)).toBe(true);
		// Dots and endpoints use the ordinary exp7 rules, with no off-mode taper.
		expect(wet.contactHalfWidth(EXP7_PEN, 0.32)).toBe(EXP7_PEN.baseWidth / 2);
	});

	it("keeps measured pressure private for release filtering and snap previews", () => {
		const builder = begin(false);
		for (const [x, p, t] of [[0, 0.4, 0], [10, 0.3, 6], [12, 0.012, 10], [24, 0.014, 22], [28, 0.04, 27], [31, 0.08, 32], [40, 0.2, 40]]) {
			builder.add(x!, 0, p!, t!);
		}
		for (const strokes of [builder.snapshotReleaseFiltered(), builder.finishReleaseFiltered()]) {
			expect(strokes.map(s => s.points.map(p => p.x))).toEqual([[0, 10], [28, 31, 40]]);
			expect(strokes.every(s => s.points.every(p => p.pressure === 0.32))).toBe(true);
			expect(strokes.flatMap(s => s.points).every(p => Object.keys(p).sort().join() === "pressure,t,x,y")).toBe(true);
		}
	});

	it.each(["highlighter", "mouse", "uniform"] as const)("leaves %s input outside the pen pressure switch", kind => {
		const builder = begin(false, kind === "highlighter" ? "highlighter" : "pen", kind === "mouse" ? "mouse" : undefined, kind === "uniform" ? "uniform" : undefined);
		expect(builder.add(0, 0, 0.5, 0)!.pressure).toBe(0.5);
	});
});
