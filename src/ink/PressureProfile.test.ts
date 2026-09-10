import { afterEach, describe, expect, it } from "vitest";
import { emptyPage, parsePage, serializePage } from "../model/PageData";
import { DEFAULT_PEN, EXP7_PEN, setPressureSensitivity, widthForPressure } from "./PenStyle";
import { StrokeBuilder } from "./StrokeBuilder";
import oracle from "../../test/fixtures/exp7-pen-before-rollback.json";
import { WetInkRenderer } from "./WetInkRenderer";
import { flattenStroke } from "./Ribbon";
import { flattenStrokeShaped, IncrementalShaper } from "./InkShape";
import { ribbonOf } from "./StrokeOutline";
import { strokeWidthPolicy } from "./StrokeWidth";
import type { InkStroke } from "./Stroke";
import { computeBBox } from "./Stroke";
import { snapStroke } from "./ShapeSnap";
import { splitStrokeByCircle } from "./Eraser";
import { clearInkClipboard, copyInk, pasteInk } from "../inline/InkClipboard";
import { drawStroke, resetRibbonCacheStats, ribbonCacheStats } from "./StrokeRenderer";

function wetCanvas(): HTMLCanvasElement {
	const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
	return { getContext: () => ctx } as unknown as HTMLCanvasElement;
}

afterEach(() => setPressureSensitivity(true));

