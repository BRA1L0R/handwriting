/**
 * The reload poll's gate: which editors are quiet enough that another device's
 * ink may replace what is on their screen.
 *
 * `reloadCandidatePath` (InkOverlay.ts) is four lines and, until this file,
 * was executed by nothing. The live-reload suites stub `inlineReloadCandidates`
 * wholesale - `LiveReloadTestHarness.ts` lists it among the names it
 * substitutes - so the real predicate was never driven, and its own suites were
 * green either way. It decides whether a remote revision may overwrite ink the
 * user can see, which is the same shape as the worst defect on this board.
 *
 * THE REFUSALS ARE THE POINT. An acceptance that should have been a refusal is
 * another device overwriting a stroke in progress; a refusal that should have
 * been an acceptance is a reload arriving one poll later. Only the first is
 * damage, so every rule here is driven from BOTH sides within its own case:
 * the quiet reading is asserted first, then exactly one field is changed and
 * the refusal asserted. Without that pairing a case would pass against a gate
 * that refused everything.
 *
 * DRIVEN FOR REAL, NOT STUBBED. The overlay is constructed the way this repo's
 * other overlay suites construct it (`new InkOverlayPlugin(view as never)` with
 * a stub CodeMirror view), and `filePath()` is left alone so the third branch
 * runs the real CodeMirror field read rather than an override. `state.field`
 * returning `undefined` is how a view with no file is expressed, which is the
 * honest source of the null path rather than a stubbed method.
 *
 * Every overlay built here registers itself in the module's `instances` set in
 * its constructor, so each case destroys what it made; `inlineReloadCandidates`
 * reads that set and a leaked overlay would silently join a later case's answer.
 * The aggregator cases assert an empty set before they build anything.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { InkOverlayPlugin, inlineReloadCandidates, setInlineInkEnabled } from "./InkOverlay";

/**
 * The constructor mounts unless the module's enable flag is off, and mounting
 * reaches for Obsidian's injected DOM helpers (`scroller.createDiv`) that a node
 * run has no reason to build. An unmounted overlay is the honest fixture rather
 * than a workaround: the gate reads three fields and never touches mounted
 * chrome, the constructor registers the instance in `instances` either way, and
 * an overlay that is registered but not mounted is a state production really
 * reaches - `setInlineInkEnabled(false)` puts every live overlay in exactly it.
 */
beforeAll(() => setInlineInkEnabled(false));

const noop = (): void => {};

function fakeRect(x: number, y: number, width: number, height: number): DOMRect {
	return {
		x,
		y,
		width,
		height,
		top: y,
		left: x,
		right: x + width,
		bottom: y + height,
		toJSON: () => ({}),
	} as DOMRect;
}

interface Gate {
	reloadCandidatePath(): string | null;
	destroy(): void;
}

const live: Gate[] = [];
afterEach(() => {
	while (live.length > 0) live.pop()!.destroy();
});

/**
 * `path` of `null` means a view whose editor-info field is absent - a real
 * state (a view not backed by a file), and the one the gate's third branch
 * answers `null` for.
 */
function makeOverlay(path: string | null): Record<string, unknown> {
	const win = {
		setTimeout: () => 1,
		clearTimeout: noop,
		getComputedStyle: () => ({ position: "relative", fontSize: "16px" }),
		cancelAnimationFrame: noop,
		requestAnimationFrame: () => 1,
		devicePixelRatio: 1,
		matchMedia: () => ({ addEventListener: noop, removeEventListener: noop }),
	};
	const view = {
		dom: {
			parentElement: { setCssStyles: noop },
			ownerDocument: { defaultView: win },
			style: { removeProperty: noop },
			setCssStyles: noop,
		},
		hasFocus: true,
		focus: noop,
		documentTop: 0,
		scaleX: 1,
		scaleY: 1,
		contentDOM: {
			getBoundingClientRect: () => fakeRect(0, 0, 800, 2000),
			querySelector: () => null,
			querySelectorAll: () => [],
			children: [],
			firstElementChild: null,
		},
		scrollDOM: {
			addEventListener: noop,
			removeEventListener: noop,
			classList: { add: noop, remove: noop },
			setCssStyles: noop,
			style: { removeProperty: noop },
			scrollLeft: 0,
			scrollTop: 0,
			scrollWidth: 800,
			scrollHeight: 2000,
			clientWidth: 800,
			clientHeight: 600,
		},
		// The real `filePath()` reads this. Left to run rather than overridden,
		// so the branch that returns the path is the shipped one.
		state: { field: () => (path === null ? undefined : { file: { path } }) },
	};
	const overlay = new InkOverlayPlugin(view as never) as unknown as Record<string, unknown>;
	live.push(overlay as unknown as Gate);
	return overlay;
}

