import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageStore } from "./PageStore";
import { FakeAdapter } from "./FakeAdapter";
import { emptyPage, serializePage } from "../model/PageData";

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", globalThis); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function page(label: string) {
  const p = emptyPage("audit-page");
  p.surface = "inline";
  p.strokes = [{ id: label, tool: "pen", color: "#4b7bec", width: 2.2,
    points: [{ x: 0, y: 0, pressure: 0.5, t: 0 }, { x: 10, y: 0, pressure: 0.5, t: 8 }],
    bbox: { x: 0, y: 0, width: 10, height: 0 }, createdAt: 0 }];
  return p;
}

it.each([".handwriting", "handwriting"])("recovers an interrupted write stored in %s after restart", async (home) => {
  const a = new FakeAdapter();
  a.externalWrite(`${home}/audit-page.json`, serializePage(page("old")));
  const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
  expect((await store.load("audit-page"))?.data.strokes[0]?.id).toBe("old");
  a.failRenameTimes = 1;
  a.failRenameWhen = (from) => from.endsWith(".tmp");
  await store.saveNow("audit-page", page("new"));
  expect(a.files.has(`${home}/audit-page.json`)).toBe(false);
  expect(a.files.has(`${home}/audit-page.json.tmp`)).toBe(true);
  vi.clearAllTimers(); // Simulated process termination before retry.
  const restarted = new PageStore({ vault: { adapter: a } }, ".handwriting");
  expect((await restarted.load("audit-page"))?.data.strokes[0]?.id).toBe("new");
});

it.each([false, true])("preserves an external revision (stat rejects: %s)", async (statFails) => {
  const a = new FakeAdapter();
  a.externalWrite(".handwriting/audit-page.json", serializePage(page("old")));
  const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
  await store.load("audit-page");
  a.externalWrite(".handwriting/audit-page.json", serializePage(page("remote")));
  if (statFails) a.stat = async () => { throw new Error("EIO stat only"); };
  await store.saveNow("audit-page", page("local"));
  const surviving = [...a.files.values()].map((s) => JSON.parse(s).strokes.map((p: {id: string}) => p.id));
  expect(surviving.flat()).toContain("remote");
});

it.each([false, true])("recycles the actual sidecar (sync moved pinned path: %s)", async (moved) => {
  const a = new FakeAdapter();
  a.externalWrite(".handwriting/audit-page.json", serializePage(page("old")));
  const store = new PageStore({ vault: { adapter: a } }, ".handwriting");
  await store.load("audit-page");
  if (moved) await a.rename(".handwriting/audit-page.json", "handwriting/audit-page.json");
  await store.remove("audit-page");
  expect(a.files.has("handwriting/audit-page.json")).toBe(false);
  expect(a.files.has(".handwriting/audit-page.json")).toBe(false);
  expect([...a.files.keys()].some((p) => p.includes("/trash/"))).toBe(true);
});
