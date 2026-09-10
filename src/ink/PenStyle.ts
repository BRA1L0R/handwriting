/**
 * Pen appearance (handoff §12). Deliberately simple.
 */

export interface PenStyle {
	color: string;
	/** Base stroke width in world units. */
	baseWidth: number;
	/** Fraction of baseWidth drawn at zero pressure (floor). */
	minWidthFactor: number;
	/** Pressure gamma: effective = pow(pressure, gamma). */
	gamma: number;
	/** Upper width factor at full pressure. */
	maxWidthFactor: number;
	/** Historical width factor when pressure sensitivity is disabled. */
	pressureOffWidthFactor: number;
}

export const DEFAULT_PEN: PenStyle = {
	color: "#2f6de0",
	baseWidth: 2.2,
	minWidthFactor: 0.18,
	gamma: 1.15,
	maxWidthFactor: 3.2,
	// The width Alan SELECTED, not a point on the ON curve.
	//
	// He picked the displayed 0.32 -> 2.19 row and called it "same as the
	// hardest press", so pressure-off ink is the width he chose rather than
	// whatever the current ON law happens to yield at some sample pressure.
	// The number is .18 + (3.2 - .18) * .32^1.15, the ON law evaluated once at
	// his selection and then FROZEN here: it is a fixed selected factor, so a
	// later change to the ON curve's min, gamma or ceiling must not move it.
	// At the 2.2 base that is 2.188058154088379 on screen.
	//
	// It replaces 0.7364923123758843, the shipped OFF pen at NO_PRESSURE under
	// the pre-exp7 curve, which was a point on a law rather than a choice.
	pressureOffWidthFactor: 0.9945718882219903,
};

/**
 * Highlighter (§51, §57). Wide and nearly flat: a chisel tip does not taper
 * the way a nib does, so pressure barely moves the width.
 *
 * The translucency is deliberately NOT in this colour. It lives on the layer,
 * as CSS opacity, and the ink itself is drawn opaque. Translucent ink would
 * double-blend everywhere a stroke crosses itself or another highlight, giving
 * muddy dark seams, the one thing a highlighter must not do. One opaque layer
 * at one alpha gives a flat, even wash no matter how much overlaps.
 */
export const HIGHLIGHTER_PEN: PenStyle = {
	color: "#ffd60a",
	baseWidth: 16,
	minWidthFactor: 0.9,
	gamma: 1,
	maxWidthFactor: 1,
	pressureOffWidthFactor: 0.95,
};

/**
 * The shape fields of a PenStyle that a stroke's tool alone decides:
 * DEFAULT_PEN's for pen/eraser strokes, HIGHLIGHTER_PEN's for the flat wash.
 * StrokeRenderer.drawStroke and StrokeOutline.ribbonOf both call this rather
 * than each restating the four numbers, so a tuning change to either pen
 * moves both the screen and every export in one place.
 */
export function shapeFor(
	flat: boolean
): Pick<
	PenStyle,
	"minWidthFactor" | "gamma" | "maxWidthFactor" | "pressureOffWidthFactor"
> {
	const pen = flat ? HIGHLIGHTER_PEN : DEFAULT_PEN;
	return {
		minWidthFactor: pen.minWidthFactor,
		gamma: pen.gamma,
		maxWidthFactor: pen.maxWidthFactor,
		pressureOffWidthFactor: pen.pressureOffWidthFactor,
	};
}

/** Layer opacity for highlighter ink. */
export const HIGHLIGHTER_ALPHA = 0.35;

/** What a device that reports no pressure sends, normalized upstream. */
export const NO_PRESSURE = 0.5;

/**
 * Pressure sensitivity, off for anyone who wants an even line.
 *
 * Each style carries its historical OFF width. That keeps existing ink at the
 * width users already saw while the ON curve can change independently. Speed
 * thinning stays active; InkShape preserves the historical geometric endpoint
 * taper while OFF. Every stroke is styled at render time, so flipping this
 * restyles ink that was written years ago.
 */
let pressureSensitive = true;

export function setPressureSensitivity(on: boolean): void {
	pressureSensitive = on;
}

export function pressureSensitivityEnabled(): boolean {
	return pressureSensitive;
}

/**
 * Width in world units for a given pressure sample.
 * Devices that report no pressure send 0.5 (normalized upstream).
 */
export function widthForPressure(style: PenStyle, pressure: number): number {
	if (!pressureSensitive) return style.baseWidth * style.pressureOffWidthFactor;
	const p = Math.min(1, Math.max(0, pressure));
	const effective = Math.pow(p, style.gamma);
	const factor =
		style.minWidthFactor + (style.maxWidthFactor - style.minWidthFactor) * effective;
	return style.baseWidth * factor;
}
