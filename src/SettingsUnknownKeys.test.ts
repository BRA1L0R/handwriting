/**
 * A key this build does not know survives a load and a save.
 *
 * `persistSettings` writes the settings object WHOLE - `saveData(this.settings)`,
 * never a merge - and `loadSettings` used to rebuild that object as a literal
 * naming only the keys this build knows. Together those two facts made an
 * older build a settings ERASER: open a vault whose data.json was written by a
 * newer build (or a parallel branch), let anything at all save once, and every
 * key the older build had no line for was gone from the file. The keys are not
 * hypothetical - `inkShaping` is one this repo has already renamed past, and
 * every 1.5.x/1.6.x key in flight is another.
 *
 * The fix is one spread: `loadSettings` spreads the raw file FIRST, then writes
 * the known keys over it. The order is the guarantee, and both halves of it are
 * pinned here - the unknown key rides through, and a known key with a rotten
 * value is still normalised rather than being let through by the spread.
 *
 * HOW IT DRIVES THE REAL METHOD. `loadSettings` and `persistSettings` are both
 * private, and main.ts is a plugin, so this uses the pattern TipModeCommand.ts
 * established: `Object.create(HandwritingPlugin.prototype)` for an instance with
 * no field initialisers, the handful of members the two methods actually touch
 * supplied by hand, and the two DOM-reaching methods (`applyPaperTo`,
 * `applyBooxMode`) shadowed with own properties. Nothing about the settings
 * literal is copied into this file: the object under test is the one main.ts
 * builds, and the assertions re-derive every normalised value by calling the
 * same normaliser main.ts calls rather than restating a number.
 */
import { beforeEach, describe, expect, it } from "vitest";

import HandwritingPlugin from "./main";
import { clampInkSize } from "./ink/InkSize";
import { clampEraserRadius } from "./ink/EraserSize";
import { normalizePenToolsMode, resetPenToolsForTest } from "./inline/PenToolsMode";

const proto = HandwritingPlugin.prototype as unknown as {
	loadSettings(this: unknown): Promise<void>;
	persistSettings(this: unknown): Promise<void>;
};

/**
 * `loadSettings` ends with `this.applyPaperTo(document, ...)`, and the argument
 * is evaluated even when the method itself is shadowed. Vitest runs in node
 * here (no jsdom anywhere in this suite), so the global has to exist.
 */
function ensureDocument(): void {
	const g = globalThis as unknown as { document?: unknown };
	g.document ??= { body: { classList: { add: () => {}, toggle: () => {} } } };
}

interface Harness {
	settings: Record<string, unknown>;
	/** What `saveData` was last handed, i.e. what data.json would now hold. */
	saved: Record<string, unknown> | null;
}

function fakePlugin(raw: unknown): Harness {
	const plugin = Object.create(HandwritingPlugin.prototype) as Record<string, unknown>;
	plugin.loadData = (): Promise<unknown> => Promise.resolve(raw);
	plugin.saved = null;
	plugin.saveData = (data: Record<string, unknown>): Promise<void> => {
		plugin.saved = data;
		return Promise.resolve();
	};
	// persistSettings' own fields. `Object.create` skips the initialisers, and
	// `settingsTimer` undefined would take the `!== null` branch into
	// `window.clearTimeout` - a crash, not a test.
	plugin.settingsTimer = null;
	plugin.settingsDirty = false;
	plugin.settingsWriting = null;
	plugin.settingsWriteAgain = false;
	// The seams loadSettings fills in passing.
	plugin.store = { useInkFolder: () => {}, load: () => null, schedule: () => {} };
	plugin.pdfStore = { attachHost: () => {} };
	plugin.app = { workspace: { onLayoutReady: () => {} } };
	// Own properties, so they shadow the prototype's DOM-reaching versions.
	plugin.applyPaperTo = (): void => {};
	plugin.applyBooxMode = (): void => {};
	return plugin as unknown as Harness;
}

async function loadThenSave(raw: unknown): Promise<Harness> {
	ensureDocument();
	const plugin = fakePlugin(raw);
	await proto.loadSettings.call(plugin);
	await proto.persistSettings.call(plugin);
	return plugin;
}

describe("loadSettings carries keys this build does not know", () => {
	beforeEach(resetPenToolsForTest);

	it("round-trips an unknown key through the load and the write", async () => {
		const plugin = await loadThenSave({ futureKey: 1, mouseInk: true });

		expect(plugin.settings.futureKey, "the key was dropped rebuilding the object").toBe(1);
		// The write is what actually costs the other build its setting, so it
		// is asserted separately: a key held in memory and left out of
		// `saveData` would be erased from data.json just the same.
		expect(plugin.saved?.futureKey, "the key was held but not written back").toBe(1);
		// And the load still did its job on the key it does know.
		expect(plugin.settings.mouseInk).toBe(true);
	});

	it("normalises a known key with a bad value, spread or not", async () => {
		const plugin = await loadThenSave({
			futureKey: 1,
			inkSizes: { pen: 999, highlighter: 999 },
			eraserRadiusPx: -40,
			penTools: "nonsense",
		});

		// Re-derived by calling the same normaliser main.ts calls, never a
		// number typed in here: an assertion pinned to a recorded constant
		// would keep passing if the clamp itself changed.
		expect(plugin.settings.inkSizes).toEqual({
			pen: clampInkSize(999),
			highlighter: clampInkSize(999),
		});
		expect(plugin.settings.eraserRadiusPx).toBe(clampEraserRadius(-40));
		expect(plugin.settings.penTools).toBe(normalizePenToolsMode("nonsense"));
		// The spread put the rotten values in first; the known keys are
		// written over it. This is the assertion that fails if the two are
		// ever swapped.
		expect(plugin.settings.inkSizes).not.toEqual({ pen: 999, highlighter: 999 });
		expect(plugin.saved?.penTools).toBe(normalizePenToolsMode("nonsense"));
		expect(plugin.saved?.futureKey).toBe(1);
	});

	it("carries an old data.json's penHardwareEverSeen rather than deleting it", async () => {
		// The latch left data.json on 2026-09-05 and is IGNORED at load - it
		// may be another machine's. Ignored is not deleted: a machine still
		// running a build that reads the key must not have its latch dropped
		// by this one's next save.
		const plugin = await loadThenSave({ penHardwareEverSeen: true });

		expect(plugin.saved?.penHardwareEverSeen).toBe(true);
	});

	it("carries nothing forward when the file is not an object", async () => {
		// `loadData` returns whatever the file parsed to. A string spread into
		// an object literal spills its characters in under numeric keys, and
		// an array spreads its elements the same way; neither is a settings
		// file, so neither contributes anything.
		const fromString = await loadThenSave("not a settings object");
		expect(fromString.settings[0], "a string was spread character by character").toBeUndefined();
		expect(Object.keys(fromString.settings)).not.toContain("0");

		const fromArray = await loadThenSave([{ mouseInk: true }]);
		expect(fromArray.settings[0], "an array was spread index by index").toBeUndefined();
		// Still a complete, usable settings object either way - the known keys
		// are written unconditionally, so nothing here is left undefined.
		expect(fromArray.settings.mouseInk).toBe(false);
		expect(fromArray.settings.penTools).toBe(normalizePenToolsMode(undefined));
	});
});
