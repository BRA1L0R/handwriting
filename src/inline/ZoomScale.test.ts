/**
 * Zoom regression coverage.
 *
 * The bug: Obsidian zoom scaled the Markdown while ink stayed put, because
 * every geometry read is visual px (getBoundingClientRect / clientX) while ink
 * is stored and drawn in layout px, with no factor between them.
 *
 * The contract these tests pin down:
 *   - persisted note-space coordinates never change with zoom
 *   - screen→note→screen round-trips exactly at any scale
 *   - returning to the original zoom restores the original screen position
 *   - screen-defined sizes (eraser, grab pad, lasso step) keep their on-screen
 *     size, which means shrinking in note space as the editor grows
 *   - scale 1 is arithmetically identical to the pre-fix behaviour
 */

import { describe, expect, it } from "vitest";
import { clampInkSize, nextInkSize } from "../ink/InkSize";
import {
	backingScale,
	MAX_BACKING_AREA,
	MAX_ZOOM_BACKING,
	clampScale,
	effectiveScale,
	fontZoomFactor,
	noteToVisual,
	visualToNote,
} from "./ZoomScale";

describe("effectiveScale", () => {
	it("is 1 when layout and visual agree (no zoom, and Electron page zoom)", () => {
		// Page zoom scales both units identically, so the ratio stays 1 —
		// which is why this fix is a no-op there and cannot regress it.
		expect(effectiveScale({ visualWidth: 800, layoutWidth: 800 })).toBe(1);
	});

	it("detects a CSS zoom / transform scale from the element's own box", () => {
		expect(effectiveScale({ visualWidth: 880, layoutWidth: 800 })).toBeCloseTo(1.1, 10);
		expect(effectiveScale({ visualWidth: 600, layoutWidth: 800 })).toBeCloseTo(0.75, 10);
	});

	it("falls back to CodeMirror's scaleX when the element has no layout width", () => {
		expect(effectiveScale({ visualWidth: 0, layoutWidth: 0, cmScaleX: 1.25 })).toBe(1.25);
	});

	it("never returns a nonsense scale", () => {
		expect(effectiveScale({ visualWidth: 0, layoutWidth: 0 })).toBe(1);
		expect(effectiveScale({ visualWidth: NaN, layoutWidth: 800 })).toBe(1);
		expect(clampScale(0)).toBe(1);
		expect(clampScale(-2)).toBe(1);
		expect(clampScale(Infinity)).toBe(1);
		expect(clampScale(1000)).toBeLessThanOrEqual(20);
	});
});

describe("screen ↔ note conversion", () => {
	const scales = [0.5, 0.8, 1, 1.1, 1.25, 1.5, 2, 3];

	it("round-trips exactly at every scale", () => {
		for (const s of scales) {
			for (const d of [0, 1, 37.5, 200, 1024.75]) {
				expect(noteToVisual(visualToNote(d, s), s)).toBeCloseTo(d, 9);
			}
		}
	});

	it("is the identity at scale 1 (byte-compatible with the pre-fix path)", () => {
		for (const d of [0, 12, 137.25, 999]) {
			expect(visualToNote(d, 1)).toBe(d);
			expect(noteToVisual(d, 1)).toBe(d);
		}
	});

	it("zooming in shrinks screen distances in note space, and back", () => {
		const onScreen = 240;
		const atZoom2 = visualToNote(onScreen, 2);
		expect(atZoom2).toBe(120); // same pixels cover half the note
		// …and returning to 100% puts it back exactly where it was.
		expect(noteToVisual(visualToNote(onScreen, 1), 1)).toBe(onScreen);
	});
});

