import type { PenStyle } from "./PenStyle";

/**
 * A width policy stored with a stroke when its rendering must not depend on
 * pressure, velocity, or endpoint shaping. Absence is the legacy ink law.
 */
export type StrokeWidthMode = "uniform";

export interface StrokeWidthPolicy {
	style: PenStyle;
	/** Whether the velocity/taper pipeline may shape this stroke's width. */
	shapeWidth: boolean;
}

/**
 * Resolve the one per-stroke width decision shared by wet ink, committed ink,
 * and export geometry. Uniform ink keeps the caller's selected base width and
 * colour while making every pressure factor exactly one and bypassing width
 * shaping. Centerline smoothing is deliberately a separate decision.
 */
export function strokeWidthPolicy(
	style: PenStyle,
	widthMode?: StrokeWidthMode
): StrokeWidthPolicy {
	if (widthMode !== "uniform") return { style, shapeWidth: true };
	return {
		style: {
			...style,
			minWidthFactor: 1,
			gamma: 1,
			maxWidthFactor: 1,
			pressureOffWidthFactor: 1,
		},
		shapeWidth: false,
	};
}
