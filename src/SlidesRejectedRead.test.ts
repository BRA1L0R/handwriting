/**
 * Slides-only rejected-read byte preservation, adapted from the existing
 * HideFlushAndRejectedRead regression. Real main.startSlidesInk host wiring,
 * SlidesDeck input/adoption/persistence, PageStore and bindRecoveryNotices run.
 * FakeAdapter transport, note metadata and the reduced presentation DOM are
 * synthetic; this is not native browser/device acceptance. Other surfaces and
 * freeze scheduling are deliberately outside this regression's scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HandwritingPlugin, { bindRecoveryNotices } from "./main";
import { PageStore } from "./persistence/PageStore";
import { FakeAdapter, gate } from "./persistence/FakeAdapter";
import { SlidesDeck, type SlidesInkHost, pageOfSlide, sectionHashes, setSlidesInk, slidesReloadCandidate, slidesSidecarId } from "./slides/SlidesInkSurface";
import { setPenToolsMode, resetPenToolsForTest } from "./inline/PenToolsMode";
import { type InkPoint, type InkStroke, type InkTool, computeBBox } from "./ink/Stroke";
import { type PageData, emptyPage, parsePage, serializePage } from "./model/PageData";
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

let createdAt = 1_757_700_000_000;

function stroke(id: string, x0: number, y0: number, tool: InkTool = "pen", extra: Partial<InkStroke> = {}): InkStroke {
	const points: InkPoint[] = Array.from({ length: 24 }, (_, i) => ({
		x: r2(x0 + i * 1.37),
		y: r2(y0 + Math.sin(i / 3) * 12.5),
		pressure: r3(0.137 + i * 0.013),
		t: i * 8,
	}));
	const width = tool === "highlighter" ? 14 : 2.2;
	return {
		id,
		tool,
		color: tool === "highlighter" ? "#f7d154" : "#1e2a3b",
		width,
		points,
		bbox: computeBBox(points, width * 2),
		createdAt: createdAt++,
		...extra,
	};
}

function model(strokes: readonly InkStroke[]): Array<Record<string, unknown>> {
	return strokes.map((s) => ({
		id: s.id,
		tool: s.tool,
		page: s.page,
		points: s.points.length,
		pressure: s.points.map((p) => p.pressure),
		xy: s.points.map((p) => [p.x, p.y, p.t]),
	}));
}

// ---- storage ------------------------------------------------------------------------------

const sidecarPath = (id: string): string => `.handwriting/${id}.json`;

function onDisk(adapter: FakeAdapter, id: string): InkStroke[] | null {
	const text = adapter.files.get(sidecarPath(id));
	if (text === undefined) return null;
	const parsed = parsePage(text, id);
	expect(parsed.damaged, `sidecar ${id} did not parse`).toBeFalsy();
	return parsed.data.strokes;
}

/** Every file under the ink folder, path -> exact bytes, sorted by path. */
function inkFiles(adapter: FakeAdapter): Array<[string, string]> {
	return [...adapter.files].filter(([p]) => p.startsWith(".handwriting/")).sort(([a], [b]) => (a < b ? -1 : 1));
}

/** A fresh store over the same bytes, without the original session's objects or failures. */
function coldCopy(adapter: FakeAdapter): { adapter: FakeAdapter; store: PageStore } {
	const next = new FakeAdapter();
	for (const [path, bytes] of adapter.files) next.files.set(path, bytes);
	for (const [path, mtime] of adapter.mtimes) next.mtimes.set(path, mtime);
	for (const dir of adapter.dirs) next.dirs.add(dir);
	return { adapter: next, store: new PageStore({ vault: { adapter: next } } as never) };
}

async function drainMicrotasks(): Promise<void> {
	for (let i = 0; i < 400; i++) await Promise.resolve();
}

/**
 * The real vault adapter has `list` (the trash restore needs it), and a read can
 * fail. `failReads` counts down per path; the copy a reopen reads has neither.
 */
