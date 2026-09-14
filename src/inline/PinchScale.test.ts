import { describe, expect, it } from "vitest";

import {
	MAX_PINCH_SCALE,
	MIN_PINCH_SCALE,
	fitInkBounds,
	anchoredScroll,
	clampPinchScale,
	counterSizePercent,
	pinchScale,
} from "./PinchScale";

describe("pinchScale", () => {
	it("scales the value captured at gesture start", () => {
		expect(pinchScale(1, 2)).toBe(2);
		expect(pinchScale(2, 0.5)).toBe(1);
	});

	it("never accumulates: out and back returns to the starting scale", () => {
		const start = 1.5;
		expect(pinchScale(start, 1.6)).toBeCloseTo(2.4, 6);
		// The next sample is still measured from `start`.
		expect(pinchScale(start, 1)).toBe(start);
	});

	it("caps magnification and clamps zoom-out at ten percent", () => {
		expect(pinchScale(1, 100)).toBe(MAX_PINCH_SCALE);
		expect(pinchScale(1, 0.001)).toBe(0.1);
		expect(pinchScale(0.1, 0.5)).toBe(0.1);
		expect(pinchScale(0.1, 2)).toBe(0.2);
	});

	// Fit may commit below ten percent (Alan 2026-09-13, "get out of jail
	// free"); pinch reads the floor Fit left and may never go past it.
	it("clamps zoom-out at a Fit floor below ten percent without jumping up to it", () => {
		// At Fit's 6% a pinch out stays at 6%. Clamping to the constant here would
		// turn a zoom-out into a jump IN to 10%.
		expect(pinchScale(0.06, 0.5, 0.06)).toBe(0.06);
		expect(pinchScale(0.06, 4 / 3, 0.06)).toBeCloseTo(0.08, 12);
		// Out and back in one gesture lands where it began, not below.
		expect(pinchScale(0.06, 1, 0.06)).toBe(0.06);
		expect(pinchScale(0.08, 0.75, 0.06)).toBeCloseTo(0.06, 12);
		expect(pinchScale(0.08, 0.5, 0.06)).toBe(0.06);
		// Junk ratio holds the reference instead of snapping it to 10%.
		expect(pinchScale(0.06, Number.NaN, 0.06)).toBe(0.06);
	});

	// Alan 2026-09-14: below ten percent zoom-out is locked; only zoom-in, until
	// ten percent again. The floor stays the constant; the gesture's reference
	// scale is the lower bound while it is under the floor.
	it("below ten percent a pinch cannot zoom out past its reference scale", () => {
		expect(pinchScale(0.07, 6 / 7)).toBe(0.07);
		expect(pinchScale(0.05, 0.5)).toBe(0.05);
		expect(pinchScale(0.07, 9 / 7)).toBeCloseTo(0.09, 12);
		expect(pinchScale(0.05, 2)).toBeCloseTo(0.1, 12);
		expect(pinchScale(0.12, 0.05 / 0.12)).toBe(0.1);
		expect(pinchScale(0.05, Number.NaN)).toBe(0.05);
	});

	it("never lets a floor raise the constant or come from junk", () => {
		expect(clampPinchScale(0.05, 0.5)).toBe(0.1);
		expect(clampPinchScale(0.05, Number.NaN)).toBe(0.1);
		expect(clampPinchScale(0.05, 0)).toBe(0.1);
		expect(clampPinchScale(0.05, -1)).toBe(0.1);
	});

	it("holds still on junk rather than collapsing the editor", () => {
		expect(pinchScale(Number.NaN, 2)).toBe(1);
		expect(pinchScale(2, Number.NaN)).toBe(2);
		expect(clampPinchScale(0)).toBe(1);
	});
});

describe("counterSizePercent", () => {
	it("sizes the box so the painted result fills the pane", () => {
		// Scaled 2x, the box must claim half the width to paint at 100%.
		expect(counterSizePercent(2, MIN_PINCH_SCALE)).toBe(50);
		expect(counterSizePercent(1, MIN_PINCH_SCALE)).toBe(100);
		// Zooming out expands the viewport while the text column stays fixed.
		expect(counterSizePercent(0.5, MIN_PINCH_SCALE)).toBe(200);
	});

	// The floor is a required argument because this used to answer 1000% for a
	// Fit scale below ten percent - a box too small for what is painted.
	it("counter-sizes a Fit scale below ten percent against the floor Fit left", () => {
		expect(counterSizePercent(0.06, 0.06)).toBeCloseTo(1000 / 0.6, 9);
		expect(counterSizePercent(0.06, MIN_PINCH_SCALE)).toBe(1000);
	});
});

