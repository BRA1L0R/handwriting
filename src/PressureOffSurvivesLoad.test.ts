/** A saved pressure preference affects capture after load, never old ink. */
import { describe, expect, it } from "vitest";
import HandwritingPlugin from "./main";
import { EXP7_PEN, setPressureSensitivity } from "./ink/PenStyle";
import { shapedHalfWidths } from "./ink/InkShape";
import { StrokeBuilder } from "./ink/StrokeBuilder";
import { emptyPage, parsePage, serializePage } from "./model/PageData";

// Harness as SettingsSimplified.test.ts: `Object.create` on the real plugin,
// loadSettings run for real, nothing restated there - this file owns its own
// copy so the two lanes (Slicer 1's red cell, Engineer 2's fix) touch no
// common file.
function ensureDocument(): void {
	const g = globalThis as unknown as { document?: unknown };
	g.document ??= {
		body: { classList: { add: () => {}, toggle: () => {}, contains: () => false } },
	};
}

type Plugin = { settings: Record<string, unknown> };

function fakePlugin(raw: unknown): Plugin {
	const plugin = Object.create(HandwritingPlugin.prototype) as Record<string, unknown>;
	plugin.loadData = (): Promise<unknown> => Promise.resolve(raw);
	plugin.saveData = (): Promise<void> => Promise.resolve();
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


describe("pressure-off survives load as a capture preference", () => {
	it("honors stored false and authors reloadable fixed-pressure ink without restyling old samples", async () => {
		ensureDocument();
		const plugin = fakePlugin({ pressureSensitivity: false });
		const proto = HandwritingPlugin.prototype as unknown as { loadSettings(this: unknown): Promise<void> };
		const oldPoints = [{ x: 0, y: 0, pressure: 1, t: 0 }];
		setPressureSensitivity(true);
		const before = shapedHalfWidths(oldPoints, EXP7_PEN);
		try {
			await proto.loadSettings.call(plugin);
			expect(plugin.settings.pressureSensitivity).toBe(false);
			// Startup applies the loaded preference before any pen-down.
			setPressureSensitivity(plugin.settings.pressureSensitivity === true);
			expect(shapedHalfWidths(oldPoints, EXP7_PEN)).toEqual(before);
			const builder = new StrokeBuilder("pen", "#111111", 2.2);
			builder.start(0);
			builder.add(0, 0, 0.75, 0);
			builder.add(10, 0, 1, 10);
			const page = emptyPage("pressure-off");
			page.strokes = [builder.finish()!];
			const loaded = parsePage(serializePage(page), page.pageId).data;
			expect(loaded.strokes[0]!.points.map(p => p.pressure)).toEqual([0.32, 0.32]);
		} finally {
			setPressureSensitivity(true);
		}
	});
});
