import { describe, expect, it, vi } from "vitest";
import { emptyPage, type ParseResult } from "../model/PageData";
import { InlineInkStore, type InlineInkHost } from "./InlineInkStore";
import type { InkStroke } from "../ink/Stroke";

function result(ink: boolean): ParseResult {
	const data = emptyPage("shared");
	data.surface = "inline";
	if (ink) data.strokes = [{
		id: "saved", tool: "pen", color: "#000000", width: 2, createdAt: 0,
		points: [{ x: 10, y: 10, pressure: 0.5, t: 0 }],
		bbox: { x: 8, y: 8, width: 4, height: 4 },
	} satisfies InkStroke];
	return { data, recovered: false };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function rig() {
	const read = deferred<ParseResult | null>();
	const host: InlineInkHost = {
		readPageId: () => "shared",
		claimId: async (_path, pageId) => ({ pageId }),
		loadSidecar: vi.fn(() => read.promise),
		scheduleSidecar: vi.fn(),
		notify: vi.fn(),
	};
	const store = new InlineInkStore();
	store.attachHost(host);
	return { store, host, read };
}

describe("joined inline sidecar reads", () => {
	it.each([true, false])("all callers await one read and share changed=%s", async (ink) => {
		const { store, host, read } = rig();
		const owner = store.ensureLoaded("note.md");
		let joinedSettled = false;
		const joined = store.ensureLoaded("note.md").then((changed) => {
			joinedSettled = true;
			return changed;
		});
		// Only a promise checkpoint; the file read is still explicitly held.
		await Promise.resolve();
		expect(joinedSettled, "a joined load resolved before its file read").toBe(false);
		read.resolve(result(ink));
		expect(await Promise.all([owner, joined])).toEqual([ink, ink]);
		expect(host.loadSidecar).toHaveBeenCalledTimes(1);
		expect(await store.ensureLoaded("note.md")).toBe(false);
		expect(host.loadSidecar).toHaveBeenCalledTimes(1);
	});

	it("joins a damaged sidecar's repair read without duplicating notices or writes", async () => {
		const { store, host, read } = rig();
		const initial = store.ensureLoaded("note.md");
		read.resolve({ ...result(false), damaged: true });
		expect(await initial).toBe(false);
		expect(store.isDamagedLocked("note.md")).toBe(true);
		const repair = deferred<ParseResult | null>();
		vi.mocked(host.loadSidecar).mockImplementation(() => repair.promise);
		const owner = store.ensureLoaded("note.md");
		const joined = store.ensureLoaded("note.md");
		repair.resolve(result(true));
		expect(await Promise.all([owner, joined])).toEqual([true, true]);
		expect(store.isDamagedLocked("note.md")).toBe(false);
		expect(host.loadSidecar).toHaveBeenCalledTimes(2);
		expect(host.notify).toHaveBeenCalledTimes(2); // initial damage and one recovery
		expect(host.scheduleSidecar).toHaveBeenCalledTimes(1);
	});

	it("keeps the persistence barrier non-rejecting on a failed read", async () => {
		const { store, read } = rig();
		const owner = store.ensureLoaded("note.md");
		const joined = store.ensureLoaded("note.md");
		const rejection = expect(owner).rejects.toThrow("read failed");
		read.reject(new Error("read failed"));
		await rejection;
		expect(await joined).toBe(false);
	});
});

describe("joined reload finalization", () => {
	it("a successful empty reload stays empty for both poller and joining viewer", async () => {
		const { store, host, read } = rig();
		const first = store.ensureLoaded("note.md");
		read.resolve(result(true));
		await first;
		const reloadRead = deferred<ParseResult | null>();
		vi.mocked(host.loadSidecar).mockImplementation(() => reloadRead.promise);
		const poller = store.reloadExternal("note.md");
		const viewer = store.ensureLoaded("note.md");
		reloadRead.resolve(result(false));
		expect(await poller).toBe(true);
		expect(await viewer).toBe(false);
		expect(store.strokes("note.md")).toEqual([]);
		expect(host.scheduleSidecar).not.toHaveBeenCalled();
	});

	it("a missing page id restores the cache without a sidecar read", async () => {
		const { store, host, read } = rig();
		const first = store.ensureLoaded("note.md");
		read.resolve(result(true));
		await first;
		host.readPageId = () => null;
		expect(await store.reloadExternal("note.md")).toBe(false);
		expect(store.strokes("note.md").map((s) => s.id)).toEqual(["saved"]);
		expect(store.isLoaded("note.md")).toBe(true);
		expect(host.loadSidecar).toHaveBeenCalledTimes(1);
	});

	it.each([false, true])("preserves strokes added during a failed reload (damaged=%s)", async (damaged) => {
		const { store, host, read } = rig();
		const first = store.ensureLoaded("note.md");
		read.resolve(result(true));
		await first;
		const reloadRead = deferred<ParseResult | null>();
		vi.mocked(host.loadSidecar).mockImplementation(() => reloadRead.promise);
		const poller = store.reloadExternal("note.md");
		const viewer = store.ensureLoaded("note.md");
		const fresh = { ...result(true).data.strokes[0]!, id: "new" };
		store.commit("note.md", fresh);
		expect(host.scheduleSidecar).not.toHaveBeenCalled();
		reloadRead.resolve(damaged ? { ...result(false), damaged: true } : null);
		await Promise.all([poller, viewer]);
		expect(store.strokes("note.md").map((s) => s.id)).toEqual(["saved", "new"]);
		if (damaged) {
			expect(store.isDamagedLocked("note.md")).toBe(true);
			expect(host.scheduleSidecar).not.toHaveBeenCalled();
		} else {
			const writes = vi.mocked(host.scheduleSidecar).mock.calls;
			expect(writes.length).toBeGreaterThan(0);
			for (const [, page] of writes) expect(page.strokes.map((s) => s.id)).toEqual(["saved", "new"]);
		}
	});
});

it("restoring a failed reload keeps the session version of a duplicate stroke id", async () => {
	const { store, host, read } = rig();
	const data = result(true);
	data.data.strokes.unshift({ ...data.data.strokes[0]!, id: "older" });
	const first = store.ensureLoaded("note.md");
	read.resolve(data);
	await first;
	const reread = deferred<ParseResult | null>();
	vi.mocked(host.loadSidecar).mockImplementation(() => reread.promise);
	const reload = store.reloadExternal("note.md");
	const viewer = store.ensureLoaded("note.md");
	const local = {
		...result(true).data.strokes[0]!,
		points: [{ x: 120, y: 100, pressure: 0.5, t: 0 }],
		bbox: { x: 118, y: 98, width: 4, height: 4 },
	};
	store.commit("note.md", local);
	expect(host.scheduleSidecar).not.toHaveBeenCalled();
	reread.resolve(null);
	await Promise.all([reload, viewer]);
	const restored = store.strokes("note.md");
	expect(restored.map((s) => s.id)).toEqual(["older", "saved"]);
	expect(restored[1]).toEqual(local);
	const writes = vi.mocked(host.scheduleSidecar).mock.calls;
	expect(writes.length).toBeGreaterThan(0);
	for (const [, page] of writes) expect(page.strokes).toEqual(restored);
});
