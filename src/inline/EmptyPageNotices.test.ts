/**
 * Alan, hardware, testing on a page with no ink on it: "all of the tools
 * only work when there's ink on the page but no indication that it's not
 * working other than it's not working" - then: "should add a toast that
 * indicates tools aren't working cause there's no ink on the page".
 *
 * insert-space already carries this lesson (`InkOverlay.spaceDown`'s "no ink
 * below the line" Notice, fired once at pen-down when its id list comes back
 * empty). The eraser and the lasso are the same shape: both need EXISTING
 * ink to do anything, so a page with none guarantees the whole gesture finds
 * nothing, whichever way the pen moves. Pan does not belong here - it drags
 * the view and never touches the store, so it keeps working on a blank page
 * (see the pdf-side "pan drags the scroller and never inks" test) - and gets
 * no notice.
 *
 * Both directions are asserted for each tool, because a refusal that fires
 * on ink too would be a nag: the whole point of insert-space's placement (at
 * the gesture's own discovery, not at tool selection) is that picking up a
 * tool and then drawing is normal and must stay quiet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notices = vi.hoisted(() => ({ messages: [] as string[] }));
vi.mock("obsidian", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		Notice: class {
			constructor(message: string) {
				notices.messages.push(message);
			}
		},
	};
});

import { InkOverlayPlugin, inlineInk, setEraserWholeStrokes } from "./InkOverlay";
import { StrokeIndex } from "../ink/StrokeIndex";
import { onInkChanged } from "./InkEvents";
import { inkChangeRearmsNotice } from "./EmptyPageNotice";
import { resetTipModeForTest, setTipMode } from "./TipMode";
import { SelectionModel } from "../objects/SelectionModel";
import { InkStroke } from "../ink/Stroke";
import type { InlineInkHost } from "./InlineInkStore";

function stroke(id: string): InkStroke {
	return {
		id,
		tool: "pen",
		color: "#000000",
		width: 2,
		points: [
			{ x: 10, y: 10, pressure: 0.5, t: 0 },
			{ x: 20, y: 20, pressure: 0.5, t: 8 },
		],
		bbox: { x: 8, y: 8, width: 16, height: 16 },
		createdAt: 0,
	};
}

/** A rig driving the real `penDown`, stopping short of the real eraser hit test. */
function makeEraseRig(path: string) {
	const view = Object.create(InkOverlayPlugin.prototype) as Record<string, unknown>;
	const eraseAt = vi.fn();

	view.mode = "ink";
	view.scale = 1;
	view.erased = [];
	view.eraseFrom = [];
	view.eraseWhole = true;
	view.penCursorEl = null;
	view.router = null;
	view.mobileTools = null;
	// focusClaimedPenEditor's whole contract: already focused, nothing to do.
	view.view = { hasFocus: true, focus: () => undefined };
	view.frame = { locked: false, begin: () => undefined, end: () => undefined, cancel: () => undefined };
	view.camera = { screenToWorld: (x: number, y: number) => ({ x, y }) };
	view.selection = new SelectionModel();

	// Own properties, so the prototype's versions never run: each of these
	// reaches the editor, the strip or the canvas, none of which is the
	// subject - the subject is the erase branch's own new check.
	view.syncCamera = () => undefined;
	view.captureProbeGeometry = () => undefined;
	view.recordPenDownState = () => undefined;
	view.redrawSelectionUI = () => undefined;
	view.filePath = () => path;
	view.startFrameTicker = () => undefined;
	view.showEraserCursor = () => undefined;
	view.eraseAt = eraseAt;
	// The real one reaches `ensureLoaded` and `runDetached`. What matters
	// here is only WHETHER the refusal goes and reads instead of speaking.
	const loadInk = vi.fn();
	view.loadInk = loadInk;
	// Nothing to set up for the notice gate: it is a prototype getter that
	// builds itself on first use, precisely so a rig like this one - which
	// runs no field initialisers - still gets the real thing. The spam fix
	// IS the gate, so a fake here would test nothing.

	const proto = InkOverlayPlugin.prototype as unknown as {
		penDown(this: unknown, sample: unknown, ev: unknown): void;
	};
	return {
		view,
		penDown() {
			const sample = { x: 50, y: 50, pressure: 0.5, timestamp: 0, tiltX: 0, tiltY: 0 };
			const ev = { buttons: 1, button: 0, clientX: 50, clientY: 50 };
			proto.penDown.call(view, sample, ev);
		},
		eraseAt,
		loadInk,
		/**
		 * What an INTERRUPTED gesture runs: `strokeAbandoned` (window blur,
		 * alt-tab, a system dialog mid-scrub) is `resetGestureState` plus
		 * chrome and layer clears, none of which touch the notice gate.
		 *
		 * The extra fields are the ones this method reads and the erase rig
		 * above has no reason to carry; the two cursor hiders reach the real
		 * editor DOM, which no rig in this file has.
		 */
		abandonGesture() {
			view.erasePieces = new Set();
			view.selectionDeleteKeys = { reset: () => undefined };
			view.hidePenCursor = () => undefined;
			view.hideEraserCursor = () => undefined;
			(
				InkOverlayPlugin.prototype as unknown as {
					resetGestureState(this: unknown): void;
				}
			).resetGestureState.call(view);
		},
		/** What a note switch runs beside it, and an abandon does not. */
		switchNotes() {
			(view.emptyNotice as { forgetAll(): void }).forgetAll();
		},
	};
}