/** Anything non-null stands for a stroke in progress; the gate only tests for null. */
const LIVE_STROKE = {} as never;

const PATH = "notes/quiet.md";
const OTHER = "notes/other.md";

function gate(overlay: Record<string, unknown>): string | null {
	return (overlay as unknown as Gate).reloadCandidatePath();
}

describe("the reload gate offers a path only when the editor is quiet", () => {
	it("offers this editor's path when no stroke is live and the mode is ink", () => {
		const overlay = makeOverlay(PATH);
		overlay.builder = null;
		overlay.mode = "ink";

		expect(gate(overlay)).toBe(PATH);
	});

	it("refuses while a stroke is being built, and that is the only thing changed", () => {
		const overlay = makeOverlay(PATH);
		overlay.builder = null;
		overlay.mode = "ink";
		// The paired reading: this is what the same overlay answers when quiet.
		// Without it, a gate that refused everything would pass this case.
		expect(gate(overlay)).toBe(PATH);

		overlay.builder = LIVE_STROKE;

		expect(gate(overlay)).toBeNull();
	});

	it("refuses in every mode that is not ink", () => {
		for (const mode of ["erase", "lasso", "space", "pan"]) {
			const overlay = makeOverlay(PATH);
			overlay.builder = null;
			overlay.mode = "ink";
			expect(gate(overlay), `paired quiet reading for ${mode}`).toBe(PATH);

			overlay.mode = mode;

			expect(gate(overlay), `mode ${mode} must not be a reload candidate`).toBeNull();
		}
	});

	it("offers nothing when the view has no file, with both other rules satisfied", () => {
		const overlay = makeOverlay(null);
		overlay.builder = null;
		overlay.mode = "ink";

		// Not a refusal by the gate's two conditions - both are satisfied. This
		// is the third branch: there is no path to offer.
		expect(gate(overlay)).toBeNull();
	});

	it("refuses when a stroke is live AND the mode is not ink", () => {
		const overlay = makeOverlay(PATH);
		overlay.builder = LIVE_STROKE;
		overlay.mode = "lasso";

		expect(gate(overlay)).toBeNull();
	});
});

describe("the aggregator collects the quiet editors", () => {
	it("lists the quiet editor and omits the one mid-stroke", () => {
		expect(inlineReloadCandidates(), "no overlay leaked in from an earlier case").toEqual([]);

		const quiet = makeOverlay(PATH);
		quiet.builder = null;
		quiet.mode = "ink";
		const busy = makeOverlay(OTHER);
		busy.builder = LIVE_STROKE;
		busy.mode = "ink";

		expect(inlineReloadCandidates()).toEqual([PATH]);
	});

	it("de-duplicates two quiet editors showing one note", () => {
		expect(inlineReloadCandidates(), "no overlay leaked in from an earlier case").toEqual([]);

		for (const _ of [0, 1]) {
			const overlay = makeOverlay(PATH);
			overlay.builder = null;
			overlay.mode = "ink";
		}

		expect(inlineReloadCandidates()).toEqual([PATH]);
	});

	/**
	 * CHARACTERISATION, AND A FINDING RATHER THAN A GUARANTEE. The aggregator
	 * is a UNION of quiet paths; it does not subtract a path some other pane is
	 * drawing on. With one note open in two panes, one idle and one mid-stroke,
	 * the note is still offered as a reload candidate - and `inkExternallyReloaded`
	 * then reaches EVERY overlay showing that path, clearing the selection and
	 * scheduling a repaint on the pane whose stroke is in progress.
	 *
	 * This pins what the code does today, not what it should do. If the rule is
	 * changed so a busy pane vetoes its note, this case is the one that must be
	 * updated, and its going red is the intended signal.
	 */
	it("does NOT let a pane mid-stroke veto another pane on the same note", () => {
		expect(inlineReloadCandidates(), "no overlay leaked in from an earlier case").toEqual([]);

		const idle = makeOverlay(PATH);
		idle.builder = null;
		idle.mode = "ink";
		const drawing = makeOverlay(PATH);
		drawing.builder = LIVE_STROKE;
		drawing.mode = "ink";

		expect(inlineReloadCandidates()).toEqual([PATH]);
	});
});
