/**
 * Which corner the floating pen strip parks in.
 *
 * Top-right is the default and was the only option: the writing palm owns
 * the bottom of the glass, so a bottom corner is the one place a right-handed
 * writer's hand lands. It is still the right default, and still a bad default
 * for somebody left-handed, working on a wide monitor, or with a sidebar
 * where the strip used to sit. So it becomes a choice rather than a verdict.
 *
 * SIX ANCHORS SINCE 1.4.12, not four. Alan asked for the setting to be
 * called placement rather than corner, and for the two middles: "i guess we
 * can add it if you want, but corners was always fine before and top left is
 * missing in that case" - i.e. middles are an addition to the corners, never
 * a replacement, because a middles-only world loses the corner he uses. The
 * four original VALUES are untouched on purpose: they are in every existing
 * data.json, and renaming them would move every user's toolbar on upgrade.
 *
 * The strip and its collapsed pill share one anchor: they are the same
 * control in two sizes, and having them fly to opposite corners would be
 * absurd. Both get the same class.
 *
 * DOM-free by construction, like PenToolsMode - the placement is CSS, and
 * what this module owns is only the vocabulary and its normalization.
 */

export type ToolbarCorner =
	| "top-right"
	| "top-left"
	| "top-center"
	| "bottom-right"
	| "bottom-left"
	| "bottom-center";

/**
 * The name the UI uses now. The TYPE keeps its old name so that every import
 * across the plugin stays put; what Alan sees is "placement", and this alias
 * is how the two vocabularies meet without a rename that would touch a dozen
 * files for no behaviour.
 */
export type ToolbarPlacement = ToolbarCorner;

/**
 * Grouped by edge, defaults first within each. The two middles are appended
 * to their own edge rather than to the end of the list, so the dropdown reads
 * top, top, top, bottom, bottom, bottom instead of scattering them.
 */
export const TOOLBAR_CORNERS: readonly ToolbarCorner[] = [
	"top-right",
	"top-left",
	"top-center",
	"bottom-right",
	"bottom-left",
	"bottom-center",
];

export const DEFAULT_TOOLBAR_CORNER: ToolbarCorner = "top-right";

/** Human labels for the settings dropdown, in the order offered. */
export const TOOLBAR_CORNER_LABELS: ReadonlyArray<{ value: ToolbarCorner; label: string }> = [
	{ value: "top-right", label: "Top right" },
	{ value: "top-left", label: "Top left" },
	{ value: "top-center", label: "Top middle" },
	{ value: "bottom-right", label: "Bottom right" },
	{ value: "bottom-left", label: "Bottom left" },
	{ value: "bottom-center", label: "Bottom middle" },
];

/** Does this anchor sit on an edge's middle rather than in a corner? */
export function isMiddleAnchor(corner: ToolbarCorner): boolean {
	return corner.endsWith("-center");
}

/**
 * Anything off disk becomes a real corner. Settings files get hand-edited,
 * synced between versions, and truncated; an unknown value must not leave the
 * toolbar unpositioned, which CSS would render as "wherever it happens to
 * land" rather than as an error anyone could diagnose.
 */
export function normalizeToolbarCorner(raw: unknown): ToolbarCorner {
	return TOOLBAR_CORNERS.includes(raw as ToolbarCorner)
		? (raw as ToolbarCorner)
		: DEFAULT_TOOLBAR_CORNER;
}

/**
 * Which way the collapse chevron points: at the edge the strip collapses
 * INTO, so the button says where the strip is about to go rather than which
 * way it is about to move.
 *
 * A corner has two edges and the horizontal one is the one that reads - a
 * strip in the top right collapses rightwards into a circle, and the arrow
 * has always pointed that way. A MIDDLE has only one edge to go to, and it is
 * the vertical one: a top-middle strip collapses upward, a bottom-middle
 * strip downward. Pointing them left or right would name an edge the strip is
 * nowhere near.
 */
export function collapseChevronIcon(corner: ToolbarCorner): string {
	if (isMiddleAnchor(corner)) return corner.startsWith("top") ? "chevron-up" : "chevron-down";
	return corner.endsWith("left") ? "chevron-left" : "chevron-right";
}

/** The glyph fallback, for a build whose icon font failed to resolve. */
export function collapseChevronGlyph(corner: ToolbarCorner): string {
	if (isMiddleAnchor(corner)) return corner.startsWith("top") ? "^" : "v";
	return corner.endsWith("left") ? "<" : ">";
}

/** The class that positions the strip and the pill. One per corner. */
export function toolbarCornerClass(corner: ToolbarCorner): string {
	return `handwriting-corner-${corner}`;
}

/** Every class this module can apply, so a change can remove the others. */
export function allToolbarCornerClasses(): string[] {
	return TOOLBAR_CORNERS.map(toolbarCornerClass);
}
