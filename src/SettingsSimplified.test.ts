/**
 * THREE ROWS OUT OF THE SETTINGS TAB, ONE KEPT (1.4.20, Alan's settings
 * simplification).
 *
 *   Pressure sensitivity  the switch is gone and pressure is always on. A vault
 *                         that stored `false` loads ON: a stored value with no
 *                         row left to change it back would be off forever.
 *                         Its Recalibrate button is a separate feature (it
 *                         forgets the learned per-device pressure max) and is
 *                         the only road to `resetPressureCalibration`, so it
 *                         moves to the Developer group (Alan: A3).
 *   Toolbar placement     KEPT. Its removal was reverted on Alan's word: the
 *                         dropdown is the only keyboard route to placement (the
 *                         drag grip is hidden from assistive tech on purpose,
 *                         MobileTools.ts). It and drag-to-anchor share one road,
 *                         `applyToolbarPlacement`, and the stored placement loads
 *                         as stored.
 *   Mouse ink            the row is gone. The `mouse-ink-toggle` command and
 *                         its hotkey stay, and still write `mouseInk`.
 *   Boox mode             moved, not changed: into the existing Developer group.
 *
 * `setControlValue` ignores keys it has no case for, so the removed rows' cases
 * are removed with them: no road is left from the tab to pressure off, and none
 * to mouse ink.
 *
 * Harness as PressureCurveRemoved.test.ts: `Object.create` on the real plugin
 * and tab, the settings object main.ts builds, nothing restated here.
 */

import { describe, expect, it } from "vitest";
import HandwritingPlugin, { HandwritingSettingTab } from "./main";
import mainSource from "./main.ts?raw";
import { applyToolbarPlacement } from "./inline/InkOverlay";
import { pressureSensitivityEnabled, setPressureSensitivity } from "./ink/PenStyle";
import { resetPressureGainForTest, setPressureStore, strokeGain } from "./ink/PressureGain";

const MAIN = mainSource.replace(/\r\n/g, "\n");

const proto = HandwritingPlugin.prototype as unknown as {
	loadSettings(this: unknown): Promise<void>;
	persistSettings(this: unknown): Promise<void>;
};

function ensureDocument(): void {
	const g = globalThis as unknown as { document?: unknown };
	g.document ??= {
		body: { classList: { add: () => {}, toggle: () => {}, contains: () => false } },
	};
}

type Plugin = { settings: Record<string, unknown>; saved: Record<string, unknown> | null };

function fakePlugin(raw: unknown): Plugin {
	const plugin = Object.create(HandwritingPlugin.prototype) as Record<string, unknown>;
	plugin.loadData = (): Promise<unknown> => Promise.resolve(raw);
	plugin.saved = null;
	plugin.saveData = (data: Record<string, unknown>): Promise<void> => {
		plugin.saved = { ...data };
		return Promise.resolve();
	};
	plugin.settingsTimer = null;
	plugin.settingsDirty = false;
	plugin.settingsWriting = null;
	plugin.settingsWriteAgain = false;
	plugin.store = { useInkFolder: () => {}, load: () => null, schedule: () => {} };
	plugin.pdfStore = { attachHost: () => {} };
	plugin.app = { workspace: { onLayoutReady: () => {} } };
	plugin.applyPaperTo = (): void => {};
	plugin.applyBooxMode = (): void => {};
	plugin.manifest = { version: "1.4.20" };
	return plugin as unknown as Plugin;
}

async function loaded(raw: unknown): Promise<Plugin> {
	ensureDocument();
	const plugin = fakePlugin(raw);
	await proto.loadSettings.call(plugin);
	return plugin;
}

type Row = {
	type?: string;
	heading?: string;
	name?: string;
	desc?: string;
	aliases?: string[];
	items?: Row[];
	control?: { type: string; key: string };
	render?: (setting: unknown) => void;
};

interface Tab {
	plugin: Plugin;
	getSettingDefinitions(): Row[];
	setControlValue(key: string, value: unknown): void;
}