describe("persisted geometry is never rescaled", () => {
	it("a stroke's note coordinates are identical at every zoom level", () => {
		// A pen lands on the same physical spot on the note at three zooms.
		// The visual offset differs; the note-space coordinate must not.
		const noteX = 300;
		const noteY = 150;
		const camX = 40; // note-space origin offset, unchanged by zoom
		const camY = 90;
		for (const s of [1, 1.5, 2.5]) {
			// what the pointer would report at this zoom for that note point
			const visualX = noteToVisual(noteX - camX, s);
			const visualY = noteToVisual(noteY - camY, s);
			// what the router + camera turn it back into
			const gotX = visualToNote(visualX, s) + camX;
			const gotY = visualToNote(visualY, s) + camY;
			expect(gotX).toBeCloseTo(noteX, 9);
			expect(gotY).toBeCloseTo(noteY, 9);
		}
	});

	it("a zoom round-trip returns ink to the exact original screen position", () => {
		const stored = { x: 512.25, y: 288.5 }; // untouched by zoom, by definition
		const camOrigin = { x: 12, y: 34 };
		const at100 = {
			x: noteToVisual(stored.x - camOrigin.x, 1),
			y: noteToVisual(stored.y - camOrigin.y, 1),
		};
		// zoom in, zoom out — the stored data never moved, so the screen
		// position recomputes to precisely what it was.
		const back = {
			x: noteToVisual(stored.x - camOrigin.x, 1),
			y: noteToVisual(stored.y - camOrigin.y, 1),
		};
		expect(back).toEqual(at100);
	});
});

describe("screen-defined sizes keep their on-screen size", () => {
	it("the eraser radius covers less of the note as the editor grows", () => {
		const ERASER_SCREEN_R = 12;
		expect(visualToNote(ERASER_SCREEN_R, 1)).toBe(12);
		expect(visualToNote(ERASER_SCREEN_R, 2)).toBe(6);
		expect(visualToNote(ERASER_SCREEN_R, 0.5)).toBe(24);
		// …which is exactly "12 physical px under the nib" at every zoom.
		for (const s of [0.5, 1, 2, 3]) {
			expect(noteToVisual(visualToNote(ERASER_SCREEN_R, s), s)).toBeCloseTo(12, 9);
		}
	});

	it("grab pad and lasso step follow the same rule", () => {
		for (const constant of [8, 2]) {
			for (const s of [1, 1.25, 2]) {
				expect(noteToVisual(visualToNote(constant, s), s)).toBeCloseTo(constant, 9);
			}
		}
	});
});

describe("canvas backing store", () => {
	it("adds the scale so ink rasterises 1:1 instead of being upscaled", () => {
		expect(backingScale(2, 1)).toBe(2);
		expect(backingScale(2, 1.5)).toBe(3);
		expect(backingScale(1, 2)).toBe(2);
	});

	it("survives a bogus devicePixelRatio", () => {
		expect(backingScale(0, 1)).toBe(1);
		expect(backingScale(NaN, 1)).toBe(1);
	});
});

describe("fontZoomFactor — quick-font-size zoom (v0.13.0)", () => {
	it("is 1 at the reference size", () => {
		expect(fontZoomFactor(30, 30)).toBe(1);
	});

	it("scales linearly with the font ratio", () => {
		expect(fontZoomFactor(45, 30)).toBeCloseTo(1.5);
		expect(fontZoomFactor(15, 30)).toBeCloseTo(0.5);
	});

	it("round-trips exactly — ratio of absolutes, no accumulation", () => {
		let f = fontZoomFactor(30, 30);
		f = fontZoomFactor(60, 30);
		f = fontZoomFactor(30, 30);
		expect(f).toBe(1);
	});

	it("degrades to 1 on nonsense inputs", () => {
		expect(fontZoomFactor(0, 30)).toBe(1);
		expect(fontZoomFactor(30, 0)).toBe(1);
		expect(fontZoomFactor(Number.NaN, 30)).toBe(1);
	});
});

describe("ink size helpers (v0.13.6)", () => {
	it("clamps nonsense to sane multipliers", () => {
		expect(clampInkSize(Number.NaN)).toBe(1);
		expect(clampInkSize(0)).toBe(1);
		expect(clampInkSize(100)).toBe(4);
		expect(clampInkSize(0.01)).toBe(0.25);
		expect(clampInkSize(1.8)).toBe(1.8);
	});

	it("cycles fine → medium → bold → fine", () => {
		expect(nextInkSize(0.6).name).toBe("medium");
		expect(nextInkSize(1).name).toBe("bold");
		expect(nextInkSize(1.8).name).toBe("fine");
	});

	it("an off-scale current value cycles back onto the scale", () => {
		expect(nextInkSize(2.7).name).toBe("fine");
	});
});

