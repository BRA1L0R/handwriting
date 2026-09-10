/**
 * DIAGNOSIS ONLY (eraser-mode-diagnosis, cut from 1.4.13 at f21dfb7).
 *
 * THE REPORT: "on 1.4.12 i cannot choose reticle eraser, it switches back to
 * stroke", refined by the owner to "reticle would highlight but behavior is
 * still stroke", and "it's still reticle after reload".
 *
 * Two candidate mechanisms, and this file exists to make BOTH execute rather
 * than be read:
 *
 *   A. THE CLICK PATH, in-session. The chip writes the module flag
 *      (`setEraserWholeStrokes`), and the chip's HIGHLIGHT is painted from
 *      that same flag through `host.eraserWholeStroke()`. The ERASE BEHAVIOUR
 *      does NOT read the flag: it reads `InkOverlayPlugin.eraseWhole`, a
 *      per-gesture COPY taken in the erase branch of `penDown`. If that copy
 *      were taken anywhere but at contact - at tool select, at mount, once -
 *      a chip click would move the highlight and leave the behaviour behind,
 *      which is the owner's sentence exactly. The two cases below drive the
 *      real `penDown` across a mid-session flip and read the copy.
 *
 *   B. THE PERSISTENCE PATH, across a restart. The chip's other half writes
 *      `settings.eraserMode`; a restart re-applies it through the ONE
 *      `setEraserWholeStrokes` call in `loadSettings`. The round trip below
 *      drives the real `persistSettings` and the real `loadSettings` over the
 *      bytes the first one wrote.
 *
 * Nothing here is a fix and nothing here is a source-text assertion: every
 * case calls the shipped method and reads the value the user would feel.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import HandwritingPlugin from "../main";
import {
	InkOverlayPlugin,
	getEraserWholeStrokes,
	releaseTipModes,
	setEraserWholeStrokes,
	setInlineEraserMode,
	setPersistEraserMode,
} from "./InkOverlay";
import { Camera } from "../camera/Camera";
import { SelectionModel } from "../objects/SelectionModel";
import { StrokeFrame } from "./StrokeFrame";
import type { PenSample } from "../input/PointerRouter";

const noop = (): void => undefined;

interface Proto {
	penDown(this: unknown, s: PenSample, ev: PointerEvent): void;
}
const overlayProto = InkOverlayPlugin.prototype as unknown as Proto;

function sample(x: number, y: number): PenSample {
	return { x, y, p: 0.5, t: 0 } as unknown as PenSample;
}

/** A bare tip landing. With the eraser MODE held, this is an erase contact. */
function tipDown(x: number, y: number): PointerEvent {
	return {
		clientX: x,
		clientY: y,
		buttons: 1,
		button: 0,
		pointerType: "pen",
		pointerId: 1,
		pressure: 0.5,
	} as unknown as PointerEvent;
}

/**
 * A real `InkOverlayPlugin` built with `Object.create` so `mount()` never
 * runs - the same rig `GestureReticlePersists.test.ts` and
 * `InlineEraseFresh.test.ts` use. Only the fields `penDown`'s erase branch
 * touches are supplied. `filePath` answers null, which is `eraseAt`'s own
 * first exit, so the contact reaches the copy under test and stops there:
 * what is being measured is WHICH VALUE the gesture takes, not what it then
 * deletes (that branch is `InlineEraseFresh.test.ts`'s).
 */