/** A rig driving the real `lassoDown`, forced onto the fresh-loop path. */
function makeLassoRig(path: string) {
	const view = Object.create(InkOverlayPlugin.prototype) as Record<string, unknown>;

	view.scale = 1;
	view.camera = { screenToWorld: (x: number, y: number) => ({ x, y }) };
	view.selection = new SelectionModel();
	// No live selection to grab, whatever `strokesHere()` answers: forces the
	// "start a fresh loop" branch, which is where the new check lives.
	view.selectionBounds = () => null;
	view.showLassoCursor = () => undefined;
	view.redrawSelectionUI = () => undefined;
	view.filePath = () => path;
	view.lassoActive = false;
	view.lassoPts = [];
	view.loadInk = vi.fn();

	const proto = InkOverlayPlugin.prototype as unknown as {
		lassoDown(this: unknown, sample: unknown): void;
	};
	return {
		lassoDown() {
			proto.lassoDown.call(view, { x: 50, y: 50, pressure: 0.5, timestamp: 0, tiltX: 0, tiltY: 0 });
		},
	};
}

describe("empty-page notices on the note surface", () => {
	beforeEach(() => {
		resetTipModeForTest();
		notices.messages = [];
	});
	afterEach(() => resetTipModeForTest());

	it("eraser on an empty note says so and never reaches the hit test", () => {
		setTipMode("eraser");
		const rig = makeEraseRig("empty-erase.md");

		rig.penDown();

		expect(notices.messages).toEqual(["Handwriting: no ink on the page to erase"]);
		// The gesture still proceeds - only the warning is new - so the real
		// hit test still runs and finds nothing on its own, the same as today.
		expect(rig.eraseAt).toHaveBeenCalledTimes(1);
	});

	it("a gesture abandoned mid-scrub does not make the refusal news again", () => {
		// Alt-tab away mid-scrub and come back: same note, same tool, same
		// answer. `resetGestureState` used to end with `forgetAll()`, and
		// `strokeAbandoned` runs it - so a blur re-armed the toast that the
		// gate exists to say only once. `EmptyPageNotice.ts`'s header lists
		// what makes the sentence news again; an interrupted gesture is not
		// on the list.
		setTipMode("eraser");
		const rig = makeEraseRig("blurred-erase.md");

		rig.penDown();
		expect(notices.messages).toEqual(["Handwriting: no ink on the page to erase"]);

		rig.abandonGesture();
		rig.penDown();

		expect(notices.messages).toEqual(["Handwriting: no ink on the page to erase"]);
	});

	it("a note switch still makes it news again", () => {
		// The other half: what moved out of `resetGestureState` still runs
		// where a genuinely fresh screen goes up.
		setTipMode("eraser");
		const rig = makeEraseRig("switched-erase.md");

		rig.penDown();
		rig.switchNotes();
		rig.penDown();

		expect(notices.messages).toEqual([
			"Handwriting: no ink on the page to erase",
			"Handwriting: no ink on the page to erase",
		]);
	});

	it("eraser on a note that already has ink stays quiet", () => {
		setTipMode("eraser");
		const path = "has-ink-erase.md";
		inlineInk.commit(path, stroke("s1"));
		const rig = makeEraseRig(path);

		rig.penDown();

		expect(notices.messages).toEqual([]);
	});

	it("lasso on an empty note says so and starts a fresh loop", () => {
		setTipMode("lasso");
		const rig = makeLassoRig("empty-lasso.md");

		rig.lassoDown();

		expect(notices.messages).toEqual(["Handwriting: no ink on the page to select"]);
	});

	it("lasso on a note that already has ink stays quiet, even before the loop closes", () => {
		setTipMode("lasso");
		const path = "has-ink-lasso.md";
		inlineInk.commit(path, stroke("s1"));
		const rig = makeLassoRig(path);

		rig.lassoDown();

		expect(notices.messages).toEqual([]);
	});

	/**
	 * Alan, hardware, 1.4.12, on `vault test 2`: "holding ctrl and touching
	 * eraser end to screen spams toast notification - there is no ink on the
	 * note to erase, even though there is".
	 *
	 * The notice above was correct to exist and correct to fire at the
	 * gesture's own discovery. What it got wrong was assuming a gesture is a
	 * contact. An eraser is scrubbed, and the router's own pen-down branch
	 * says what that means: "Eraser scrubbing lifts and re-lands the nib
	 * every few hundred ms". Each re-land is a fresh pointerdown, a fresh
	 * penDown, and used to be a fresh toast - so one piece of news arrived
	 * twenty times, each copy running its own timeout.
	 *
	 * Ctrl is not read by any code on this path (`penContactIntent` takes
	 * buttons, button and the strip mode, and nothing else); it is simply
	 * what the other hand was holding. The scrub is the whole mechanism, so
	 * that is what these drive.
	 */
	it("an eraser scrub says it once, not once per contact", () => {
		setTipMode("eraser");
		const rig = makeEraseRig("scrubbed.md");

		for (let i = 0; i < 20; i++) rig.penDown();

		expect(notices.messages).toEqual(["Handwriting: no ink on the page to erase"]);
		// The gesture itself is untouched - only the talking is rationed.
		expect(rig.eraseAt).toHaveBeenCalledTimes(20);
	});

	it("a lasso repeated on the same empty note says it once too", () => {
		setTipMode("lasso");
		const rig = makeLassoRig("scrubbed-lasso.md");

		rig.lassoDown();
		rig.lassoDown();
		rig.lassoDown();

		expect(notices.messages).toEqual(["Handwriting: no ink on the page to select"]);
	});

	it("silence is per note, not a global mute", () => {
		setTipMode("eraser");
		const a = makeEraseRig("scrub-a.md");
		const b = makeEraseRig("scrub-b.md");

		a.penDown();
		a.penDown();
		b.penDown();

		// Two notes, two refusals - not four, and not one. The gate's own
		// path keying is pinned directly in EmptyPageNotice.test.ts; what
		// this adds is that a second surface is not silenced by the first.
		expect(notices.messages).toEqual([
			"Handwriting: no ink on the page to erase",
			"Handwriting: no ink on the page to erase",
		]);
	});
});