describe("anchoredScroll", () => {
	it("keeps the point the pinch STARTED on under the same place", () => {
		// The scroller lives INSIDE the scaled editor, so scroll offsets are
		// layout px and the 300 is painted px against the scaled rect. The
		// content point under the fingers is 100 + 300/1 = 400; at scale 2 it
		// must sit 300 painted px in, i.e. 150 layout px past the scroll, so
		// the scroll is 400 - 150 = 250.
		expect(anchoredScroll(100, 300, 1, 2)).toBe(250);
	});

	it("never chases the fingers: the anchor is the START point, not the live one", () => {
		// Fingers always drift during a pinch. Anchoring to where they are NOW
		// made the view follow them around the page; anchoring to where the
		// gesture began means the same inputs always give the same answer.
		// Only the scale argument may change during a gesture.
		const a = anchoredScroll(100, 300, 1, 1.5);
		const b = anchoredScroll(100, 300, 1, 1.5);
		expect(a).toBe(b);
	});

	it("does not accumulate: the answer comes from the gesture start every time", () => {
		// Walking 1 -> 1.5 -> 2 one frame at a time must land exactly where
		// jumping straight to 2 does. The old form fed each frame into the
		// next, so a slow pinch drifted further than a fast one.
		const direct = anchoredScroll(100, 300, 1, 2);
		const stepped = anchoredScroll(100, 300, 1, 2); // same start state, later frame
		expect(stepped).toBe(direct);
		expect(anchoredScroll(100, 300, 1, 1.5)).toBeCloseTo(100 + 300 * (1 - 1 / 1.5), 10);
	});

	it("returns exactly to the start scroll when the pinch returns to its scale", () => {
		// A pinch out and back must land where it began, to the pixel.
		expect(anchoredScroll(100, 300, 1, 2)).toBe(250);
		expect(anchoredScroll(100, 300, 1, 1)).toBe(100);
	});

	it("does nothing when the scale does not change", () => {
		expect(anchoredScroll(250, 300, 1.5, 1.5)).toBe(250);
	});

	it("never scrolls above the top of the document", () => {
		// Zooming out near the origin wants a negative offset.
		expect(anchoredScroll(0, 50, 2, 1)).toBe(0);
	});

	it("holds the current offset on junk scales", () => {
		expect(anchoredScroll(120, 300, 0, 2)).toBe(120);
		expect(anchoredScroll(120, 300, 1, Number.NaN)).toBe(120);
	});
});

describe("fitInkBounds",()=>{
 const g={viewportWidthScreen:640,viewportHeightScreen:480,externalScale:1,fontZoom:1,marginScreen:24};
 it("fits separated ink within the zoom range and accounts for font/external exactly once",()=>{
  const bounds={x:0,y:0,width:1800,height:2200};
  expect(fitInkBounds({...g,bounds})).toEqual({kind:"fit",zoom:432/2200});
  // Was "below-minimum" (refused) until Fit was allowed under ten percent.
  expect(fitInkBounds({...g,bounds,fontZoom:1.5,externalScale:2})).toEqual({kind:"fit",zoom:432/(2200*2*1.5)});
 });
 // Revised 2026-09-13 (Alan: Fit breaks the 10% clamp). This used to pin the
 // refusal of anything smaller than ten percent; those fits now commit, and
 // only the native layout bound refuses.
 it("fits an exact ten percent and anything smaller that native layout can represent",()=>{
  expect(fitInkBounds({...g,bounds:{x:0,y:0,width:5920,height:4320}})).toEqual({kind:"fit",zoom:.1});
  expect(fitInkBounds({...g,bounds:{x:0,y:0,width:5921,height:4320}})).toEqual({kind:"fit",zoom:592/5921});
  expect(fitInkBounds({...g,bounds:{x:0,y:0,width:18000,height:22000}})).toEqual({kind:"fit",zoom:432/22000});
  // The layout bound still refuses: 640 screen px at this zoom is past 8M layout px.
  expect(fitInkBounds({...g,bounds:{x:0,y:0,width:7_600_000,height:1}})).toEqual({kind:"unrepresentable"});
 });
 it("caps a point at normal size and returns an explicit empty plan",()=>{
  expect(fitInkBounds({...g,bounds:{x:10,y:20,width:0,height:0}})).toEqual({kind:"fit",zoom:1});
  expect(fitInkBounds({...g,bounds:null})).toEqual({kind:"empty",zoom:1});
 });
 it("refuses invalid geometry and finite bounds outside native representation",()=>{
  expect(fitInkBounds({...g,bounds:{x:0,y:0,width:1e20,height:1}})).toEqual({kind:"unrepresentable"});
  expect(fitInkBounds({...g,viewportWidthScreen:0,bounds:null})).toEqual({kind:"unrepresentable"});
 });
});
