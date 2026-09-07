/**
 * The eraser end as the FIRST pen contact on a page whose ink was already
 * there - and what it takes to make that contact find nothing.
 *
 * REPORT (Alan, hardware, store 1.4.11): brand new vault, a note with ink on
 * the page, eraser end as the first pen contact of the session. An eraser
 * reticle appeared, NOTHING was erased, and NO toast was shown. One stroke
 * with the pen TIP, no reload, and the eraser end worked from then on.
 *
 * On 1.4.11 an empty `eraseFrom` raised `new Notice("Handwriting: no ink on
 * the page to erase")` unconditionally (that tag's `penDown`, erase branch),
 * so "no toast" says the store held ink and `eraseAt` ran and found nothing.
 *
 * The first test here is the reproduction attempt for exactly that, driven
 * through the REAL `penDown` on an overlay that has never painted a stroke,
 * with every field the erase path reads left at its class-field default (the
 * overlay is CONSTRUCTED, not `Object.create`d, and `mount()` takes its "not a
 * file-backed editor" exit - so `indexDirty`, `strokeIndex`, `camera`, `scale`
 * and `damage` are whatever the class says they are, not whatever a rig
 * decided). IT ERASES. The cold page is not, on its own, the defect.
 *
 * The second and third tests are what that leaves. `eraseCandidates` rebuilds
 * `strokeIndex` only when `indexDirty` is set and then clears the flag, so a
 * rebuild that runs while the store is EMPTY caches "this page has no ink" -
 * and the flag is the only thing that can take that answer back. Test two
 * drives that state through the real `penDown` twice and shows the symptom
 * exactly: reticle up, store untouched, nothing said. Test three shows why it
 * is not the reported sequence - the sidecar read's own completion calls
 * `scheduleRepaint()`, which sets `indexDirty` again, so the shipped load path
 * heals it before a second contact can see it.
 *
 * WHAT THE SESSION COULD NOT REACH, and it is written here rather than lost:
 * no route was found that leaves `indexDirty` false at a FIRST-of-session
 * eraser contact. The only two consumers that clear it are `eraseCandidates`
 * itself and `repaint`'s partial branch, and the partial branch needs
 * `damage.take()` to return a non-empty RECT LIST - which needs
 * `damage.addRect`, whose only three call sites in `InkOverlay.ts` are inside
 * `eraseAt`, the lasso drag and insert-space. All three are gestures. A
 * session whose first pen contact is the eraser has run none of them, so its
 * first `eraseCandidates` rebuilds over the live store.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InkOverlayPlugin, inlineInk, releaseTipModes } from "./InkOverlay";
import { InkStroke } from "../ink/Stroke";
import { DEFAULT_PEN } from "../ink/PenStyle";
import type { PenSample } from "../input/PointerRouter";

const PATH = "cold-page.md";
/** Where the ink is, and where the eraser lands on it. */
const AT = { x: 120, y: 90 };

/** A stroke as the sidecar hands it over: bbox already computed, id stable. */
function sidecarStroke(id: string, at: { x: number; y: number }): InkStroke {
	return {
		id,
		tool: "pen",
		color: DEFAULT_PEN.color,
		width: DEFAULT_PEN.baseWidth,
		points: [
			{ x: at.x, y: at.y, pressure: 0.5, t: 0 },
			{ x: at.x + 10, y: at.y, pressure: 0.5, t: 8 },
		],
		bbox: { x: at.x, y: at.y, width: 10, height: 0 },
		createdAt: 0,
	};
}

function sample(x: number, y: number): PenSample {
	return { x, y, pressure: 0.5, timestamp: 0, tiltX: 0, tiltY: 0 };
}

/**
 * A pen-down from the ERASER END. Both halves of what `penContactIntent`
 * accepts are set, the way a digitizer reports the turned-over pen: `buttons`
 * bit 32 held, and `button` 5 on the transition that reports it.
 */
function eraserDown(x: number, y: number): PointerEvent {
	return {
		clientX: x,
		clientY: y,
		buttons: 32,
		button: 5,
		pointerType: "pen",
	} as unknown as PointerEvent;
}

interface Proto {
	penDown(this: unknown, s: PenSample, ev: PointerEvent): void;
}

const proto = InkOverlayPlugin.prototype as unknown as Proto;

interface Rig {
	overlay: Record<string, unknown>;
	/** What `showEraserCursor` wrote: the reticle is the evidence the branch ran. */
	eraserStyle: Record<string, unknown>;
	destroy(): void;
}

const noop = (): void => undefined;

function fakeRect(left: number, top: number, width: number, height: number): DOMRect {
	return {
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
	} as DOMRect;
}

/**
 * A REAL overlay: `new`, not `Object.create`, so every class-field initialiser
 * runs and nothing about the erase path's state is chosen by this file.
 * `view.state.field` answers `undefined`, which is `mount()`'s own "not a
 * file-backed editor" exit, so the constructor stays cheap and no canvas is
 * wanted - the same idiom `GestureReticlePersists.test.ts`'s `liveOverlay`
 * uses. Only the DOM seams `penDown` reaches are supplied afterwards.
 *
 * Zero origins throughout: the container's rect, the content rect and
 * `documentTop` are all 0, so `syncCamera` pins the camera at the origin and a
 * sample at (x, y) is the world point (x, y). That is the ordinary case, not a
 * special one - a displaced camera would displace the PAINT by the same amount
 * (both go through this one `Camera`), which is why a camera error cannot make
 * the eraser miss ink the user can see.
 */
