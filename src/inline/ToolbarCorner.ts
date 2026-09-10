/**
 * Which anchor the floating pen strip parks at.
 *
 * Top-right is the default and was the only option: the writing palm owns
 * the bottom of the glass, so a bottom corner is the one place a right-handed
 * writer's hand lands. It is still the right default, and still a bad default
 * for somebody left-handed, working on a wide monitor, or with a sidebar
 * where the strip used to sit. So it becomes a choice rather than a verdict.
 *
 * NINE ANCHORS: the six values shipped in 1.4.12 remain byte-for-byte intact,
 * and a middle row completes the 3x3 grid. The existing values are in saved
 * data.json files, so renaming one would move that user's toolbar on upgrade.
 * Adding values is deliberately one-way compatible: an older build may
 * normalise a new value to the default, but this build never rewrites an old
 * placement merely because the grid grew.
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
	| "middle-right"
	| "middle-left"
	| "middle-center"
	| "bottom-right"
	| "bottom-left"
	| "bottom-center";

export type ToolbarAnchorRow = "top" | "middle" | "bottom";
export type ToolbarAnchorColumn = "left" | "center" | "right";

export interface ToolbarAnchorPosition {
	row: ToolbarAnchorRow;
	column: ToolbarAnchorColumn;
}

/**
 * The name the UI uses now. The TYPE keeps its old name so that every import
 * across the plugin stays put; what Alan sees is "placement", and this alias
 * is how the two vocabularies meet without a rename that would touch a dozen
 * files for no behaviour.
 */
export type ToolbarPlacement = ToolbarCorner;

/**
 * Grouped by row, with the historical/default right-first ordering retained
 * within each one. That keeps the six old entries in their familiar groups
 * while making the new middle band read as one unit in the dropdown.
 */
export const TOOLBAR_CORNERS: readonly ToolbarCorner[] = [
	"top-right",
	"top-left",
	"top-center",
	"middle-right",
	"middle-left",
	"middle-center",
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
	{ value: "middle-right", label: "Middle right" },
	{ value: "middle-left", label: "Middle left" },
	{ value: "middle-center", label: "Middle center" },
	{ value: "bottom-right", label: "Bottom right" },
	{ value: "bottom-left", label: "Bottom left" },
	{ value: "bottom-center", label: "Bottom middle" },
];

/**
 * Explicit geometry for every persisted value.
 *
 * Do not infer either axis with string fragments. Once the middle row exists,
 * "middle" names a ROW while "center" names a COLUMN; a two-way string test
 * silently aliases one of those concepts to the other.
 */
const TOOLBAR_ANCHOR_POSITIONS = {
	"top-right": { row: "top", column: "right" },
	"top-left": { row: "top", column: "left" },
	"top-center": { row: "top", column: "center" },
	"middle-right": { row: "middle", column: "right" },
	"middle-left": { row: "middle", column: "left" },
	"middle-center": { row: "middle", column: "center" },
	"bottom-right": { row: "bottom", column: "right" },
	"bottom-left": { row: "bottom", column: "left" },
	"bottom-center": { row: "bottom", column: "center" },
} as const satisfies Readonly<Record<ToolbarCorner, ToolbarAnchorPosition>>;

export function toolbarAnchorRow(corner: ToolbarCorner): ToolbarAnchorRow {
	return TOOLBAR_ANCHOR_POSITIONS[corner].row;
}

export function toolbarAnchorColumn(corner: ToolbarCorner): ToolbarAnchorColumn {
	return TOOLBAR_ANCHOR_POSITIONS[corner].column;
}

/** Does this anchor occupy the centre COLUMN of the 3x3 grid? */
export function isCenterColumnAnchor(corner: ToolbarCorner): boolean {
	return toolbarAnchorColumn(corner) === "center";
}

/**
 * Historical name retained for StripClearance and downstream imports.
 * "Middle" here still means centre COLUMN, exactly as it did in 1.4.12; new
 * code should use the unambiguous row/column helpers above.
 */
export function isMiddleAnchor(corner: ToolbarCorner): boolean {
	return isCenterColumnAnchor(corner);
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
 * A side column reads horizontally, including the new middle row. A top or
 * bottom centre-column anchor reads vertically. The exact centre shrinks in
 * place and therefore gets a neutral minus rather than an invented direction.
 */
export function collapseChevronIcon(corner: ToolbarCorner): string {
	const column = toolbarAnchorColumn(corner);
	if (column === "left") return "chevron-left";
	if (column === "right") return "chevron-right";
	const row = toolbarAnchorRow(corner);
	return row === "top" ? "chevron-up" : row === "bottom" ? "chevron-down" : "minus";
}

/** The glyph fallback, for a build whose icon font failed to resolve. */
export function collapseChevronGlyph(corner: ToolbarCorner): string {
	const column = toolbarAnchorColumn(corner);
	if (column === "left") return "<";
	if (column === "right") return ">";
	const row = toolbarAnchorRow(corner);
	return row === "top" ? "^" : row === "bottom" ? "v" : "−";
}

/** The class that positions the strip and the pill. One per corner. */
export function toolbarCornerClass(corner: ToolbarCorner): string {
	return `handwriting-corner-${corner}`;
}

/** Every class this module can apply, so a change can remove the others. */
export function allToolbarCornerClasses(): string[] {
	return TOOLBAR_CORNERS.map(toolbarCornerClass);
}