class VaultAdapter extends FakeAdapter {
	failReads = new Map<string, number>();
	override async read(path: string): Promise<string> {
		const left = this.failReads.get(path) ?? 0;
		if (left > 0) {
			this.failReads.set(path, left - 1);
			throw new Error(`EIO injected read ${path}`);
		}
		return super.read(path);
	}
	async list(dir: string): Promise<{ files: string[]; folders: string[] }> {
		const prefix = `${dir}/`;
		const files = [...this.files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"));
		if (files.length === 0 && !this.dirs.has(dir)) throw new Error(`ENOENT ${dir}`);
		return { files, folders: [] };
	}
}

// ---- a minimal presentation DOM (trimmed from SlidesInkSurface.test.ts) ---------------------

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

class FakeEl {
	readonly style: Record<string, string> = { position: "", touchAction: "" };
	readonly children: FakeEl[] = [];
	className = "";
	id = "";
	textContent = "";
	rect: Rect = { left: 0, top: 0, width: 0, height: 0 };
	clientWidth = 0;
	clientHeight = 0;
	isConnected = true;
	isContentEditable = false;
	parentElement: FakeEl | null = null;
	readonly classes = new Set<string>();
	readonly listeners: Array<{ type: string; fn: (ev: unknown) => void }> = [];
	readonly attributes = new Map<string, string>();
	readonly classList = {
		add: (c: string) => void this.classes.add(c),
		remove: (c: string) => void this.classes.delete(c),
		contains: (c: string) => this.classes.has(c),
		toggle: (c: string, on?: boolean) => {
			const want = on ?? !this.classes.has(c);
			if (want) this.classes.add(c);
			else this.classes.delete(c);
			return want;
		},
	};
	tabIndex = -1;
	width = 0;
	height = 0;
	constructor(
		readonly tagName: string,
		readonly ownerDocument: FakeDoc
	) {}
	createEl(tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): FakeEl {
		const child = this.ownerDocument.createElement(tag);
		if (options.text) child.textContent = options.text;
		if (options.cls) for (const cls of options.cls.split(" ")) child.classes.add(cls);
		for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
		this.appendChild(child);
		return child;
	}
	createDiv(options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): FakeEl {
		return this.createEl("div", options);
	}
	setText(text: string): void {
		this.textContent = text;
	}
	hasAttribute(name: string): boolean {
		return this.attributes.has(name);
	}
	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}
	setCssStyles(styles: Record<string, string>): void {
		Object.assign(this.style, styles);
	}
	addEventListener(type: string, fn: (ev: unknown) => void): void {
		this.listeners.push({ type, fn });
	}
	removeEventListener(type: string, fn: (ev: unknown) => void): void {
		const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn);
		if (i >= 0) this.listeners.splice(i, 1);
	}
	getBoundingClientRect(): Rect {
		return this.rect;
	}
	appendChild(child: FakeEl): void {
		if (child.parentElement) child.remove();
		this.children.push(child);
		child.parentElement = this;
	}
	remove(): void {
		const p = this.parentElement;
		if (p) {
			const i = p.children.indexOf(this);
			if (i >= 0) p.children.splice(i, 1);
		}
		this.parentElement = null;
	}
	contains(other: unknown): boolean {
		return other === this;
	}
	querySelector(): FakeEl | null {
		return null;
	}
	focus(): void {
		if (this.attributes.has("tabindex")) this.ownerDocument.activeElement = this;
	}
	blur(): void {
		if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
	}
	setPointerCapture(): void {}
	releasePointerCapture(): void {}
	getContext(): CanvasRenderingContext2D {
		return new Proxy(
			{},
			{
				get: (_t, prop) => (prop === "getContextAttributes" ? () => ({ desynchronized: false }) : () => undefined),
				set: () => true,
			}
		) as unknown as CanvasRenderingContext2D;
	}
	dispatch(ev: Record<string, unknown>): void {
		for (const l of this.listeners.slice()) if (l.type === ev.type) l.fn(ev);
	}
}