describe("exp7 pressure profile", () => {
	it("uses the immutable accepted ON and OFF laws", () => {
		expect(EXP7_PEN.minWidthFactor).toBe(0.18);
		expect(EXP7_PEN.gamma).toBe(1.15);
		expect(EXP7_PEN.maxWidthFactor).toBe(3.2);
		expect(EXP7_PEN.pressureOffWidthFactor).toBe(0.9945718882219903);
		for (const frozen of oracle.cases) {
			setPressureSensitivity(frozen.pressureOn);
			expect(widthForPressure({ ...EXP7_PEN, baseWidth: 2.2 }, frozen.pressure)).toBe(frozen.rawWidth);
		}
	});

	it("matches every frozen committed/export/wet/highlighter oracle array", () => {
		const closeRibbon = (actual: Array<{ x: number; y: number; hw: number }>, expected: typeof actual) => {
			expect(actual).toHaveLength(expected.length);
			for (let i = 0; i < expected.length; i++) {
				expect(actual[i]!.x).toBeCloseTo(expected[i]!.x, 12);
				expect(actual[i]!.y).toBeCloseTo(expected[i]!.y, 12);
				expect(actual[i]!.hw).toBeCloseTo(expected[i]!.hw, 12);
			}
		};
		for (const frozen of oracle.cases) {
			setPressureSensitivity(frozen.pressureOn);
			const stroke: InkStroke = { ...frozen.stroke, tool: frozen.stroke.tool as "pen", pressureProfile: "exp7" };
			const style = strokeWidthPolicy({ ...EXP7_PEN, color: stroke.color, baseWidth: stroke.width }, undefined, "exp7").style;
			closeRibbon(flattenStrokeShaped(stroke.points, style, 1), frozen.screenShapedAtZoom1);
			closeRibbon(flattenStroke(stroke.points, style, 1, false), frozen.screenRawAtZoom1);
			closeRibbon(flattenStroke(stroke.points, style, 1, true), frozen.screenMouseSmoothedAtZoom1);
			closeRibbon(ribbonOf(stroke), frozen.exportRibbon);
			closeRibbon(ribbonOf({ ...stroke, tool: "highlighter", width: 16 }), frozen.highlighterExportRibbon);
			const shaper = new IncrementalShaper();
			shaper.reset(stroke.points[0], style);
			const wet = [shaper.last(), ...stroke.points.slice(1).map((point) => shaper.push(style, point))];
			expect(wet.length).toBe(frozen.incrementalHalfWidths.length);
			for (let i = 0; i < wet.length; i++) expect(wet[i]).toBeCloseTo(frozen.incrementalHalfWidths[i]!, 12);
		}
	});

	it("keeps the actual builder/wet consumer on the frozen generation", () => {
		for (const frozen of oracle.cases.slice(0, 2)) {
			setPressureSensitivity(frozen.pressureOn);
			const builder = new StrokeBuilder("pen", frozen.stroke.color, frozen.stroke.width);
			builder.start(0);
			const first = builder.add(frozen.stroke.points[0]!.x, frozen.stroke.points[0]!.y, frozen.pressure, 0)!;
			const wet = new WetInkRenderer(wetCanvas(), false);
			wet.smooth = true;
			wet.shape = true;
			const style = { ...DEFAULT_PEN, color: frozen.stroke.color, baseWidth: frozen.stroke.width };
			expect(style.minWidthFactor).not.toBe(EXP7_PEN.minWidthFactor);
			expect(style.gamma).not.toBe(EXP7_PEN.gamma);
			wet.beginStroke(first, style, false, builder.resolvedPressureProfile);
			expect(wet.liveHalfWidth(style, frozen.pressure)).toBeCloseTo(frozen.incrementalHalfWidths[0]!, 12);
			for (let i = 1; i < frozen.stroke.points.length; i++) {
				const point = frozen.stroke.points[i]!;
				builder.add(point.x, point.y, point.pressure, point.t);
				wet.appendPoint({ x: 0, y: 0, zoom: 1 }, style, point);
				expect(wet.liveHalfWidth(style, point.pressure)).toBeCloseTo(frozen.incrementalHalfWidths[i]!, 12);
			}
			expect(builder.finish()!.pressureProfile).toBe("exp7");
		}
	});

	it("stamps eligible pen and mouse output while uniform and highlighter win", () => {
		const make = (tool: "pen" | "highlighter", device?: "mouse", mode?: "uniform") => {
			const b = new StrokeBuilder(tool, "#111", 2, 0.15, device, mode);
			b.start(1000);
			b.add(0, 0, 0.5, 1000);
			b.add(10, 0, 0.5, 1008);
			return b.finish()!;
		};
		expect(make("pen").pressureProfile).toBe("exp7");
		expect(make("pen", "mouse").pressureProfile).toBe("exp7");
		expect(make("pen", undefined, "uniform").pressureProfile).toBeUndefined();
		expect(make("highlighter").pressureProfile).toBeUndefined();
	});

	it("keeps interleaved builders isolated, including a builder with no wet renderer", () => {
		const untouched = new StrokeBuilder("pen", "#111", 2);
		untouched.start(0);
		const exp7 = new StrokeBuilder("pen", "#111", 2);
		exp7.start(0);
		const uniform = new StrokeBuilder("pen", "#111", 2, 0.15, undefined, "uniform");
		uniform.start(0);
		expect(untouched.resolvedPressureProfile).toBe("exp7");
		expect(exp7.resolvedPressureProfile).toBe("exp7");
		expect(uniform.resolvedPressureProfile).toBeUndefined();
		const a = new WetInkRenderer(wetCanvas(), false);
		const b = new WetInkRenderer(wetCanvas(), false);
		a.shape = true;
		b.shape = true;
		const first = { x: 0, y: 0, pressure: 1, t: 0 };
		a.beginStroke(first, { ...EXP7_PEN, baseWidth: 2 }, false, exp7.resolvedPressureProfile);
		const legacy = { ...EXP7_PEN, baseWidth: 2, pressureProfile: undefined, minWidthFactor: 0.35, gamma: 0.75, maxWidthFactor: 1, pressureOffWidthFactor: 0.7364923123758843 };
		b.beginStroke(first, legacy, false, uniform.resolvedPressureProfile);
		a.appendPoint({ x: 0, y: 0, zoom: 1 }, EXP7_PEN, { x: 20, y: 0, pressure: 1, t: 5 });
		b.appendPoint({ x: 0, y: 0, zoom: 1 }, legacy, { x: 20, y: 0, pressure: 1, t: 5 });
		expect(a.liveHalfWidth(EXP7_PEN, 1)).toBeGreaterThan(b.liveHalfWidth(legacy, 1));
	});

	it("round-trips exp7 and preserves an unrecognized future value opaquely", () => {
		const page = emptyPage("profiles");
		page.strokes = [
			{
				id: "known", tool: "pen", color: "#111", width: 2, pressureProfile: "exp7",
				points: [{ x: 0, y: 0, pressure: 0.5, t: 0 }, { x: 4, y: 0, pressure: 0.5, t: 1 }],
				bbox: { x: -4, y: -4, width: 12, height: 8 }, createdAt: 1,
			},
			{
				id: "future", tool: "pen", color: "#111", width: 2,
				points: [{ x: 0, y: 0, pressure: 0.5, t: 0 }, { x: 4, y: 0, pressure: 0.5, t: 1 }],
				bbox: { x: -4, y: -4, width: 12, height: 8 }, createdAt: 1,
			} as typeof page.strokes[number],
		];
		const raw = JSON.parse(serializePage(page)) as { strokes: Array<Record<string, unknown>> };
		raw.strokes[1]!.pressureProfile = "future-profile";
		const restored = parsePage(JSON.stringify(raw), "profiles").data;
		expect(restored.strokes[0]!.pressureProfile).toBe("exp7");
		expect(restored.unknownByObject.future).toEqual({ pressureProfile: "future-profile" });
		const again = JSON.parse(serializePage(restored)) as { strokes: Array<Record<string, unknown>> };
		expect(again.strokes.map((s) => s.pressureProfile)).toEqual(["exp7", "future-profile"]);
	});

	it("preserves exp7 through current transforms and misses cache on profile change", () => {
		const points = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 2, pressure: i % 2 === 0 ? 0.1 : 0.9, t: i * 8 }));
		const source: InkStroke = { id: "source", tool: "pen", color: "#111", width: 2, pressureProfile: "exp7", points, bbox: computeBBox(points, 4), createdAt: 1 };
		const snapped = snapStroke(source, true);
		expect(snapped).not.toBeNull();
		expect(snapped?.pressureProfile).toBe("exp7");
		let id = 0;
		const pieces = splitStrokeByCircle(source, 40, 0, 4, () => `piece-${++id}`);
		expect(pieces.length).toBeGreaterThan(1);
		expect(pieces.every((piece) => piece.pressureProfile === "exp7")).toBe(true);
		clearInkClipboard();
		copyInk([source], "from.md");
		expect(pasteInk("to.md")[0]!.pressureProfile).toBe("exp7");
		resetRibbonCacheStats();
		drawStroke(wetCanvas().getContext("2d")!, { x: 0, y: 0, zoom: 1 }, source, undefined, true);
		source.pressureProfile = undefined;
		drawStroke(wetCanvas().getContext("2d")!, { x: 0, y: 0, zoom: 1 }, source, undefined, true);
		expect(ribbonCacheStats()).toMatchObject({ misses: 2, flattens: 2 });
	});
});