function makeOverlay(): Record<string, unknown> {
	const inst = Object.create(InkOverlayPlugin.prototype) as Record<string, unknown>;

	inst.mode = "ink";
	inst.camera = new Camera();
	inst.scale = 1;
	inst.cssScale = 1;
	inst.selection = new SelectionModel();
	inst.lassoPts = [];
	inst.lassoActive = false;
	inst.dragFrom = null;
	inst.dragTotal = null;
	inst.spaceLineY = null;
	inst.spaceIds = [];
	inst.spaceBounds = null;
	inst.spaceClient = null;
	inst.panLast = null;
	inst.spaceFromY = 0;
	inst.spaceTotalDy = 0;
	inst.mobileTools = null;
	inst.hoverWatchdog = null;
	inst.mouseStroke = false;
	inst.frame = new StrokeFrame();
	inst.erased = [];
	inst.erasePieces = new Set<string>();
	inst.eraseFrom = [];

	inst.penCursorEl = {
		setAttribute: noop,
		classList: { add: noop, remove: noop },
		setCssStyles: noop,
	};
	inst.view = {
		dom: { ownerDocument: { defaultView: { setTimeout: () => 1, clearTimeout: noop } } },
		hasFocus: true,
		focus: noop,
		scrollDOM: {
			classList: { add: noop, remove: noop },
			scrollLeft: 0,
			scrollTop: 0,
		},
	};
	inst.container = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
	inst.router = { refreshRect: noop, isStroking: false };

	// Own properties: everything the contact reaches that is not the subject.
	inst.ensurePenTools = noop;
	inst.syncCamera = noop;
	inst.recordPenDownState = noop;
	inst.redrawSelectionUI = noop;
	inst.updateExtent = noop;
	inst.sayIfPageEmpty = noop;
	inst.startFrameTicker = noop;
	inst.showEraserCursor = noop;
	inst.filePath = (): string | null => null;

	return inst;
}

/** One eraser contact through the real `penDown`. */
function eraserContact(inst: Record<string, unknown>): void {
	overlayProto.penDown.call(inst, sample(200, 200), tipDown(200, 200));
}

describe("LEG A - the eraser mode a chip click sets is the mode the next gesture erases with", () => {
	beforeEach(() => {
		releaseTipModes();
		setPersistEraserMode(null);
		setEraserWholeStrokes(true);
	});

	afterEach(() => {
		releaseTipModes();
		setPersistEraserMode(null);
		setEraserWholeStrokes(true);
		setInlineEraserMode(false);
	});

	it("a mid-session flip to reticle reaches the gesture that follows it", () => {
		// The strip's eraser tool is what the owner had in hand.
		setInlineEraserMode(true);
		const inst = makeOverlay();

		// Start where a fresh vault starts: whole-stroke.
		expect(getEraserWholeStrokes(), "the default is stroke").toBe(true);
		eraserContact(inst);
		expect(inst.mode, "the contact was not recognised as an erase").toBe("erase");
		expect(inst.eraseWhole, "a stroke-mode gesture erases whole strokes").toBe(true);

		// THE CHIP CLICK. MobileTools' Reticle chip runs
		// `host.setEraserWholeStroke(false)`; the note surface's host member
		// is two lines, `setEraserWholeStrokes(on)` then `persistEraserMode?.(on)`.
		// The closure itself is built inside the overlay's strip mount and
		// cannot be reached from here, so its FIRST line is driven directly
		// and its second - which only writes settings - is LEG B's subject.
		setEraserWholeStrokes(false);

		// What the CHIP now paints: `refresh()` reads `host.eraserWholeStroke()`,
		// which is this getter, and rings Reticle when it is false.
		expect(getEraserWholeStrokes(), "the chip would still ring Stroke").toBe(false);

		// What the NEXT GESTURE now does. This is the assertion the owner's
		// sentence is about: highlight reticle, behaviour stroke.
		eraserContact(inst);
		expect(
			inst.eraseWhole,
			"the chip says reticle and the gesture still erases whole strokes"
		).toBe(false);
	});

	it("an abandoned gesture's reset does not strand the next contact on the wrong mode", () => {
		// 469f200 made `resetGestureState` clear `eraseWhole` to false, which
		// is the RETICLE value - so if the copy were not retaken at contact, a
		// file switch or a window blur would silently turn a stroke-mode
		// eraser into a reticle one. Drive that: reticle gesture, reset, flip
		// back to stroke, contact again.
		setInlineEraserMode(true);
		const inst = makeOverlay();

		setEraserWholeStrokes(false);
		eraserContact(inst);
		expect(inst.eraseWhole).toBe(false);

		// The abandoned-gesture wipe, at the value 469f200 leaves behind.
		inst.eraseWhole = false;

		setEraserWholeStrokes(true);
		eraserContact(inst);
		expect(
			inst.eraseWhole,
			"a reset left the gesture on reticle after the chip said stroke"
		).toBe(true);
	});
});

