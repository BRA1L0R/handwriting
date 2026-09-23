/** Capture-only pressure must never advertise a switch that repairs old ink. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const notices = vi.hoisted(() => ({ messages: [] as unknown[], durations: [] as number[] }));
vi.mock("obsidian", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		Notice: class {
			constructor(message: unknown, duration?: number) {
				notices.messages.push(message);
				notices.durations.push(duration ?? -1);
			}
		},
	};
});

/**
 * The release-notes table main.ts reads is the module's own, so a test cannot
 * hand it one. `decideWhatsNew` already takes the table as its last argument
 * for exactly this reason; the wrapper below passes the override through when
 * one is set and is the real function otherwise. Nothing else is faked: the
 * decision, the fragment and the notice all run.
 */
const override = vi.hoisted(() => ({ notes: null as Record<string, string[]> | null }));
vi.mock("./update/WhatsNew", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	const real = actual.decideWhatsNew as (...args: unknown[]) => unknown;
	return {
		...actual,
		decideWhatsNew: (current: unknown, seen: unknown, fresh: unknown, notes?: unknown) =>
			real(current, seen, fresh, notes ?? override.notes ?? undefined),
	};
});

import HandwritingPlugin from "./main";
import { RELEASE_NOTES } from "./update/WhatsNew";

/** Run one launch with a release-notes table the module does not carry yet. */
function withNotes(notes: Record<string, string[]>, run: () => void): void {
	override.notes = notes;
	try {
		run();
	} finally {
		override.notes = null;
	}
}

/**
 * Obsidian injects `createFragment`, and `.createDiv`/`.createEl` on what it
 * returns. This suite runs with no DOM, so a fake with the same call shape
 * stands in and the real `whatsNewFragment` runs unmodified. Same shape as the
 * fake in WhatsNew.test.ts, which pins that function's output node for node.
 */
class FakeEl {
	children: FakeEl[] = [];
	constructor(
		public tag: string,
		public cls?: string,
		public text?: string
	) {}
	createDiv(opts: { cls?: string; text?: string } = {}): FakeEl {
		const el = new FakeEl("div", opts.cls, opts.text);
		this.children.push(el);
		return el;
	}
	createEl(tag: string, opts: { cls?: string; text?: string } = {}): FakeEl {
		const el = new FakeEl(tag, opts.cls, opts.text);
		this.children.push(el);
		return el;
	}
}
(globalThis as unknown as { createFragment: () => FakeEl }).createFragment = () =>
	new FakeEl("fragment");

/** The table as the version bump will leave it: today's, plus a 1.4.21 entry. */
const NOTES_WITH_1421: Record<string, string[]> = { ...RELEASE_NOTES, "1.4.21": ["Ink hotfix"] };

/** Alan's copy, verbatim. Do not paraphrase or re-case. */
const PRESSURE_NOTICE = "Handwriting: ink too wide? Settings, Pen, Pressure sensitivity, off.";

const proto = HandwritingPlugin.prototype as unknown as {
	loadSettings(this: unknown): Promise<void>;
	showWhatsNewIfDue(this: unknown): void;
};

type Plugin = {
	settings: Record<string, unknown>;
	saved: Record<string, unknown> | null;
	saveCount: number;
};

function ensureDocument(): void {
	const g = globalThis as unknown as { document?: unknown };
	g.document ??= {
		body: { classList: { add: () => {}, toggle: () => {}, contains: () => false } },
	};
}

/**
 * The plugin as the launch path meets it: the settings main.ts built from this
 * vault's data.json, the manifest version it is landing on, and the two
 * boundaries that matter - the disk and the screen.
 */
async function launched(
	raw: unknown,
	version = "1.4.21",
	notes?: Record<string, string[]>
): Promise<Plugin> {
	ensureDocument();
	const plugin = Object.create(HandwritingPlugin.prototype) as Record<string, unknown>;
	plugin.loadData = (): Promise<unknown> => Promise.resolve(raw);
	plugin.saved = null;
	plugin.saveCount = 0;
	plugin.saveData = (data: Record<string, unknown>): Promise<void> => {
		plugin.saved = { ...data };
		plugin.saveCount = (plugin.saveCount as number) + 1;
		return Promise.resolve();
	};
	// The rest of what `loadSettings` reaches for on the way past. Faked, not
	// exercised: this cell is about one branch at the end of the launch path.
	plugin.settingsTimer = null;
	plugin.settingsDirty = false;
	plugin.settingsWriting = null;
	plugin.settingsWriteAgain = false;
	plugin.store = { useInkFolder: () => {}, load: () => null, schedule: () => {} };
	plugin.pdfStore = { attachHost: () => {} };
	plugin.app = { workspace: { onLayoutReady: () => {} } };
	plugin.applyPaperTo = (): void => {};
	plugin.applyBooxMode = (): void => {};
	plugin.manifest = { version };
	plugin.freshInstall = false;
	await proto.loadSettings.call(plugin);
	if (notes) {
		withNotes(notes, () => proto.showWhatsNewIfDue.call(plugin));
	} else {
		proto.showWhatsNewIfDue.call(plugin);
	}
	return plugin as unknown as Plugin;
}

const pressureNotices = (): unknown[] => notices.messages.filter((m) => m === PRESSURE_NOTICE);


describe("upgrade notices with capture-only pressure", () => {
	beforeEach(() => {
		notices.messages.length = 0;
		notices.durations.length = 0;
	});

	it.each([true, false])("does not offer to restyle old ink (pressure=%s), and preserves the preference", async pressureSensitivity => {
		const plugin = await launched({ lastSeenVersion: "1.4.20", pressureSensitivity });
		expect(pressureNotices()).toHaveLength(0);
		expect(plugin.settings.pressureSensitivity).toBe(pressureSensitivity);
		expect(plugin.saved?.pressureSensitivity).toBe(pressureSensitivity);
		expect(plugin.saved?.lastSeenVersion).toBe("1.4.21");
	});

	it("still shows normal release notes once", async () => {
		const first = await launched({ lastSeenVersion: "1.4.20", pressureSensitivity: true }, "1.4.21", NOTES_WITH_1421);
		expect(notices.messages).toHaveLength(1);
		expect(pressureNotices()).toHaveLength(0);
		expect(first.saved?.lastSeenVersion).toBe("1.4.21");
		notices.messages.length = 0;
		await launched({ ...first.saved });
		expect(notices.messages).toHaveLength(0);
	});

	it("leaves the version unrecorded if release notes fail, so the next launch can retry", async () => {
		const global = globalThis as unknown as { createFragment: unknown };
		const original = global.createFragment;
		global.createFragment = (): never => { throw new Error("no fragments"); };
		try {
			const plugin = await launched({ lastSeenVersion: "1.4.20", pressureSensitivity: true }, "1.4.21", NOTES_WITH_1421);
			expect(plugin.saved).toBeNull();
			expect(pressureNotices()).toHaveLength(0);
		} finally {
			global.createFragment = original;
		}
	});
});