class FakeWin {
	devicePixelRatio = 1;
	navigator = undefined;
	setTimeout(): number {
		return 0;
	}
	clearTimeout(): void {}
	requestAnimationFrame(): number {
		return 0;
	}
	cancelAnimationFrame(): void {}
	getComputedStyle(): { position: string; backgroundColor: unknown } {
		return { position: "static", backgroundColor: undefined };
	}
	matchMedia(query: string): MediaQueryList {
		return {
			media: query,
			matches: true,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		} as unknown as MediaQueryList;
	}
	addEventListener(): void {}
	removeEventListener(): void {}
	readonly MutationObserver = class {
		observe(): void {}
		disconnect(): void {}
	};
}

class FakeDoc {
	activeElement: unknown = null;
	head = undefined;
	defaultView = new FakeWin();
	container: FakeEl | null = null;
	readonly body = {
		classList: { add: () => undefined, remove: () => undefined, contains: () => false },
		querySelector: (sel: string) => (sel === ":scope > .slides-container" ? this.container : null),
	};
	createElement(tag: string): FakeEl {
		return new FakeEl(tag, this);
	}
}

interface Presentation {
	doc: FakeDoc;
	reveal: FakeEl;
	slides: FakeEl;
	container: FakeEl;
	draw(points: Array<[number, number, number]>): void;
}

let clock = 0;

function presentation(sections = 3): Presentation {
	const doc = new FakeDoc();
	const container = new FakeEl("div", doc);
	const reveal = new FakeEl("div", doc);
	const slides = new FakeEl("div", doc);
	reveal.rect = { left: 0, top: 0, width: 1000, height: 800 };
	reveal.clientWidth = 1000;
	reveal.clientHeight = 800;
	slides.rect = { left: 20, top: 25, width: 480, height: 350 };
	slides.clientWidth = 960;
	slides.clientHeight = 700;
	for (let i = 0; i < sections; i++) {
		const s = new FakeEl("section", doc);
		s.textContent = `slide ${i}`;
		if (i === 0) s.classes.add("present");
		slides.children.push(s);
	}
	container.querySelector = ((sel: string) => (sel === ".reveal" ? reveal : null)) as never;
	reveal.querySelector = ((sel: string) => (sel === ".slides" ? slides : null)) as never;
	doc.container = container;
	const ev = (type: string, x: number, y: number, pressure: number, buttons = 1) => ({
		type,
		pointerId: 7,
		pointerType: "pen",
		isPrimary: true,
		buttons,
		button: 0,
		clientX: x,
		clientY: y,
		pressure,
		timeStamp: (clock += 16),
		preventDefault: () => undefined,
		stopPropagation: () => undefined,
	});
	return {
		doc,
		reveal,
		slides,
		container,
		draw(points) {
			const [first, ...rest] = points;
			reveal.dispatch(ev("pointerdown", first![0], first![1], first![2]));
			for (const [x, y, p] of rest) reveal.dispatch(ev("pointermove", x, y, p));
			const last = points[points.length - 1]!;
			reveal.dispatch(ev("pointerup", last[0], last[1], 0, 0));
		},
	};
}

const DECK_SOURCE = "slide 0\n\n---\n\nslide 1\n\n---\n\nslide 2";

function deckModel(deck: SlidesDeck): InkStroke[] {
	const map = (deck as unknown as { strokes: Map<number, InkStroke[]> }).strokes;
	return [...map.values()].flat();
}

function slideWord(x0: number, y0: number): Array<[number, number, number]> {
	return Array.from({ length: 12 }, (_, i) => [x0 - i * 4, y0 - i * 3 + (i % 2) * 2, r3(0.137 + i * 0.061)]);
}

