/** A retained camera origin in an unchanged layout/raster basis. */
export interface CameraOriginY {
	y: number;
	basis: readonly unknown[];
}

/** Rect subtraction can wobble as two elements scroll through fractional
 * screen coordinates. Bound the additional displacement in both displayed
 * CSS pixels and backing pixels, independent of distance from the origin.
 * Compare against the retained value so small real changes cannot accumulate
 * unnoticed. Callers keep exact camera/raster comparisons after this decision.
 */
export function stableCameraOriginY(
	raw: number, prior: CameraOriginY | null | undefined, basis: readonly unknown[],
	cssScale: number, fontZoom: number, backing: number,
): number {
	if (!prior || ![raw, prior.y, cssScale, fontZoom, backing].every(Number.isFinite) ||
		cssScale <= 0 || fontZoom <= 0 || backing <= 0 ||
		prior.basis.length !== basis.length || prior.basis.some((value, i) => value !== basis[i])) return raw;
	const delta = Math.abs(raw - prior.y) * fontZoom;
	return delta * cssScale <= 1 / 1024 && delta * backing <= 1 / 64 ? prior.y : raw;
}
