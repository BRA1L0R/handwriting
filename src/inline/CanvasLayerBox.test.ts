import { describe, expect, it } from "vitest";
import { canvasLayerBox } from "./ZoomScale";

describe("canvasLayerBox", () => {
	it("is the identity at 1.0 and above: same box, no transform", () => {
		expect(canvasLayerBox(1397.5, 800, 1)).toEqual({ width: 1397.5, height: 800, transform: "" });
		expect(canvasLayerBox(1397.5, 800, 2)).toEqual({ width: 1397.5, height: 800, transform: "" });
		expect(canvasLayerBox(1397.5, 800, NaN)).toEqual({ width: 1397.5, height: 800, transform: "" });
		expect(canvasLayerBox(1397.5, 800, 0)).toEqual({ width: 1397.5, height: 800, transform: "" });
	});
	it("below 1.0 the box is the visual size and the transform stretches it back over the band", () => {
		const box = canvasLayerBox(13230, 10560, 0.1);
		expect(box.width).toBeCloseTo(1323, 9);
		expect(box.height).toBeCloseTo(1056, 9);
		// The stretch is exactly the inverse: box * (1/scale) covers the band.
		expect(box.transform).toBe(`scale(${1 / 0.1})`);
		expect(box.width * (1 / 0.1)).toBeCloseTo(13230, 6);
	});
	/**
	 * When the host is shrunk with CSS `zoom` instead of `transform: scale`,
	 * the element's css box is ALREADY measured by the compositor at the
	 * zoomed size: the band's layout box times the inherited zoom is the
	 * visual box, so the counter-scale would shrink the layer a second time.
	 * The canvas is plain: band-sized box, no element transform.
	 */
	it("on the zoom path the box is the plain band box and there is no transform", () => {
		const box = canvasLayerBox(13230, 10560, 0.1, true);
		expect(box).toEqual({ width: 13230, height: 10560, transform: "" });
		// 1.0 and above are already the plain box; the flag changes nothing.
		expect(canvasLayerBox(1397.5, 800, 1, true)).toEqual({ width: 1397.5, height: 800, transform: "" });
	});
	it("the fallback path is unchanged when the flag is off or absent", () => {
		const off = canvasLayerBox(13230, 10560, 0.1, false);
		expect(off.width).toBeCloseTo(1323, 9);
		expect(off.height).toBeCloseTo(1056, 9);
		expect(off.transform).toBe(`scale(${1 / 0.1})`);
		expect(canvasLayerBox(13230, 10560, 0.1)).toEqual(off);
	});
});