function makeRig(): Rig {
	const eraserStyle: Record<string, unknown> = { display: "none" };
	const win = {
		setTimeout: () => 1,
		clearTimeout: noop,
		getComputedStyle: () => ({ position: "relative", fontSize: "16px" }),
		cancelAnimationFrame: noop,
		// Swallowed: the committed repaint wants canvases this fixture has no
		// reason to build, and nothing under test is decided on a later frame.
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
		state: { field: () => undefined },
	};

	const overlay = new InkOverlayPlugin(view as never) as unknown as Record<string, unknown>;
	overlay.container = {
		getBoundingClientRect: () => fakeRect(0, 0, 800, 600),
		offsetWidth: 800,
		offsetHeight: 600,
		remove: noop,
	};
	overlay.eraserEl = {
		setAttribute: noop,
		setCssStyles: (s: Record<string, unknown>) => Object.assign(eraserStyle, s),
	};
	// Own properties, so the prototype's versions never run: `filePath` reads a
	// CodeMirror field, and `penCursorEl` belongs to the hover reticle, which
	// is not what an eraser contact paints.
	overlay.penCursorEl = null;
	overlay.filePath = (): string => PATH;

	return {
		overlay,
		eraserStyle,
		destroy: () => (overlay as unknown as { destroy(): void }).destroy(),
	};
}

function idsInStore(): string[] {
	return inlineInk.strokes(PATH).map((s) => s.id);
}

/** One eraser contact at `at`, through the real pen-down. */
function eraserContact(rig: Rig, at: { x: number; y: number }): void {
	proto.penDown.call(rig.overlay, sample(at.x, at.y), eraserDown(at.x, at.y));
}

describe("the eraser end, on a page this overlay has never drawn on", () => {
	beforeEach(() => {
		releaseTipModes();
		// Session-memory mode (no host): nothing persists, and the note's ink
		// is exactly what each test puts there.
		inlineInk.applyRemove(PATH, idsInStore());
	});

	afterEach(() => {
		releaseTipModes();
	});

	it("erases ink the store already held, with no stroke drawn this session", () => {
		inlineInk.applyAdd(PATH, [sidecarStroke("sidecar", AT)]);
		const rig = makeRig();
		try {
			eraserContact(rig, AT);

			// The branch really ran: the reticle is up and the gesture is an
			// erase. Without these the assertion below could pass for a
			// contact that was never recognised as an eraser at all.
			expect(rig.eraserStyle.display, "no reticle: the eraser branch never ran").toBe("block");
			expect(rig.overlay.mode).toBe("erase");
			expect(idsInStore(), "the cold page did not erase").toEqual([]);
		} finally {
			rig.destroy();
		}
	});

	it("goes blind when its first contact lands before the page's ink does", () => {
		// The first contact happens while the store is still empty - the shape
		// of a sidecar read that has not landed. `eraseCandidates` rebuilds
		// over nothing and CLEARS `indexDirty`, so the index now answers "this
		// page has no ink" and has no reason to ask again.
		const rig = makeRig();
		try {
			eraserContact(rig, AT);
			expect(rig.eraserStyle.display).toBe("block");
			expect(
				rig.overlay.indexDirty,
				"precondition: the empty rebuild is what leaves the flag down"
			).toBe(false);

			// The ink arrives. `adoptSidecar` splices it straight into the
			// record and fires no ink-changed event, which is what `applyAdd`
			// models here: the store is now non-empty and this overlay's index
			// has heard nothing.
			inlineInk.applyAdd(PATH, [sidecarStroke("sidecar", AT)]);

			eraserContact(rig, AT);

			// The reported symptom, exactly: the reticle is up, the gesture is
			// an erase, the store holds the ink the eraser is sitting on, and
			// nothing was taken. No toast either - `eraseFrom` is non-empty, so
			// the empty-page refusal is never even consulted.
			expect(rig.eraserStyle.display).toBe("block");
			expect((rig.overlay.eraseFrom as InkStroke[]).map((s) => s.id)).toEqual(["sidecar"]);
			expect(idsInStore(), "the stale index let the eraser through").toEqual(["sidecar"]);
		} finally {
			rig.destroy();
		}
	});

	it("and the load's own repaint request is what takes that answer back", () => {
		// Why the test above is not the shipped sequence: `loadInk`'s
		// completion calls `scheduleRepaint()` with the default via, and that
		// sets `indexDirty`. One contact later the index is rebuilt over the
		// ink that arrived and the eraser works again - which is also what a
		// pen-tip commit does (the store callback in `handoffFinishedStroke`
		// sets the same flag), and so what Alan's tip stroke would have done.
		const rig = makeRig();
		try {
			eraserContact(rig, AT);
			inlineInk.applyAdd(PATH, [sidecarStroke("sidecar", AT)]);
			expect(idsInStore()).toEqual(["sidecar"]);

			(rig.overlay as unknown as { scheduleRepaint(via?: string): void }).scheduleRepaint();
			expect(rig.overlay.indexDirty, "the load's repaint did not dirty the index").toBe(true);

			eraserContact(rig, AT);

			expect(idsInStore(), "a re-dirtied index still could not find the ink").toEqual([]);
		} finally {
			rig.destroy();
		}
	});
});
