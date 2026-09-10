import { describe, expect, it, vi } from "vitest";
import { type App, type CachedMetadata, type Plugin, TFile } from "obsidian";
import { NOTE_PAPER_ATTRIBUTE, NOTE_PAPER_KEY, NotePaper, notePaperChoice, type NotePaperChoice } from "./NotePaper";

type PickerProbe = {
	title: string; instructions: { command: string; purpose: string }[]; isOpen: boolean;
	modalEl: { children: { texts: string[] }[] };
	selectChoice(choice: NotePaperChoice): Promise<void>;
	close(): void;
};
const modals = vi.hoisted(() => ({ opened: [] as PickerProbe[] }));
vi.mock("obsidian", async importOriginal => ({
	...await importOriginal<object>(),
	Modal: class {
		title = ""; instructions: { command: string; purpose: string }[] = []; isOpen = false;
		modalEl = {
			children: [] as { texts: string[] }[],
			createDiv() {
				const header = { texts: [] as string[], createEl(_tag: string, options: { text: string }) { this.texts.push(options.text); }, createDiv(options: { text: string }) { this.texts.push(options.text); } };
				return header;
			},
			prepend(header: { texts: string[] }) { this.children.unshift(header); },
			setAttribute() {}, addClass() {}, ownerDocument: { activeElement: null },
		};
		setTitle(value: string) { this.title = value; return this; }
		setInstructions(value: { command: string; purpose: string }[]) { this.instructions = value; }
		open() { this.isOpen = true; modals.opened.push(this as unknown as PickerProbe); }
		close() { this.isOpen = false; this.onClose(); }
		onClose() {}
	},
}));

function fixture() {
	const a = Object.assign(new TFile(), { path: "a.md", extension: "md" });
	const b = Object.assign(new TFile(), { path: "b.md", extension: "md" });
	const files = new Map<string, TFile>([[a.path, a], [b.path, b]]);
	const metadata = new Map<TFile, CachedMetadata>([[a, { frontmatter: { title: "A", [NOTE_PAPER_KEY]: "lines" } }], [b, { frontmatter: { title: "B", [NOTE_PAPER_KEY]: "none" } }]]);
	const disk = new Map<TFile, Record<string, unknown>>([...metadata].map(([file, cache]) => [file, { ...cache.frontmatter }]));
	const contents = new Map<TFile, string>([[a, "a initial"], [b, "b initial"]]);
	function leaf(file: TFile) {
		const attrs = new Map<string, string>();
		const containerEl = {
			setAttribute: (key: string, value: string) => attrs.set(key, value),
			removeAttribute: (key: string) => attrs.delete(key),
		} as unknown as HTMLElement;
		return { view: { file, containerEl }, attrs };
	}
	const first = leaf(a), second = leaf(b), duplicate = leaf(a);
	let leaves = [first, second, duplicate];
	let active: typeof first.view | null = first.view;
	const events = new Map<string, (...args: any[]) => unknown>();
	let ready = (): void => {};
	const cleanups: (() => void)[] = [];
	const processFrontMatter = vi.fn(async (file: TFile, change: (fm: Record<string, unknown>) => void) => {
		change(disk.get(file)!);
		contents.set(file, JSON.stringify(disk.get(file)));
	});
	const app = {
		workspace: {
			getLeavesOfType: vi.fn(() => leaves),
			getActiveViewOfType: () => active,
			on: (name: string, callback: (...args: any[]) => unknown) => { events.set(name, callback); return {}; },
			onLayoutReady: (callback: () => void) => { ready = callback; },
		},
		metadataCache: {
			getFileCache: (file: TFile) => metadata.get(file),
			on: (name: string, callback: (...args: any[]) => unknown) => { events.set(name, callback); return {}; },
		},
		fileManager: { processFrontMatter },
		vault: { read: vi.fn(async (file: TFile) => contents.get(file)!), getAbstractFileByPath: (path: string) => files.get(path) ?? null },
	} as unknown as App;
	const notify = vi.fn();
	const paper = new NotePaper(app, notify);
	paper.start({ registerEvent: () => {}, register: (cleanup: () => void) => cleanups.push(cleanup) } as unknown as Plugin);
	const changed = (file: TFile, fm: Record<string, unknown>, data = contents.get(file)!) => {
		const cache = { frontmatter: fm };
		metadata.set(file, cache);
		events.get("changed")!(file, data, cache);
	};
	return { a, b, files, first, second, duplicate, app, paper, notify, metadata, disk, contents, processFrontMatter, events, ready: () => ready(), changed,
		setLeaves: (value: typeof leaves) => { leaves = value; }, setActive: (value: typeof active) => { active = value; }, cleanups };
}

