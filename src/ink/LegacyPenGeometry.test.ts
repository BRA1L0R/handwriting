import { afterEach, describe, expect, it } from "vitest";
import historical from "../../test/fixtures/legacy-pen-1.4.12.json";
import { parsePage } from "../model/PageData";
import { IncrementalShaper, flattenStrokeShaped } from "./InkShape";
import { setPressureSensitivity, shapeFor, widthForPressure } from "./PenStyle";
import { flattenStroke, type RibbonPt } from "./Ribbon";
import { ribbonOf } from "./StrokeOutline";

// Frozen by executing refs/tags/1.4.12, not by calling today's shapeFor.
// The fixture records source hashes and every sample, including both tips.
function expectRibbon(actual: RibbonPt[], expected: RibbonPt[]): void {
	expect(actual).toHaveLength(expected.length);
	for (const [i, point] of expected.entries()) {
		for (const axis of ["x", "y", "hw"] as const) {
			expect(actual[i]![axis], `point ${i}.${axis}`).toBeCloseTo(point[axis], 12);
		}
	}
}

afterEach(() => setPressureSensitivity(true));

describe.each(historical.cases)(
	"saved 1.4.12 pen geometry: pressure=$pressure, sensitivity=$pressureOn",
	(frozen) => {
		function savedStroke() {
			const { points, bbox: _bbox, ...stored } = frozen.stroke;
			const parsed = parsePage(JSON.stringify({
				schemaVersion: 1,
				pageId: "legacy-pen",
				strokes: [{ ...stored, pts: points.flatMap(p => [p.x, p.y, p.pressure, p.t]) }],
			}), "legacy-pen");
			expect(parsed.damaged).toBeUndefined();
			expect(parsed.data.strokes).toHaveLength(1);
			const stroke = parsed.data.strokes[0]!;
			expect(stroke.points).toEqual(points);
			expect(stroke.width).toBe(stored.width);
			expect(stroke.widthMode).toBeUndefined();
			setPressureSensitivity(frozen.pressureOn);
			return stroke;
		}

		it("restores the raw width and screen geometry with shaping on or off", () => {
			const stroke = savedStroke();
			const style = { color: stroke.color, baseWidth: stroke.width, ...shapeFor(false) };
			expect(widthForPressure(style, frozen.pressure)).toBeCloseTo(frozen.rawWidth, 12);
			expectRibbon(flattenStrokeShaped(stroke.points, style, 1), frozen.screenShapedAtZoom1);
			expectRibbon(flattenStroke(stroke.points, style, 1, false), frozen.screenRawAtZoom1);
			expectRibbon(flattenStroke(stroke.points, style, 1, true), frozen.screenMouseSmoothedAtZoom1);
		});

		it("restores export geometry shared by SVG and PDF", () => {
			expectRibbon(ribbonOf(savedStroke()), frozen.exportRibbon);
		});

		it("restores the incremental wet width from contact through the final sample", () => {
			const stroke = savedStroke();
			const style = { color: stroke.color, baseWidth: stroke.width, ...shapeFor(false) };
			const shaper = new IncrementalShaper();
			shaper.reset(stroke.points[0], style);
			const actual = [shaper.last(), ...stroke.points.slice(1).map(p => shaper.push(style, p))];
			expect(actual).toHaveLength(frozen.incrementalHalfWidths.length);
			for (const [i, width] of frozen.incrementalHalfWidths.entries()) {
				expect(actual[i], `wet sample ${i}`).toBeCloseTo(width, 12);
			}
		});

		it("preserves historical highlighter geometry", () => {
			expectRibbon(
				ribbonOf({ ...savedStroke(), tool: "highlighter", width: 16 }),
				frozen.highlighterExportRibbon
			);
		});
	}
);
