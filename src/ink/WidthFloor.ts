/**
 * Committed-ink width floor: never thinner than one device pixel on screen,
 * never thicker than the stroke draws at 100%.
 *
 * `hw` is a half-width in WORLD units (the same unit RibbonPt.hw carries).
 * `backing` is the exact multiplier the committed canvas context was set
 * with (InkOverlay.backingNow(), the value passed to setTransform) - never
 * re-derived here from pinch scale or cssScale. `dpr` is device px per CSS
 * px at 100%, as that same setTransform call received it.
 *
 * At `backing === dpr` (100% zoom) this is the identity for every hw: the
 * stroke already draws at least one device pixel wide there, so the floor
 * never engages. Below 100%, `backing` shrinks below `dpr` and the floor
 * pulls `hw` up just enough that the FINAL on-screen width (which the
 * committed canvas's own `backing`-scaled transform divides back down by)
 * lands at exactly one device pixel, never more.
 */
export function flooredHalfWidth(hw: number, backing: number, dpr: number): number {
	if (
		!Number.isFinite(hw) ||
		!Number.isFinite(backing) ||
		!Number.isFinite(dpr) ||
		hw <= 0 ||
		backing <= 0 ||
		dpr <= 0
	) {
		return hw;
	}
	return Math.max(hw, Math.min(0.5, hw * dpr) / backing);
}