function tabFor(plugin: Plugin): Tab {
	const tab = Object.create(HandwritingSettingTab.prototype) as Tab;
	tab.plugin = plugin;
	(plugin as unknown as Record<string, unknown>).saveSettingsNow = (): void => {};
	return tab;
}

const flatten = (rows: Row[]): Row[] => rows.flatMap((r) => (r.items ? flatten(r.items) : [r]));

/** A Setting that records what a `render` row adds to it. */
function recordingSetting(): { setting: unknown; buttons: { text: string; click: () => void }[]; toggles: number } {
	const rec = { buttons: [] as { text: string; click: () => void }[], toggles: 0, setting: null as unknown };
	const setting = {
		setName: () => setting,
		setDesc: () => setting,
		addButton: (cb: (b: unknown) => void) => {
			const entry = { text: "", click: () => {} };
			const btn = {
				setButtonText: (t: string) => ((entry.text = t), btn),
				setCta: () => btn,
				setDisabled: () => btn,
				onClick: (fn: () => void) => ((entry.click = fn), btn),
			};
			cb(btn);
			rec.buttons.push(entry);
			return setting;
		},
		addToggle: () => {
			rec.toggles++;
			return setting;
		},
	};
	rec.setting = setting;
	return rec;
}

describe("the removed rows are gone from the settings tab", () => {
	it("has no Pressure sensitivity or Mouse ink row, by name or by key", async () => {
		const rows = flatten(tabFor(await loaded({})).getSettingDefinitions());
		const names = rows.map((r) => r.name);
		const keys = rows.map((r) => r.control?.key);
		expect(rows.length, "the definitions flattened to something").toBeGreaterThan(10);
		for (const name of ["Pressure sensitivity", "Mouse ink"]) expect(names, name).not.toContain(name);
		for (const key of ["pressureSensitivity", "mouseInk"]) expect(keys, key).not.toContain(key);
	});

	it("keeps the Toolbar placement dropdown, the keyboard route to placement, in the Toolbar group", async () => {
		const groups = tabFor(await loaded({})).getSettingDefinitions();
		const toolbar = groups.filter((g) => g.heading === "Toolbar");
		expect(toolbar, "one Toolbar group").toHaveLength(1);
		const rows = flatten(groups).filter((r) => r.control?.key === "toolbarCorner");
		expect(rows, "one placement row").toHaveLength(1);
		expect(flatten(toolbar[0]!.items ?? [])).toContain(rows[0]);
		expect(rows[0]!.name).toBe("Toolbar placement");
		expect(rows[0]!.control?.type).toBe("dropdown");
	});

	it("leaves no empty group behind", async () => {
		const groups = tabFor(await loaded({})).getSettingDefinitions();
		for (const group of groups) {
			if (group.items) expect(group.items.length, `group "${group.heading}"`).toBeGreaterThan(0);
		}
		expect(groups.map((g) => g.heading)).not.toContain("Mouse");
	});
});

describe("Boox mode and Recalibrate live in the Developer group", () => {
	it("holds each exactly once, and nowhere else", async () => {
		const groups = tabFor(await loaded({})).getSettingDefinitions();
		const developer = groups.filter((g) => g.heading === "Developer");
		expect(developer, "one Developer group").toHaveLength(1);
		const inDev = flatten(developer[0]!.items ?? []);
		const all = flatten(groups);
		const boox = all.filter((r) => r.control?.key === "booxMode");
		expect(boox, "one Boox mode row").toHaveLength(1);
		expect(inDev).toContain(boox[0]);
		expect(boox[0]!.name).toBe("Boox mode");
		const recal = all.filter((r) => r.name === "Recalibrate pen pressure");
		expect(recal, "one Recalibrate row").toHaveLength(1);
		expect(inDev).toContain(recal[0]);
		expect(inDev.map((r) => r.control?.key)).toContain("devDiagnostics");
	});

	it("keeps the old pressure row findable by settings search", async () => {
		const recal = flatten(tabFor(await loaded({})).getSettingDefinitions()).find((r) => r.name === "Recalibrate pen pressure");
		expect(recal?.aliases ?? []).toContain("pressure sensitivity");
	});

	it("draws a Recalibrate button and no toggle, and the button forgets the learned pressure max", async () => {
		const recal = flatten(tabFor(await loaded({})).getSettingDefinitions()).find((r) => r.name === "Recalibrate pen pressure");
		expect(recal?.render, "the row renders its own button").toBeTypeOf("function");
		expect(recal?.control).toBeUndefined();
		const rec = recordingSetting();
		recal!.render!(rec.setting);
		expect(rec.toggles, "no switch rides along").toBe(0);
		expect(rec.buttons.map((b) => b.text)).toEqual(["Recalibrate"]);

		// A freak-high learned max pins the gain at 1; the platform assumption
		// (0.25) would give 0.55 / 0.25. Forgetting the max is what brings it back.
		const saves: [string, string][] = [];
		setPressureStore({ load: () => null, save: (k, v) => void saves.push([k, v]) });
		try {
			resetPressureGainForTest(0.9, 0.25);
			expect(strokeGain()).toBe(1);
			rec.buttons[0]!.click();
			expect(strokeGain()).toBeCloseTo(0.55 / 0.25, 10);
			expect(saves.map(([, v]) => v), "the stored device max is emptied").toEqual([""]);
		} finally {
			setPressureStore(null);
			resetPressureGainForTest();
		}
	});
});