function liveDeck(): SlidesDeck {
	let found: SlidesDeck | null = null;
	const spy = vi.spyOn(SlidesDeck.prototype, "reloadCandidateSidecarId").mockImplementation(function (this: SlidesDeck) {
		found = this;
		return null;
	});
	slidesReloadCandidate();
	spy.mockRestore();
	if (!found) throw new Error("no live deck mounted: startSlidesInk found no presentation");
	return found;
}


type Device = {
	adapter: VaultAdapter;
	store: PageStore;
	plugin: { startSlidesInk(): void; finishPersistence(): Promise<void> };
	ids: Map<string, string>;
	activeFile: string | null;
	loadOutcomes: string[];
};
function device(adapter = new VaultAdapter()): Device {
	const store = new PageStore({ vault: { adapter } } as never), d = {} as Device;
	const plugin = Object.create(HandwritingPlugin.prototype) as Device["plugin"];
	Object.assign(d, { adapter, store, plugin, ids: new Map(), activeFile: null, loadOutcomes: [] });
	Object.assign(plugin, {
		store, settings: { paperStyle: "lined", cameras: {} }, settingsDirty: false,
		settingsTimer: null, settingsWriting: null, settingsWriteAgain: false,
		saveData: async () => {}, manifest: { version: "slides-rejected-read-test" },
		app: {
			vault: { adapter, getFileByPath: (path: string) => ({ path }), cachedRead: async () => DECK_SOURCE },
			metadataCache: {
				getFileCache: (file: { path: string }) => ({
					frontmatter: d.ids.has(file.path) ? { "handwriting-page-id": d.ids.get(file.path) } : {},
				}),
			},
			workspace: { getActiveFile: () => d.activeFile ? { path: d.activeFile } : null, iterateAllLeaves: () => {} },
		},
		claimNotePageId: async (path: string, proposed: string) => {
			const pageId = d.ids.get(path) ?? proposed;
			d.ids.set(path, pageId);
			return { pageId };
		},
	});
	return d;
}
let unique = 0;
const fresh = (stem: string) => `${stem}-${++unique}`;
function present(d: Device, note: string) {
	const show = presentation(3);
	vi.stubGlobal("document", show.doc);
	d.activeFile = note;
	d.plugin.startSlidesInk();
	return { deck: liveDeck(), show };
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("window", globalThis);
	vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
	setPenToolsMode("hide");
});
afterEach(async () => {
	setSlidesInk(false);
	await drainMicrotasks();
	resetPenToolsForTest();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
async function reopenSlides(cold: { store: PageStore }, note: string, pageId: string): Promise<InkStroke[]> {
	const show = presentation(3);
	// Counted, not thrown: the deck catches a throwing host and logs it, so a
	// throw alone would let a reopen that writes pass silently.
	let writes = 0;
	const host: SlidesInkHost = {
		activeFilePath: () => note,
		readSource: async () => DECK_SOURCE,
		readPageId: () => pageId,
		claimId: async () => {
			throw new Error("a reopen must not claim");
		},
		newPageId: () => "unused",
		loadSidecar: (id) => cold.store.load(id),
		scheduleSidecar: () => {
			writes++;
		},
		saveSidecarNow: async () => {
			writes++;
		},
		nib: () => ({ tool: "pen", color: "#1e2a3b", width: 2.2 }),
		eraserRadiusPx: () => 12,
		eraseWholeStrokes: () => true,
		notify: () => undefined,
		buildId: "slides-rejected-read-test",
	};
	const reopened = new SlidesDeck(
		show.container as unknown as HTMLElement,
		show.reveal as unknown as HTMLElement,
		show.slides as unknown as HTMLElement,
		host
	);
	await drainMicrotasks();
	const strokes = deckModel(reopened);
	reopened.dispose();
	await drainMicrotasks();
	expect(writes, "the reopened deck wrote").toBe(0);
	return strokes;
}

type Regime = "absent" | "healthy" | "damaged" | "future" | "read-fails" | "rejected" | "load-rejects";
const REFUSING: Regime[] = ["damaged", "future", "read-fails", "rejected", "load-rejects"];
/** The regimes whose precondition is a load promise that REJECTED; asserted, not assumed. */
const REJECTING: Regime[] = ["rejected", "load-rejects"];

/**
 * Put `page` on disk the way `regime` needs it. Returns the ink-folder files a
 * refusing surface must leave exactly as they are after the load (the rejected
 * regime's load MOVES the trashed generation into place, so that is the state).
 *
 * `load-rejects` is the surface contract with no trigger of its own: the live
 * sidecar is present and `PageStore.load` rejects once for this id, touching
 * nothing. It keeps the surfaces' fail-closed rule guarded if the PageStore
 * trigger behind `rejected` is ever fixed and that regime stops rejecting.
 */
function arrange(d: Device & { adapter: VaultAdapter }, regime: Regime, page: PageData): Array<[string, string]> {
	const id = page.pageId;
	const good = serializePage(page);
	d.adapter.dirs.add(".handwriting");
	const realLoad = d.store.load.bind(d.store);
	let rejectNext = regime === "load-rejects";
	vi.spyOn(d.store, "load").mockImplementation(async (pageId: string) => {
		if (pageId !== id) return realLoad(pageId);
		if (rejectNext) {
			rejectNext = false;
			d.loadOutcomes.push("rejected");
			throw new Error("PageStore.load rejected");
		}
		try {
			const result = await realLoad(pageId);
			d.loadOutcomes.push("resolved");
			return result;
		} catch (err) {
			d.loadOutcomes.push("rejected");
			throw err;
		}
	});
	switch (regime) {
		case "absent": return [];
		case "load-rejects":
			d.adapter.externalWrite(sidecarPath(id), good);
			return [[sidecarPath(id), good]];
		case "healthy":
			d.adapter.externalWrite(sidecarPath(id), good);
			return [[sidecarPath(id), good]];
		case "damaged": {
			// A save cut off mid-file: valid JSON never closes.
			const cut = good.slice(0, Math.floor(good.length / 2));
			d.adapter.externalWrite(sidecarPath(id), cut);
			return [[sidecarPath(id), cut]];
		}
		case "future": {
			const future = serializePage(page, 99);
			d.adapter.externalWrite(sidecarPath(id), future);
			return [[sidecarPath(id), future]];
		}
		case "read-fails":
			d.adapter.externalWrite(sidecarPath(id), good);
			d.adapter.failReads.set(sidecarPath(id), 1);
			return [[sidecarPath(id), good]];
		case "rejected":
			// The note came back from Obsidian's trash; its ink was recycled.
			d.adapter.dirs.add(".handwriting/trash");
			d.adapter.externalWrite(`.handwriting/trash/${id}-1757700000000.json`, good);
			// main.ts's real recovery notices, with the note-name lookup throwing.
			bindRecoveryNotices(d.store, () => {
				throw new Error("note index not ready");
			});
			return [[sidecarPath(id), good]];
	}
}

/** Every timer, then the real unload flush. */
async function closeAndFlush(d: Device): Promise<void> {
	for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(2_000);
	setSlidesInk(false);
	const done = d.plugin.finishPersistence();
	for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(2_000);
	await done;
}


async function openRegime(regime: Regime, holdRead = false) {
	const d = device(), note = `${fresh("RejectedDeck")}.md`, pageId = fresh("deck-rejected"), id = slidesSidecarId(pageId);
	d.ids.set(note, pageId);
	const saved: [InkStroke, InkStroke] = [
		stroke(`${id}-s0`, -8.5, -6.25, "pen", { page: pageOfSlide(0) }),
		stroke(`${id}-s2`, 700, 500, "pen", { page: pageOfSlide(2) }),
	];
	const expected = arrange(d, regime, {
		...emptyPage(id), surface: "slides", coordSpace: "slide-logical", deck: { width: 960, height: 700 },
		slides: sectionHashes(DECK_SOURCE).map((hash, index) => ({ index, hash })), strokes: saved,
	});
	// Capture the implementation, not the spy wrapper that mockImplementation
	// mutates; calling that wrapper after replacement would recurse forever.
	const barrier = gate(), entered = gate(), load = vi.mocked(d.store.load).getMockImplementation()!;
	if (holdRead) vi.mocked(d.store.load).mockImplementation(async key => {
		entered.release();
		await barrier.promise;
		return load.call(d.store, key);
	});
	const shown = present(d, note);
	if (holdRead) await entered.promise;
	else await drainMicrotasks();
	return { d, note, pageId, id, saved, expected, barrier, ...shown };
}

describe("Slides rejected-read preservation through the production host", () => {
	it.each(["healthy", "absent"] as const)("%s is writable: drawing and close persist the complete model", async regime => {
		const r = await openRegime(regime);
		r.show.draw(slideWord(300, 300));
		const local = deckModel(r.deck).find(s => !r.saved.some(old => old.id === s.id))!;
		expect(local).toBeDefined();
		await closeAndFlush(r.d);
		// Persistence traverses slides in order; the new mark belongs beside the
		// existing mark on slide 0, before the saved mark on slide 2.
		const want = regime === "healthy" ? [r.saved[0], local, r.saved[1]] : [local];
		expect(model(onDisk(r.d.adapter, r.id)!)).toEqual(model(want));
		expect(model(await reopenSlides(coldCopy(r.d.adapter), r.note, r.pageId))).toEqual(model(want));
	});
	it.each(REFUSING)("%s keeps exact sidecar bytes after drawing, close, and fresh reopen", async regime => {
		const r = await openRegime(regime);
		r.show.draw(slideWord(300, 300));
		const local = deckModel(r.deck).find(s => !r.saved.some(old => old.id === s.id));
		expect(local, "input still commits in memory").toBeDefined();
		if (REJECTING.includes(regime)) expect(r.d.loadOutcomes[0], "actual load promise rejected").toBe("rejected");
		await closeAndFlush(r.d);
		expect(inkFiles(r.d.adapter), "failed read cannot authorize overwriting existing bytes").toEqual(r.expected);
		const cold = coldCopy(r.d.adapter);
		if (regime === "damaged") {
			expect((await cold.store.load(r.id))?.damaged).toBe(true);
			expect(inkFiles(cold.adapter)).toEqual(r.expected);
		} else expect(model(await reopenSlides(cold, r.note, r.pageId))).toEqual(model(r.saved));
	});
	it.each(REJECTING)("%s while a stroke is parked behind loading keeps the write lock", async regime => {
		const r = await openRegime(regime, true);
		r.show.draw(slideWord(300, 300));
		const local = deckModel(r.deck);
		expect(local).toHaveLength(1);
		r.barrier.release();
		await drainMicrotasks();
		expect(r.d.loadOutcomes[0]).toBe("rejected");
		expect(deckModel(r.deck)).toEqual(local);
		await closeAndFlush(r.d);
		expect(inkFiles(r.d.adapter)).toEqual(r.expected);
		expect(model(await reopenSlides(coldCopy(r.d.adapter), r.note, r.pageId))).toEqual(model(r.saved));
	});
	it("a new healthy presentation can read and save after a rejected session closes", async () => {
		const r = await openRegime("load-rejects");
		r.show.draw(slideWord(300, 300));
		await closeAndFlush(r.d);
		expect(inkFiles(r.d.adapter)).toEqual(r.expected);
		// Closing does not claim to recover unsaved session ink. Reopen re-reads the
		// intact original bytes; the new presentation owns a fresh writable state.
		const reopened = present(r.d, r.note);
		await drainMicrotasks();
		expect(model(deckModel(reopened.deck))).toEqual(model(r.saved));
		reopened.show.draw(slideWord(330, 330));
		const now = deckModel(reopened.deck);
		await closeAndFlush(r.d);
		expect(model(onDisk(r.d.adapter, r.id)!)).toEqual(model(now));
		expect(now).toHaveLength(3);
	});
});