describe("successful final erase handles the empty-page episode", () => {
	beforeEach(() => {
		resetTipModeForTest();
		setTipMode("eraser");
		notices.messages = [];
	});
	afterEach(() => {
		resetTipModeForTest();
		setEraserWholeStrokes(true);
	});

	it.each([[true, true], [false, true], [true, false], [false, false]])(
		"handles a final erase but not a miss, whole=%s hit=%s", (whole, hit) => {
		const path = `final-erase-${whole}-${hit}.md`;
		const ink = stroke("final");
		const at = hit ? 50 : 500;
		ink.points = ink.points.map((p) => ({ ...p, x: at, y: at }));
		ink.bbox = { x: at - 1, y: at - 1, width: 2, height: 2 };
		inlineInk.commit(path, ink);
		setEraserWholeStrokes(whole);
		const rig = makeEraseRig(path);
		const view = rig.view;
		delete view.eraseAt;
		view.erasePieces = new Set<string>();
		view.strokeIndex = new StrokeIndex();
		view.indexDirty = true;
		view.damage = { addRect: () => undefined };
		view.scheduleRepaint = () => undefined;
		view.stopFrameTicker = () => undefined;
		view.hideEraserCursor = () => undefined;
		view.frontierCache = { invalidate: () => undefined };
		view.view = { hasFocus: true, dispatch: vi.fn() };
		const changed: string[] = [];
		const off = onInkChanged((p) => {
			if (p !== path) return;
			changed.push(inlineInk.inkPresence(p));
			if (inkChangeRearmsNotice(inlineInk.inkPresence(p))) {
				(view.emptyNotice as { forget(path: string): void }).forget(p);
			}
		});
		const up = () => (InkOverlayPlugin.prototype as unknown as {
			penUp(this: unknown): void;
		}).penUp.call(view);
		try {
			rig.penDown();
			if (!hit) {
				expect(inlineInk.strokes(path)).toEqual([ink]);
				up();
				expect(changed).toEqual([]);
				inlineInk.takeLive(path, [ink.id]);
				inlineInk.save(path);
				rig.penDown(); up();
				expect(notices.messages).toEqual(["Handwriting: no ink on the page to erase"]);
				return;
			}
			expect(inlineInk.strokes(path)).toEqual([]);
			up();
			expect(changed).toEqual(["none"]);
			for (let i = 0; i < 3; i++) { rig.penDown(); up(); }
			expect(notices.messages).toEqual([]);
			// The erase episode does not consume the independent lasso warning.
			(InkOverlayPlugin.prototype as unknown as {
				sayIfPageEmpty(this: unknown, path: string, kind: string): void;
			}).sayIfPageEmpty.call(view, path, "select");
			expect(notices.messages).toEqual(["Handwriting: no ink on the page to select"]);
			// New ink re-arms; losing it elsewhere earns a fresh warning.
			inlineInk.commit(path, ink);
			inlineInk.takeLive(path, [ink.id]);
			inlineInk.save(path);
			rig.penDown(); up();
			expect(notices.messages.at(-1)).toBe("Handwriting: no ink on the page to erase");
		} finally { off(); }
	});
});