describe("backingScale — bounded so any canvas can still be allocated", () => {
	it("is unchanged for every unzoomed pane that FITS the budget", () => {
		// The cap must never cost resolution where the pixels are affordable.
		// Every case here is checked against the budget rather than asserted
		// from memory: `w * d * h * d` is what the pane would claim at full
		// device ratio, and each is under MAX_BACKING_AREA.
		for (const [d, w, h] of [
			[2, 1000, 800], // 3.2M
			[1, 1000, 800], // 0.8M
			[2, 1400, 900], // 5.0M - a retina desktop editor
			[2, 1180, 820], // 3.9M - an iPad in landscape
			[3, 1180, 820], // 8.7M - the same iPad at dpr 3, still affordable
		] as const) {
			expect(w * d * (h * d)).toBeLessThanOrEqual(MAX_BACKING_AREA);
			expect(backingScale(d, 1, w, h)).toBe(d);
		}
	});

	it("stops following the zoom past the cap", () => {
		// A 4x pinch on a dpr-2 tablet wanted 8x linear - 64x the pixels,
		// across five canvases. WebKit refuses that and blanks the canvas.
		expect(backingScale(2, 4, 100, 100)).toBe(2 * MAX_ZOOM_BACKING);
		expect(backingScale(2, 2.5, 100, 100)).toBe(2 * MAX_ZOOM_BACKING);
	});

	it("still tracks the zoom below the cap", () => {
		expect(backingScale(2, 1.5, 100, 100)).toBe(3);
	});

	it("TRIPWIRE: a DESKTOP pane over budget keeps its full device ratio", () => {
		// THIS IS A TRIPWIRE. It has been tripped once and rewritten once,
		// and the rewrite was the mistake.
		//
		// WHAT IT PROTECTS: an area budget that bounds the DEVICE ratio
		// quietly downgrades ordinary editors on high-dpi hardware. The floor
		// `d * min(1, scale)` went in with the budget for that exact reason,
		// and this guard went in to hold it there. 1.4.12 removed the floor
		// to keep a tall iPad band under WebKit's per-canvas ceiling; this
		// guard fired, correctly, and was rewritten instead of believed. What
		// that cost, measured: a 5K / Studio Display at 200% full width (a
		// 2540x1990 band at dpr 2) went from backing 2.000 to 1.407, -29.7%
		// of its linear ink resolution; a 6K XDR to 1.222, -38.9%; an
		// ordinary 4K desktop about -6%. And it bought nothing: Electron has
		// no equivalent of WebKit's silent per-canvas refusal, so those
		// pixels were surrendered against a ceiling that is not on the
		// machine.
		//
		// If a change makes this fail, that is a QUESTION, not a licence to
		// rewrite it. A bound that iOS needs goes behind the `mobile` flag.
		for (const [d, w, h] of [
			[3, 2000, 1400], // §14's own example, on a desktop
			[2, 2540, 1990], // 5K / Studio Display at 200%, full width
			[2, 3000, 2000], // a very large pane, over budget with no zoom
		] as const) {
			expect(w * d * (h * d)).toBeGreaterThan(MAX_BACKING_AREA); // premise
			expect(backingScale(d, 1, w, h)).toBe(d);
			// ...and magnification is the only thing the budget may take, so
			// zoomed it still comes back with every device pixel it has.
			expect(backingScale(d, 2, w, h)).toBe(d);
		}
	});

	it("on MOBILE the budget spends the device's resolution too", () => {
		// The other half of the case above, and the whole reason for the
		// flag. 2000x1400 at dpr 3 is 25.2M device px on ONE canvas, past
		// WebKit's ~16.7M per-canvas ceiling, unzoomed, with five canvases
		// behind it - and iOS answers that with a blank canvas and no error.
		const w = 2000;
		const h = 1400;
		expect(w * 3 * (h * 3)).toBeGreaterThan(MAX_BACKING_AREA); // premise
		const flat = backingScale(3, 1, w, h, true);
		expect(flat).toBeLessThan(3); // the device ratio IS spent here
		// Exactly the budget and nothing smaller - asserted as the area the
		// pane claims rather than by retyping `sqrt(MAX / (w * h))`, which
		// would be the production line copied and could not catch a wrong
		// formula.
		expect(w * flat * (h * flat)).toBeCloseTo(MAX_BACKING_AREA, 0);
		// Zoom cannot buy back what the budget already refused: a pane this
		// size lands on the same number magnified as it does flat.
		expect(backingScale(3, 2, w, h, true)).toBeCloseTo(flat, 10);
		// ...and the same pane on a desktop is untouched.
		expect(backingScale(3, 1, w, h)).toBe(3);
	});

	it("holds a zoomed pane inside the area budget", () => {
		const w = 1180; // an iPad pane, where the budget is the whole point
		const h = 820;
		const b = backingScale(2, 4, w, h);
		expect(w * b * (h * b)).toBeLessThanOrEqual(MAX_BACKING_AREA + 1);
		// ...while still spending more than unzoomed on the magnified ink.
		expect(b).toBeGreaterThan(2);
	});

	it("trims a MOBILE pane that is over budget with no zoom at all", () => {
		// A 3000x2000 pane at dpr 2 is 24M device px against a 10M budget
		// before any pinch. On mobile the budget is a real ceiling and takes
		// it down to fit; on desktop the floor hands the device ratio back
		// and only the zoom's share is ever spent.
		//
		// DELETED from here: `expect(b).toBeCloseTo(Math.sqrt(
		// MAX_BACKING_AREA / (w * h)), 10)`. That was the production line
		// retyped, mathematically the same statement as the area assertion
		// beside it, and an assertion that copies the line it tests cannot
		// catch a wrong formula.
		const w = 3000;
		const h = 2000;
		const b = backingScale(2, 2, w, h, true);
		expect(w * b * (h * b)).toBeCloseTo(MAX_BACKING_AREA, 0);
		expect(b).toBeLessThan(2);
		expect(backingScale(2, 2, w, h)).toBe(2); // desktop keeps its floor
	});

	it("the dpr-3 band that reaches WebKit's ceiling is bounded on MOBILE only", () => {
		// §14's example. A tall band at dpr 3 kept all three device pixels
		// per CSS px and asked for 11.3M on each of five canvases; on mobile
		// it now asks for the budget instead. Written as a comparison against
		// the OLD rule rather than a magic number, so dropping the mobile
		// bound fails here loudly.
		//
		// Worth stating plainly, because it is what the flag turns on: no
		// SHIPPING iPad reports dpr 3 - that is iPhone. At the dpr 2 every
		// iPad actually reports, a 1366x1350 landscape band is 1.84M CSS px
		// against this budget's 2.50M threshold (MAX_BACKING_AREA / dpr^2),
		// so it never reaches this branch and is identical on both platforms.
		const w = 1400;
		const h = 900;
		const oldFloor = 3 * Math.min(1, 1);
		const b = backingScale(3, 1, w, h, true);
		expect(b).toBeLessThan(oldFloor);
		expect(w * b * (h * b)).toBeCloseTo(MAX_BACKING_AREA, 0);
		// Desktop, same band, still answers the old rule exactly.
		expect(backingScale(3, 1, w, h)).toBe(oldFloor);
		// And the band a real iPad actually draws is under budget either way.
		expect(2 * 1366 * (2 * 1350)).toBeLessThan(MAX_BACKING_AREA); // premise
		expect(backingScale(2, 1, 1366, 1350, true)).toBe(2);
		expect(backingScale(2, 1, 1366, 1350)).toBe(2);
	});

	it("never returns zero or a NaN, whatever it is handed", () => {
		expect(backingScale(0, 1, 100, 100)).toBe(1);
		expect(backingScale(NaN, 1, 100, 100)).toBe(1);
		expect(backingScale(2, 1, Number.NaN, 100)).toBe(2);
		expect(backingScale(2, 1, 0, 0)).toBe(2);
	});
});
