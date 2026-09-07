/**
 * Recovery, conflict and recycle paths on the sidecar store, driven from the
 * fake adapter with faults injected: an interrupted save left in the folder
 * the page was served from (not the configured one), a stat that fails while
 * reads and writes still work, and a pinned path that sync has moved or
 * removed by the time the note is deleted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageStore } from "./PageStore";
import { FakeAdapter } from "./FakeAdapter";
import { emptyPage, serializePage } from "../model/PageData";

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("window", globalThis);
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function page(id: string, label: string) {
	const p = emptyPage(id);
	p.surface = "inline";
	p.strokes = [
		{
			id: label,
			tool: "pen",
			color: "#4b7bec",
			width: 2.2,
			points: [
				{ x: 0, y: 0, pressure: 0.5, t: 0 },
				{ x: 10, y: 0, pressure: 0.5, t: 8 },
			],
			bbox: { x: 0, y: 0, width: 10, height: 0 },
			createdAt: 0,
		},
	];
	return p;
}

const strokeOf = (r: { data: { strokes: { id: string }[] } } | null) => r?.data.strokes[0]?.id;

describe("an interrupted save is recovered from the folder it was made in", () => {
	it("from .handwriting when the configured folder is handwriting", async () => {
		const a = new FakeAdapter();
		a.externalWrite(".handwriting/p.json.tmp", serializePage(page("p", "new")));
		const store = new PageStore({ vault: { adapter: a } }, "handwriting");
		expect(strokeOf(await store.load("p"))).toBe("new");
		expect(a.files.has(".handwriting/p.json")).toBe(true);
		expect(a.files.has(".handwriting/p.json.tmp")).toBe(false);
		expect(a.files.has("handwriting/p.json")).toBe(false);
		// And the recovered file is where the next save goes, not the
		// configured folder: one live sidecar, in the folder sync carries.
		await store.saveNow("p", page("p", "next"));
		expect(a.files.get(".handwriting/p.json")).toContain("next");
		expect(a.files.has("handwriting/p.json")).toBe(false);
	});

	it("from a well-known folder when the configured folder is custom", async () => {
		const a = new FakeAdapter();
		a.externalWrite("handwriting/p.json.tmp", serializePage(page("p", "new")));
		const store = new PageStore({ vault: { adapter: a } }, "assets/ink");
		expect(strokeOf(await store.load("p"))).toBe("new");
		expect(a.files.has("handwriting/p.json")).toBe(true);
		expect(a.files.has("handwriting/p.json.tmp")).toBe(false);
		expect(a.files.has("assets/ink/p.json")).toBe(false);
	});

	it("does not promote a corrupt temporary from the other folder", async () => {
		const a = new FakeAdapter();
		a.externalWrite("handwriting/p.json.tmp", "{ not json");
		const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
		const r = await store.load("p");
		expect(r?.damaged).toBe(true);
		expect(a.files.has("handwriting/p.json.tmp")).toBe(true);
		expect(a.files.has("handwriting/p.json")).toBe(false);
		expect(a.files.has(".handwriting/p.json")).toBe(false);
	});

	it("prefers the configured folder's temporary when both folders hold one", async () => {
		const a = new FakeAdapter();
		a.externalWrite(".handwriting/p.json.tmp", serializePage(page("p", "configured")));
		a.externalWrite("handwriting/p.json.tmp", serializePage(page("p", "fallback")));
		const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
		expect(strokeOf(await store.load("p"))).toBe("configured");
		expect(a.files.has(".handwriting/p.json")).toBe(true);
		// The loser is left exactly where it was: nothing chooses between
		// two complete pages by discarding one.
		expect(a.files.has("handwriting/p.json.tmp")).toBe(true);
		expect(a.files.has("handwriting/p.json")).toBe(false);
	});

	it("promotes the intact temporary over a corrupt one in the configured folder", async () => {
		const a = new FakeAdapter();
		a.externalWrite(".handwriting/p.json.tmp", "{ not json");
		a.externalWrite("handwriting/p.json.tmp", serializePage(page("p", "fallback")));
		const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
		const r = await store.load("p");
		expect(r?.damaged).toBeFalsy();
		expect(strokeOf(r)).toBe("fallback");
		expect(a.files.has("handwriting/p.json")).toBe(true);
		expect(a.files.has(".handwriting/p.json.tmp")).toBe(true);
		expect(a.files.has(".handwriting/p.json")).toBe(false);
	});

	it("never promotes a temporary that belongs to another page", async () => {
		const a = new FakeAdapter();
		a.externalWrite("handwriting/p.json.tmp", serializePage(page("someone-else", "theirs")));
		const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
		expect(await store.load("p")).toBeNull();
		expect(a.files.has("handwriting/p.json.tmp")).toBe(true);
		expect(a.files.has("handwriting/p.json")).toBe(false);
		expect(a.files.has(".handwriting/p.json")).toBe(false);
	});
});

describe("a save whose stat fails", () => {
	it("still lands when the content on disk is the one this session wrote", async () => {
		const a = new FakeAdapter();
		a.externalWrite(".handwriting/p.json", serializePage(page("p", "old")));
		const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
		await store.load("p");
		a.stat = async () => {
			throw new Error("EIO stat only");
		};
		await store.saveNow("p", page("p", "local"));
		expect(a.files.get(".handwriting/p.json")).toContain("local");
		expect([...a.files.keys()].some((k) => k.includes(".conflict-"))).toBe(false);
	});

	it("preserves a file whose identity it cannot establish", async () => {
		const a = new FakeAdapter();
		a.externalWrite(".handwriting/p.json", serializePage(page("p", "old")));
		const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
		await store.load("p");
		a.externalWrite(".handwriting/p.json", serializePage(page("p", "remote")));
		a.stat = async () => {
			throw new Error("EIO stat only");
		};
		a.read = async () => {
			throw new Error("EIO read too");
		};
		await store.saveNow("p", page("p", "local"));
		const conflict = [...a.files.keys()].find((k) => k.includes(".conflict-"));
		expect(conflict).toBeDefined();
		expect(a.files.get(conflict!)).toContain("remote");
		expect(a.files.get(".handwriting/p.json")).toContain("local");
	});
});

describe("deleting a note whose pinned sidecar has moved", () => {
	it("recycles the queued ink beside the last known home when the file is gone everywhere", async () => {
		const a = new FakeAdapter();
		a.externalWrite("handwriting/p.json", serializePage(page("p", "old")));
		const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
		await store.load("p");
		// Sync deletes the file under the open note; a stroke is still queued.
		await a.remove("handwriting/p.json");
		store.schedule("p", page("p", "queued"));
		await store.remove("p");
		const generations = [...a.files.keys()].filter((k) => k.includes("/trash/"));
		expect(generations.length).toBe(1);
		expect(generations[0]!.startsWith("handwriting/trash/")).toBe(true);
		expect(a.files.get(generations[0]!)).toContain("queued");
		expect(a.files.has("handwriting/p.json")).toBe(false);
		expect(a.files.has(".handwriting/p.json")).toBe(false);
	});

	it("recycles the moved file and the queued ink beside it", async () => {
		const a = new FakeAdapter();
		a.externalWrite(".handwriting/p.json", serializePage(page("p", "old")));
		const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
		await store.load("p");
		await a.rename(".handwriting/p.json", "handwriting/p.json");
		store.schedule("p", page("p", "queued"));
		await store.remove("p");
		const generations = [...a.files.keys()].filter((k) => k.includes("/trash/"));
		expect(generations.length).toBe(1);
		expect(generations[0]!.startsWith("handwriting/trash/")).toBe(true);
		expect(a.files.get(generations[0]!)).toContain("queued");
		expect(a.files.has("handwriting/p.json")).toBe(false);
		expect(a.files.has(".handwriting/p.json")).toBe(false);
	});
});