describe("pressure is always on", () => {
	it.each([
		["no file", undefined],
		["a stored true", { pressureSensitivity: true }],
		["a stored false", { pressureSensitivity: false }],
		["the pre-rename inkShaping false", { inkShaping: false }],
	])("loads ON from %s, and saves ON", async (_label, raw) => {
		const plugin = await loaded(raw);
		expect(plugin.settings.pressureSensitivity).toBe(true);
		await proto.persistSettings.call(plugin);
		expect(plugin.saved?.pressureSensitivity).toBe(true);
	});

	it("gives the settings tab no road to pressure off", async () => {
		const plugin = await loaded({});
		setPressureSensitivity(true);
		try {
			tabFor(plugin).setControlValue("pressureSensitivity", false);
			expect(plugin.settings.pressureSensitivity).toBe(true);
			expect(pressureSensitivityEnabled()).toBe(true);
		} finally {
			setPressureSensitivity(true);
		}
	});

	it("applies the loaded value at startup", () => {
		expect(MAIN).toContain("setPressureSensitivity(this.settings.pressureSensitivity);");
		expect(MAIN.match(/setPressureSensitivity\(/g), "one call site in main.ts").toHaveLength(1);
	});
});

describe("placement keeps both writers; mouse ink keeps its command", () => {
	it("loads a stored toolbar placement as stored, and both the drag and the dropdown write it", async () => {
		const plugin = await loaded({ toolbarCorner: "bottom-left" });
		expect(plugin.settings.toolbarCorner).toBe("bottom-left");
		applyToolbarPlacement("middle-right");
		expect(plugin.settings.toolbarCorner, "the drag's road").toBe("middle-right");
		tabFor(plugin).setControlValue("toolbarCorner", "top-left");
		expect(plugin.settings.toolbarCorner, "the dropdown's road").toBe("top-left");
	});

	it("loads a stored mouse ink choice, and the tab no longer writes it", async () => {
		const plugin = await loaded({ mouseInk: true });
		expect(plugin.settings.mouseInk).toBe(true);
		tabFor(plugin).setControlValue("mouseInk", false);
		expect(plugin.settings.mouseInk).toBe(true);
	});

	it("keeps the mouse-ink-toggle command, which still writes the choice down", () => {
		const from = MAIN.indexOf('id: "mouse-ink-toggle",');
		expect(from, "the command is still registered").toBeGreaterThan(-1);
		const to = MAIN.indexOf("this.addCommand(", from);
		expect(to, "anchor: the next addCommand after mouse-ink-toggle").toBeGreaterThan(from);
		const block = MAIN.slice(from, to);
		expect(block.length).toBeLessThan(12000);
		expect(block).toContain('name: "Mouse on / off"');
		expect(block).toContain("this.settings.mouseInk = on;");
		expect(block).toContain('runDetached(this.persistSettings(), "save the mouse ink setting");');
	});
});