function menuFor(f: ReturnType<typeof fixture>, file: unknown) {
	const titles: string[] = [];
	let click = (): void => {};
	const item = { setIcon: () => item, setTitle: (value: string) => { titles.push(value); return item; }, onClick: (callback: () => void) => { click = callback; return item; } };
	f.events.get("file-menu")!({ addItem: (callback: (value: typeof item) => void) => callback(item) }, file);
	return { titles, click: () => click() };
}
function pickerFor(f: ReturnType<typeof fixture>, file = f.a): PickerProbe {
	menuFor(f, file).click();
	return modals.opened.at(-1)!;
}
const style = (leaf: ReturnType<typeof fixture>["first"]) => leaf.attrs.get(NOTE_PAPER_ATTRIBUTE);

describe("per-note paper", () => {
	it("registers a Paper background item on the target Markdown file menu", () => {
		const f = fixture();
		const title = vi.fn();
		const item = { setIcon: () => item, setTitle: (value: string) => { title(value); return item; }, onClick: () => item };
		const menu = { addItem: (callback: (value: typeof item) => void) => callback(item) };
		expect(f.events.has("file-menu")).toBe(true);
		f.events.get("file-menu")!(menu, f.a);
		expect(title).toHaveBeenCalledWith("Paper background");
	});
	it.each([undefined, null, "invalid", {}, 1])("inherits invalid or missing metadata %s without treating it as explicit None", value => {
		expect(notePaperChoice(value)).toBe("default");
		expect(notePaperChoice("none")).toBe("none");
	});

	it("waits for layout; applies independent notes and duplicate panes without writing", () => {
		const f = fixture();
		f.paper.refresh();
		expect(f.app.workspace.getLeavesOfType).not.toHaveBeenCalled();
		f.ready();
		expect([style(f.first), style(f.second), style(f.duplicate)]).toEqual(["lines", "none", "lines"]);
		f.paper.refresh(); // The global-default change seam does not overwrite overrides.
		expect([style(f.first), style(f.second)]).toEqual(["lines", "none"]);
		expect(f.processFrontMatter).not.toHaveBeenCalled();
	});

	it("refreshes reused leaves, window arrivals, metadata changes and removed containers", () => {
		const f = fixture(); f.ready();
		f.first.view.file = f.b;
		f.events.get("file-open")!();
		expect(style(f.first)).toBe("none");
		f.changed(f.b, { [NOTE_PAPER_KEY]: "grid" });
		expect([style(f.first), style(f.second)]).toEqual(["grid", "grid"]);
		f.changed(f.b, { [NOTE_PAPER_KEY]: "invalid" });
		expect(style(f.first)).toBeUndefined();
		f.setLeaves([f.first]);
		f.events.get("layout-change")!();
		expect(style(f.duplicate)).toBeUndefined();
		f.setLeaves([f.first, f.duplicate]);
		f.events.get("window-open")!();
		expect(style(f.duplicate)).toBe("lines");
		f.cleanups.forEach(cleanup => cleanup());
		expect(style(f.duplicate)).toBeUndefined();
		f.events.get("layout-change")!(); f.ready();
		expect(style(f.duplicate)).toBeUndefined();
	});

	it("saves only the requested property, removes only that key for Default, and restores on restart", async () => {
		const f = fixture(); f.ready();
		await f.paper.save(f.a, "dots");
		expect(f.disk.get(f.a)).toEqual({ title: "A", [NOTE_PAPER_KEY]: "dots" });
		expect([style(f.first), style(f.duplicate)]).toEqual(["dots", "dots"]);
		f.changed(f.a, f.disk.get(f.a)!);
		const restarted = new NotePaper(f.app, f.notify);
		expect(restarted.choice(f.a)).toBe("dots");
		await f.paper.save(f.a, "default");
		expect(f.disk.get(f.a)).toEqual({ title: "A" });
		expect(style(f.first)).toBeUndefined();
		expect(f.disk.get(f.b)).toEqual({ title: "B", [NOTE_PAPER_KEY]: "none" });
	});

	it("holds the saved choice through stale cache events but accepts a newer external edit", async () => {
		const f = fixture(); f.ready();
		await f.paper.save(f.a, "dots");
		f.changed(f.a, { [NOTE_PAPER_KEY]: "lines" }, "a initial");
		await vi.waitFor(() => expect(f.app.vault.read).toHaveBeenCalledOnce());
		expect(style(f.first)).toBe("dots");
		f.contents.set(f.a, "external edit");
		f.changed(f.a, { [NOTE_PAPER_KEY]: "grid" }, "external edit");
		await vi.waitFor(() => expect(style(f.first)).toBe("grid"));
	});

	it("shows the menu target and current choice; selection stays bound when another note is active", async () => {
		const f = fixture(); f.ready();
		const menu = menuFor(f, f.a);
		f.setActive(f.second.view);
		menu.click();
		const picker = modals.opened.at(-1)!;
		expect(picker.title).toBe("Paper background");
		await picker.selectChoice("grid");
		await picker.selectChoice("dots");
		expect(picker.isOpen).toBe(false);
		expect(f.processFrontMatter).toHaveBeenCalledOnce();
		expect(f.processFrontMatter.mock.calls[0]![0]).toBe(f.a);
		expect([style(f.first), style(f.duplicate), style(f.second)]).toEqual(["grid", "grid", "none"]);
	});

	it("keeps the saved choice on failure and permits retry from the menu", async () => {
		const f = fixture(); f.ready();
		f.processFrontMatter.mockRejectedValueOnce(new Error("disk refused"));
		await pickerFor(f).selectChoice("none");
		expect(f.notify).toHaveBeenCalledOnce();
		expect(style(f.first)).toBe("lines");
		await pickerFor(f).selectChoice("none");
		expect(style(f.first)).toBe("none");
		expect(f.disk.get(f.a)?.[NOTE_PAPER_KEY]).toBe("none");
		await pickerFor(f).selectChoice("default");
		expect(f.disk.get(f.a)).toEqual({ title: "A" });
		expect(style(f.first)).toBeUndefined();
	});

	it("omits folders and PDFs, cancels without writing, and closes pickers on unload", async () => {
		const f = fixture();
		expect(menuFor(f, { path: "folder" }).titles).toEqual([]);
		expect(menuFor(f, Object.assign(new TFile(), { path: "a.pdf", extension: "pdf" })).titles).toEqual([]);
		pickerFor(f).close();
		expect(f.processFrontMatter).not.toHaveBeenCalled();
		await modals.opened.at(-1)!.selectChoice("grid");
		expect(f.processFrontMatter).not.toHaveBeenCalled();
		const picker = pickerFor(f);
		f.paper.destroy();
		expect(picker.isOpen).toBe(false);
		await picker.selectChoice("lines");
		f.ready();
		expect(menuFor(f, f.a).titles).toEqual([]);
		expect(f.processFrontMatter).not.toHaveBeenCalled();
		expect(f.app.workspace.getLeavesOfType).not.toHaveBeenCalled();
	});

	it.each(["deleted", "replaced"])("refuses a %s target without touching its replacement", async kind => {
		const f = fixture();
		const picker = pickerFor(f);
		if (kind === "deleted") f.files.delete(f.a.path);
		else f.files.set(f.a.path, Object.assign(new TFile(), { path: f.a.path, extension: "md" }));
		await picker.selectChoice("grid");
		expect(f.processFrontMatter).not.toHaveBeenCalled();
		expect(f.notify).toHaveBeenCalledOnce();
	});

	it("follows a live rename of the captured TFile", async () => {
		const f = fixture();
		const picker = pickerFor(f);
		f.files.delete(f.a.path); f.a.path = "renamed.md"; f.files.set(f.a.path, f.a);
		await picker.selectChoice("grid");
		expect(f.processFrontMatter.mock.calls[0]![0]).toBe(f.a);
		expect(f.disk.get(f.a)?.[NOTE_PAPER_KEY]).toBe("grid");
	});

	it("serializes picks and rechecks identity when a queued write starts", async () => {
		const f = fixture();
		let release!: () => void;
		f.processFrontMatter.mockImplementationOnce(async (file, change) => {
			await new Promise<void>(resolve => { release = resolve; }); change(f.disk.get(file)!);
		});
		const first = pickerFor(f).selectChoice("grid");
		const second = pickerFor(f).selectChoice("dots");
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		expect(f.processFrontMatter).toHaveBeenCalledOnce();
		f.files.delete(f.a.path);
		release(); await Promise.all([first, second]);
		expect(f.processFrontMatter).toHaveBeenCalledOnce();
		expect(f.notify).toHaveBeenCalledOnce();
	});
});