/**
 * The "even though there is" half.
 *
 * `inlineInk.strokes(path)` is a CACHE of the sidecar, filled by an async
 * `ensureLoaded`. On a note whose sidecar has not been read yet it is empty
 * for a note that is covered in ink - which is exactly the state a pane in a
 * synced vault is in for the first moments after it opens, and exactly the
 * sentence Alan called wrong. The refusal now requires certainty
 * (`InlineInkStore.inkPresence`), and answers "not looked up yet" by going
 * and looking.
 *
 * The host attached here answers `null` for every path but the one under
 * test, which is the same "certainly empty" verdict the hostless describes
 * above rely on - so it cannot change what they assert if the file is ever
 * reordered.
 */
describe("the refusal never speaks about a note the store has not read", () => {
	const UNREAD = "unread-but-inked.md";

	class Host implements InlineInkHost {
		readPageId(path: string): string | null {
			return path === UNREAD ? "page-1" : null;
		}
		async claimId(_path: string, proposedId: string): Promise<{ pageId: string }> {
			return { pageId: proposedId };
		}
		async loadSidecar(): Promise<null> {
			return null;
		}
		scheduleSidecar(): void {}
		notify(): void {}
	}

	beforeEach(() => {
		resetTipModeForTest();
		notices.messages = [];
		inlineInk.attachHost(new Host());
	});
	afterEach(() => resetTipModeForTest());

	it("stays quiet and goes and reads instead", () => {
		setTipMode("eraser");
		const rig = makeEraseRig(UNREAD);

		rig.penDown();

		expect(notices.messages).toEqual([]);
		expect(rig.loadInk).toHaveBeenCalledWith(UNREAD);
	});

	it("and still refuses on a note that is certainly empty", () => {
		// No page id means no sidecar can exist, so this one IS certain -
		// the fix must not have bought silence by going mute everywhere.
		setTipMode("eraser");
		const rig = makeEraseRig("certainly-empty.md");

		rig.penDown();

		expect(notices.messages).toEqual(["Handwriting: no ink on the page to erase"]);
		expect(rig.loadInk).not.toHaveBeenCalled();
	});
});
