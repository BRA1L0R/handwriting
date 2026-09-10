import { EXP7_PEN, type PenStyle } from "./PenStyle";

export type PressureProfile = "exp7";

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
	widthMode?: StrokeWidthMode,
	pressureProfile?: PressureProfile
): StrokeWidthPolicy {
	if (widthMode !== "uniform") {
		if (pressureProfile !== "exp7") return { style, shapeWidth: true };
		return {
			style: { ...style, minWidthFactor: EXP7_PEN.minWidthFactor, gamma: EXP7_PEN.gamma,
				maxWidthFactor: EXP7_PEN.maxWidthFactor,
				pressureOffWidthFactor: EXP7_PEN.pressureOffWidthFactor, pressureProfile },
			shapeWidth: true,
		};
	}
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
