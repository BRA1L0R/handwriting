import type { TipMode } from "./TipMode";

/** The flat pressure used when a touch digitizer reports no usable pressure. */
export const FINGER_INK_PRESSURE = 0.5;

export interface FingerInkState {
	isIosApp: boolean;
	isPhone: boolean;
	toolPicked: boolean;
	penInkEnabled: boolean;
	tipMode: TipMode;
	tool: string;
}

/**
 * Whether an ordinary-note touch is allowed to enter the ink pipeline.
 *
 * This is deliberately narrower than "touch device": finger ink is an
 * iPhone affordance, granted only after the reader explicitly picks a nib.
 * It does not consult mouse ink or any pen-seen latch, and therefore cannot
 * make a launch-default nib draw or pretend that a finger is pen hardware.
 */
export function fingerInkEligible(state: FingerInkState): boolean {
	return (
		state.isIosApp &&
		state.isPhone &&
		state.toolPicked &&
		state.penInkEnabled &&
		state.tipMode === "nib" &&
		(state.tool === "pen" || state.tool === "highlighter")
	);
}
