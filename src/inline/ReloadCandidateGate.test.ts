import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { InlinePenRouter } from "./InlinePenRouter";
import { InkOverlayPlugin, inlineReloadCandidates, captureInlineReloadAdmission, setInlineInkEnabled } from "./InkOverlay";

// Reduced DOM fixture, real overlay binding/quiet predicate and registry.
// Explicitly attach a stable container; unmounted overlays are ineligible.
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
	const info = path === null ? undefined : { file: { path }, editor: {} };
	const view = {
		dom: {
			isConnected: true,
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
		state: { field: () => info },
	};
	const overlay = new InkOverlayPlugin(view as never) as unknown as Record<string, unknown>;
	overlay.container = { isConnected: true, remove: noop };
	(overlay as unknown as {invalidateReloadBindings(path:string|null):void}).invalidateReloadBindings(path);
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

	it("requires every attached pane on the same note to be quiet", () => {
		expect(inlineReloadCandidates(), "no overlay leaked in from an earlier case").toEqual([]);

		const idle = makeOverlay(PATH);
		idle.builder = null;
		idle.mode = "ink";
		const drawing = makeOverlay(PATH);
		drawing.builder = LIVE_STROKE;
		drawing.mode = "ink";

		expect(inlineReloadCandidates()).toEqual([]);
		drawing.builder = null;
		expect(inlineReloadCandidates()).toEqual([PATH]);
	});
});


describe("fresh binding qualification", () => {
 it("holds a retained selection after pen-up until dismissal", () => {
  const pane = makeOverlay(PATH);
  expect(gate(pane)).toBe(PATH);
  (pane.selection as {selectExactly(ids:string[]):void}).selectExactly(["selected"]);
  expect(gate(pane)).toBeNull();
  (pane.selection as {clear():void}).clear();
  expect(gate(pane)).toBe(PATH);
 });
 it.each(["pinchRefScale", "pinchPending", "pinchPreview", "pinchRaf", "reloadCameraSettlement"])("holds %s through settlement", field => {
  const pane=makeOverlay(PATH), before=pane[field];
  expect(gate(pane)).toBe(PATH);pane[field]=1;expect(gate(pane)).toBeNull();
  pane[field]=before;expect(gate(pane)).toBe(PATH);
 });
 it("excludes detached and unbound overlays", () => {
  const pane=makeOverlay(PATH);expect(gate(pane)).toBe(PATH);
  (pane.container as {isConnected:boolean}).isConnected=false;
  expect(inlineReloadCandidates()).toEqual([]);
  expect(captureInlineReloadAdmission(PATH)).toBeNull();
 });
 it.each(["busy", "join", "retire", "attachment", "epoch", "file", "editor"])("requalifies %s after capture", change => {
  const pane=makeOverlay(PATH);const admit=captureInlineReloadAdmission(PATH)!;
  expect(admit()).toBe(true);
  if(change==="busy")pane.builder=LIVE_STROKE;
  if(change==="join")makeOverlay(PATH);
  if(change==="retire")(pane.container as {isConnected:boolean}).isConnected=false;
  if(change==="attachment")pane.container={isConnected:true,remove:noop};
  if(change==="epoch")pane.reloadBindingEpoch=(pane.reloadBindingEpoch as number)+1;
  if(change==="file" || change==="editor"){
   const view=pane.view as {state:{field():any}};view.state.field()[change]={path:PATH};
  }
  expect(admit()).toBe(false);
 });
});


describe("attachment lifetime and navigation qualification", () => {
 it("a sibling joining and retiring during an await invalidates the earlier cohort", () => {
  makeOverlay(PATH); const old=captureInlineReloadAdmission(PATH)!;expect(old()).toBe(true);
  const transient=makeOverlay(PATH);(transient as unknown as Gate).destroy();
  live.splice(live.indexOf(transient as unknown as Gate),1);
  expect(old()).toBe(false);expect(captureInlineReloadAdmission(PATH)!()).toBe(true);
 });
 it("unrelated attachment lifetimes do not veto this path", () => {
  makeOverlay(PATH);const old=captureInlineReloadAdmission(PATH)!;
  makeOverlay(OTHER);expect(old()).toBe(true);
 });
 it.each(["guardTouches","pinchLive","assistPointerId","flingRaf","activePenId"])("holds the router's %s lifetime", field => {
  const pane=makeOverlay(PATH);
  const router=Object.assign(Object.create(InlinePenRouter.prototype),{
   guardTouches:new Set(),pinchLive:false,assistPointerId:null,flingRaf:0,activePenId:null,dispose:noop,
  });pane.router=router;
  expect(gate(pane)).toBe(PATH);const before=router[field];
  router[field]=field==="guardTouches"?new Set([1]):1;
  expect(gate(pane)).toBeNull();router[field]=before;expect(gate(pane)).toBe(PATH);
 });
 it("hover and swallowed palms alone do not create a navigation hold", () => {
  const pane=makeOverlay(PATH);
  pane.router=Object.assign(Object.create(InlinePenRouter.prototype),{
   guardTouches:new Set(),pinchLive:false,assistPointerId:null,flingRaf:0,activePenId:null,
   swallowedTouches:new Set([1]),penHoverLive:true,dispose:noop,
  });
  expect(gate(pane)).toBe(PATH);
 });
});