/**
 * LEG B, the restart. Same harness the four `inkAdaptsToTheme` cases in
 * `src/SettingsUnknownKeys.test.ts` use: `Object.create` on the plugin
 * prototype, `loadData`/`saveData` stubbed, the real private methods called
 * through the prototype.
 */
const pluginProto = HandwritingPlugin.prototype as unknown as {
	loadSettings(this: unknown): Promise<void>;
	persistSettings(this: unknown): Promise<void>;
};

function ensureDocument(): void {
	const g = globalThis as unknown as { document?: unknown };
	g.document ??= {
		body: { classList: { add: () => {}, toggle: () => {}, contains: () => false } },
	};
}

function fakePlugin(raw: unknown): Record<string, unknown> {
	const plugin = Object.create(HandwritingPlugin.prototype) as Record<string, unknown>;
	plugin.loadData = (): Promise<unknown> => Promise.resolve(raw);
	plugin.saved = null;
	plugin.saveData = (data: Record<string, unknown>): Promise<void> => {
		plugin.saved = data;
		return Promise.resolve();
	};
	plugin.settingsTimer = null;
	plugin.settingsDirty = false;
	plugin.settingsWriting = null;
	plugin.settingsWriteAgain = false;
	plugin.store = { useInkFolder: () => {}, load: () => null, schedule: () => {} };
	plugin.pdfStore = { attachHost: () => {} };
	plugin.app = { workspace: { onLayoutReady: () => {} } };
	plugin.applyPaperTo = () => {};
	plugin.applyPaper = () => {};
	plugin.applyBooxMode = () => {};
	return plugin;
}

describe("LEG B - reticle survives a restart", () => {
	afterEach(() => {
		setEraserWholeStrokes(true);
	});

	it("the bytes a reticle choice writes load back as reticle, and re-apply the runtime flag", async () => {
		ensureDocument();

		// The chip's persist half, as main.ts registers it: settings.eraserMode
		// = on ? "stroke" : "reticle", then a save. Start from a loaded vault
		// so the object being saved is the one loadSettings builds.
		const first = fakePlugin({});
		await pluginProto.loadSettings.call(first);
		expect((first.settings as Record<string, unknown>).eraserMode).toBe("stroke");
		(first.settings as Record<string, unknown>).eraserMode = "reticle";
		await pluginProto.persistSettings.call(first);

		const bytes = first.saved as Record<string, unknown> | null;
		if (!bytes) throw new Error("persistSettings wrote nothing");
		expect(bytes.eraserMode, "data.json would not hold the choice").toBe("reticle");

		// The restart: those same bytes back through the real loadSettings,
		// which is the one place `setEraserWholeStrokes` is called from.
		setEraserWholeStrokes(true);
		const second = fakePlugin(JSON.parse(JSON.stringify(bytes)));
		await pluginProto.loadSettings.call(second);
		expect((second.settings as Record<string, unknown>).eraserMode).toBe("reticle");
		expect(getEraserWholeStrokes(), "the restart re-applied stroke over the stored reticle").toBe(
			false
		);
	});

	it("a vault that never stored the key still starts on stroke", async () => {
		ensureDocument();
		setEraserWholeStrokes(false);
		const plugin = fakePlugin({ mouseInk: true });
		await pluginProto.loadSettings.call(plugin);
		expect((plugin.settings as Record<string, unknown>).eraserMode).toBe("stroke");
		expect(getEraserWholeStrokes()).toBe(true);
	});
});
