import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineInkStore } from "../inline/InlineInkStore";
import { PageStore } from "./PageStore";
import { FakeAdapter, gate } from "./FakeAdapter";
import { emptyPage, parsePage, serializePage } from "../model/PageData";

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("window", globalThis); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function page(...ids: string[]) {
  const p = emptyPage("review-page");
  p.surface = "inline";
  p.textBoxes = [{ id: "box", x: 10, y: 20, width: 300, z: 0 }];
  p.strokes = ids.map((id) => ({ id, tool: "pen" as const, color: "#000000", width: 2,
    createdAt: 0, points: [{ x: 10, y: 10, pressure: 0.5, t: 0 }],
    bbox: { x: 6, y: 6, width: 8, height: 8 } }));
  return p;
}
const file = (folder: string) => `${folder}/review-page.json`;
const strokeIds = (p: { strokes: readonly { id: string }[] }) => p.strokes.map(s => s.id);

function rig(folder = ".handwriting") {
  const adapter = new FakeAdapter();
  const disk = new PageStore({ vault: { adapter } }, folder);
  const ink = new InlineInkStore();
  const scheduled = gate();
  // Same three store adapters as main.ts, with only metadata and notices stubbed.
  ink.attachHost({ readPageId: () => "review-page", claimId: async (_p, pageId) => ({ pageId }),
    loadSidecar: id => disk.load(id), scheduleSidecar: (id, p) => { disk.schedule(id, p); scheduled.release(); },
    scheduleSidecarNow: (id, p) => disk.saveNow(id, p), notify: () => {} });
  return { adapter, disk, ink, scheduled: scheduled.promise };
}

function holdRead(adapter: FakeAdapter, path: string) {
  const blocked = gate(); const entered = gate(); const read = adapter.read.bind(adapter);
  let once = true;
  adapter.read = async p => {
    if (p === path && once) { once = false; entered.release(); await blocked.promise; }
    return read(p);
  };
  return { entered: entered.promise, release: blocked.release };
}

function holdExists(adapter: FakeAdapter, path: string) {
  const blocked = gate(); const entered = gate(); const exists = adapter.exists.bind(adapter);
  let once = true;
  adapter.exists = async p => {
    if (p === path && once) { once = false; entered.release(); await blocked.promise; }
    return exists(p);
  };
  return { entered: entered.promise, release: blocked.release };
}

describe("actual inline and disk store interaction", () => {
  it.each([
    [".handwriting", "handwriting", true],
    ["handwriting", ".handwriting", true],
    [".handwriting", ".handwriting", false],
  ] as const)("loads %s from %s (temporary=%s) and saves pending ink after recovery", async (configured, actual, temporary) => {
    const { adapter, disk, ink } = rig(configured);
    const source = file(actual) + (temporary ? ".tmp" : "");
    adapter.externalWrite(source, serializePage(page("saved")));
    const pause = holdRead(adapter, source);
    const owner = ink.ensureLoaded("note.md"); await pause.entered;
    const viewer = ink.ensureLoaded("note.md");
    ink.commit("note.md", page("new").strokes[0]!);
    expect(disk.hasQueuedWrite("review-page")).toBe(false);
    pause.release();
    expect(await Promise.all([owner, viewer])).toEqual([true, true]);
    expect(await ink.settle()).toBe(true); await disk.flush();
    const saved = parsePage(adapter.files.get(file(actual))!, "review-page").data;
    expect(strokeIds(saved)).toEqual(["saved", "new"]);
    expect(saved.textBoxes).toEqual(page().textBoxes);
    if (configured !== actual) expect(adapter.files.has(file(configured))).toBe(false);
    expect(adapter.files.has(file(actual) + ".tmp")).toBe(false);
  });

  it("restores a missing reread before its deferred write snapshots the page", async () => {
    const { adapter, disk, ink } = rig();
    adapter.externalWrite(file(".handwriting"), serializePage(page("saved")));
    await ink.ensureLoaded("note.md"); await adapter.remove(file(".handwriting"));
    const pause = holdExists(adapter, file(".handwriting"));
    const poller = ink.reloadExternal("note.md"); await pause.entered;
    const viewer = ink.ensureLoaded("note.md");
    ink.commit("note.md", page("new").strokes[0]!);
    pause.release();
    expect(await Promise.all([poller, viewer])).toEqual([true, true]);
    expect(await ink.settle()).toBe(true); await disk.flush();
    const saved = parsePage(adapter.files.get(file(".handwriting"))!, "review-page").data;
    expect(strokeIds(saved)).toEqual(["saved", "new"]);
    expect(saved.textBoxes).toEqual(page().textBoxes);
  });

  it("keeps damaged bytes locked while returning restored ink to the joining viewer", async () => {
    const { adapter, disk, ink } = rig();
    const path = file(".handwriting");
    adapter.externalWrite(path, serializePage(page("saved"))); await ink.ensureLoaded("note.md");
    adapter.externalWrite(path, "{partial"); const pause = holdRead(adapter, path);
    const poller = ink.reloadExternal("note.md"); await pause.entered;
    const viewer = ink.ensureLoaded("note.md"); ink.commit("note.md", page("new").strokes[0]!);
    pause.release(); expect(await Promise.all([poller, viewer])).toEqual([true, true]);
    expect(await ink.settle()).toBe(true); await disk.flush();
    expect(ink.isDamagedLocked("note.md")).toBe(true);
    expect(strokeIds({ strokes: ink.strokes("note.md") })).toEqual(["saved", "new"]);
    expect(adapter.files.get(path)).toBe("{partial"); expect(adapter.writes()).toEqual([]);
  });

  it("preserves a later remote revision when metadata fails after a reload with pending ink", async () => {
    const { adapter, disk, ink, scheduled } = rig(); const path = file(".handwriting");
    adapter.externalWrite(path, serializePage(page("initial"))); await ink.ensureLoaded("note.md");
    adapter.externalWrite(path, serializePage(page("remote-read"))); const pause = holdRead(adapter, path);
    const poller = ink.reloadExternal("note.md"); await pause.entered;
    const writing = gate(); const writeEntered = gate(); const write = adapter.write.bind(adapter);
    adapter.write = async (p, text) => { writeEntered.release(); await writing.promise; return write(p, text); };
    ink.commit("note.md", page("local").strokes[0]!); pause.release(); await poller; await scheduled;
    const flush = disk.flush(); await writeEntered.promise;
    adapter.externalWrite(path, serializePage(page("remote-later")));
    adapter.stat = async () => { throw new Error("EIO metadata"); };
    writing.release(); await flush;
    expect(strokeIds(parsePage(adapter.files.get(path)!, "review-page").data)).toEqual(["remote-read", "local"]);
    const conflicts = [...adapter.files.entries()].filter(([p]) => p.includes(".conflict-"));
    expect(conflicts).toHaveLength(1);
    expect(strokeIds(parsePage(conflicts[0]![1], "review-page").data)).toEqual(["remote-later"]);
  });

  it("recycles a relocated sidecar together with the inline store's queued ink", async () => {
    const { adapter, disk, ink } = rig();
    adapter.externalWrite(file(".handwriting"), serializePage(page("saved")));
    await ink.ensureLoaded("note.md");
    ink.commit("note.md", page("new").strokes[0]!);
    await adapter.rename(file(".handwriting"), file("handwriting"));
    await disk.remove("review-page");
    const generations = [...adapter.files.entries()].filter(([p]) => p.includes("/trash/"));
    expect(generations).toHaveLength(1);
    expect(generations[0]![0].startsWith("handwriting/trash/")).toBe(true);
    expect(strokeIds(parsePage(generations[0]![1], "review-page").data)).toEqual(["saved", "new"]);
    expect(adapter.files.has(file(".handwriting"))).toBe(false);
    expect(adapter.files.has(file("handwriting"))).toBe(false);
  });

  it("keeps a valid empty remote page empty", async () => {
    const { adapter, disk, ink } = rig(); const path = file(".handwriting");
    adapter.externalWrite(path, serializePage(page("saved"))); await ink.ensureLoaded("note.md");
    adapter.externalWrite(path, serializePage(page())); const pause = holdRead(adapter, path);
    const poller = ink.reloadExternal("note.md"); await pause.entered;
    const viewer = ink.ensureLoaded("note.md"); pause.release();
    expect(await Promise.all([poller, viewer])).toEqual([true, false]);
    expect(ink.strokes("note.md")).toEqual([]); await disk.flush(); expect(adapter.writes()).toEqual([]);
  });

  it.each([true, false])("repair after a damaged read keeps every stroke id unique (cached ink=%s)", async (cached) => {
    const { adapter, disk, ink } = rig(); const path = file(".handwriting");
    if (cached) { adapter.externalWrite(path, serializePage(page("saved"))); await ink.ensureLoaded("note.md"); }
    adapter.externalWrite(path, "{partial");
    if (cached) await ink.reloadExternal("note.md"); else await ink.ensureLoaded("note.md");
    expect(ink.isDamagedLocked("note.md")).toBe(true);
    ink.commit("note.md", page("local").strokes[0]!);
    adapter.externalWrite(path + ".tmp", serializePage(page("saved")));
    await ink.ensureLoaded("note.md"); await ink.settle(); await disk.flush();
    expect(ink.isDamagedLocked("note.md")).toBe(false);
    const ids = strokeIds({ strokes: ink.strokes("note.md") });
    expect.soft(ids).toEqual(["saved", "local"]);
    expect.soft(strokeIds(parsePage(adapter.files.get(path)!, "review-page").data)).toEqual(["saved", "local"]);
  });

  it.each([false, true])("settle and flush include a mutation racing a reread (start drain while loading=%s)", async (early) => {
    const { adapter, disk, ink } = rig(); const path = file(".handwriting");
    adapter.externalWrite(path, serializePage(page("initial"))); await ink.ensureLoaded("note.md");
    adapter.externalWrite(path, serializePage(page("remote"))); const pause = holdRead(adapter, path);
    const poller = ink.reloadExternal("note.md"); await pause.entered;
    ink.commit("note.md", page("local").strokes[0]!);
    async function drain() { expect(await ink.settle()).toBe(true); await disk.flush(); }
    const draining = early ? drain() : null;
    pause.release(); await poller;
    if (draining) await draining; else await drain();
    expect.soft(strokeIds(parsePage(adapter.files.get(path)!, "review-page").data)).toEqual(["remote", "local"]);
    expect.soft(disk.hasQueuedWrite("review-page")).toBe(false);
  });
});

// Recovery merges identities, not two complete page snapshots. These use the
// production PageStore's parser, queue and flush behind deterministic I/O gates.
describe("repaired sidecar identity adoption", () => {
  async function damagedCache(ids = ["saved"]) {
    const r = rig(); const path = file(".handwriting");
    r.adapter.externalWrite(path, serializePage(page(...ids)));
    await r.ink.ensureLoaded("note.md");
    r.adapter.externalWrite(path, "{partial");
    await r.ink.reloadExternal("note.md");
    expect(r.ink.isDamagedLocked("note.md")).toBe(true);
    return { ...r, path };
  }

  async function flush(r: ReturnType<typeof rig>) {
    expect(await r.ink.settle()).toBe(true);
    await r.disk.flush();
    expect(r.disk.hasQueuedWrite("review-page")).toBe(false);
    return parsePage(r.adapter.files.get(file(".handwriting"))!, "review-page").data;
  }

  it("uses changed remote content for a merely cached ID even when another local ID was added", async () => {
    const r = await damagedCache(["saved", "removed-remotely"]);
    r.ink.commit("note.md", page("local").strokes[0]!);
    // An idempotent history add does not count as editing the cached stroke.
    r.ink.applyAdd("note.md", [page("saved").strokes[0]!]);
    const remote = page("remote-first", "saved");
    remote.strokes[1]!.color = "#ff0000";
    remote.strokes[1]!.points[0]!.x = 80;
    remote.strokes[1]!.bbox.x = 76;
    remote.textBoxes[0]!.x = 777;
    remote.unknownTop = { remoteMetadata: "preserved" };
    r.adapter.externalWrite(r.path, serializePage(remote));
    expect(await r.ink.ensureLoaded("note.md")).toBe(true);
    const saved = await flush(r);
    expect(strokeIds(saved)).toEqual(["remote-first", "saved", "local"]);
    expect(saved.strokes[1]).toEqual(remote.strokes[1]);
    expect(saved.textBoxes).toEqual(remote.textBoxes);
    expect(saved.unknownTop).toEqual(remote.unknownTop);
    expect(r.ink.strokes("note.md")).toEqual(saved.strokes);
  });

  it.each(["move", "replace", "live-replace"] as const)("keeps an explicitly %s local version of a remotely changed ID", async (operation) => {
    const r = await damagedCache(["saved", "other"]);
    if (operation === "move") {
      r.ink.moveStrokes("note.md", ["saved"], 30, 40);
    } else {
      const changed = page("saved").strokes[0]!;
      changed.color = "#00ff00";
      if (operation === "replace") {
        r.ink.applyRemove("note.md", ["saved"]);
        r.ink.applyAdd("note.md", [changed], [0]);
      } else {
        r.ink.takeLive("note.md", ["saved"]);
        r.ink.applyAddLive("note.md", [changed], [0]);
      }
    }
    r.ink.save("note.md");
    const local = structuredClone(r.ink.strokes("note.md")[0]);
    const remote = page("other", "saved", "remote-last");
    remote.strokes[1]!.color = "#ff0000";
    r.adapter.externalWrite(r.path, serializePage(remote));
    await r.ink.ensureLoaded("note.md");
    const saved = await flush(r);
    expect(strokeIds(saved)).toEqual(["other", "saved", "remote-last"]);
    expect(saved.strokes[1]).toEqual(local);
  });

  it.each(["reload", "retry"] as const)("applies move, delete and add while a %s read is in flight", async (phase) => {
    const r = phase === "retry" ? await damagedCache(["moved", "deleted", "unchanged"]) : { ...rig(), path: file(".handwriting") };
    if (phase === "reload") {
      r.adapter.externalWrite(r.path, serializePage(page("moved", "deleted", "unchanged")));
      await r.ink.ensureLoaded("note.md");
    }
    const remote = page("unchanged", "deleted", "moved", "remote");
    remote.strokes[2]!.color = "#ff0000";
    r.adapter.externalWrite(r.path, serializePage(remote));
    const pause = holdRead(r.adapter, r.path);
    const owner = phase === "retry" ? r.ink.ensureLoaded("note.md") : r.ink.reloadExternal("note.md");
    await pause.entered;
    const viewer = r.ink.ensureLoaded("note.md");
    r.ink.moveStrokes("note.md", ["moved"], 25, 5);
    expect(r.ink.applyRemove("note.md", ["deleted"])).toHaveLength(1);
    r.ink.commit("note.md", page("local").strokes[0]!);
    pause.release();
    expect(await Promise.all([owner, viewer])).toEqual([true, true]);
    const saved = await flush(r);
    expect(strokeIds(saved)).toEqual(["unchanged", "moved", "remote", "local"]);
    expect(saved.strokes[1]!.bbox).toMatchObject({ x: 31, y: 11 });
    expect(saved.strokes[1]!.color).toBe("#000000");
  });

  it("does not resurrect a local deletion after another failed repair read", async () => {
    const r = await damagedCache();
    r.ink.applyRemove("note.md", ["saved"]);
    expect(await r.ink.ensureLoaded("note.md")).toBe(false);
    expect(r.ink.isDamagedLocked("note.md")).toBe(true);
    expect(await r.ink.settle()).toBe(true); await r.disk.flush();
    expect(r.adapter.files.get(r.path)).toBe("{partial");
    r.adapter.externalWrite(r.path, serializePage(page("saved")));
    await r.ink.ensureLoaded("note.md");
    expect(strokeIds(await flush(r))).toEqual([]);
  });

  it.each([false, true])("repaints cached ink removed by an empty repair (local ink=%s)", async (withLocal) => {
    const r = await damagedCache();
    if (withLocal) r.ink.commit("note.md", page("local").strokes[0]!);
    r.adapter.externalWrite(r.path, serializePage(page()));
    const pause = holdRead(r.adapter, r.path);
    const expected = withLocal ? ["local"] : [];
    // InkOverlay.loadInk repaints only on a true completion. Both a retry
    // owner and a joining viewer may already display the old cached ink.
    let ownerPicture = strokeIds({ strokes: r.ink.strokes("note.md") });
    let viewerPicture = [...ownerPicture];
    const owner = r.ink.ensureLoaded("note.md").then(changed => {
      if (changed) ownerPicture = strokeIds({ strokes: r.ink.strokes("note.md") });
      return changed;
    });
    await pause.entered;
    const viewer = r.ink.ensureLoaded("note.md").then(changed => {
      if (changed) viewerPicture = strokeIds({ strokes: r.ink.strokes("note.md") });
      return changed;
    });
    expect(ownerPicture).toContain("saved");
    expect(viewerPicture).toContain("saved");
    pause.release();
    expect(await Promise.all([owner, viewer])).toEqual([true, true]);
    expect(ownerPicture).toEqual(expected);
    expect(viewerPicture).toEqual(expected);
    expect(strokeIds(await flush(r))).toEqual(expected);
  });

  it("keeps the initial empty-load completion false for owner and joining viewer", async () => {
    const r = rig(); const path = file(".handwriting");
    r.adapter.externalWrite(path, serializePage(page()));
    const pause = holdRead(r.adapter, path);
    const owner = r.ink.ensureLoaded("note.md"); await pause.entered;
    const viewer = r.ink.ensureLoaded("note.md"); pause.release();
    expect(await Promise.all([owner, viewer])).toEqual([false, false]);
    expect(r.ink.strokes("note.md")).toEqual([]);
    expect(r.adapter.writes()).toEqual([]);
  });
  it.each(["missing", "damaged", "io-error"] as const)("keeps local deletes and moves through %s reload fallback", async (failure) => {
    const r = rig(); const path = file(".handwriting");
    r.adapter.externalWrite(path, serializePage(page("deleted", "moved")));
    await r.ink.ensureLoaded("note.md");
    const pause = failure === "missing" ? holdExists(r.adapter, path) : holdRead(r.adapter, path);
    if (failure === "missing") await r.adapter.remove(path);
    if (failure === "damaged") r.adapter.externalWrite(path, "{partial");
    if (failure === "io-error") {
      const read = r.adapter.read.bind(r.adapter);
      r.adapter.read = async p => { await read(p); throw new Error("EIO read"); };
    }
    const owner = r.ink.reloadExternal("note.md"); await pause.entered;
    const viewer = r.ink.ensureLoaded("note.md");
    r.ink.applyRemove("note.md", ["deleted"]);
    r.ink.moveStrokes("note.md", ["moved"], 30, 0); r.ink.save("note.md");
    pause.release();
    expect(await Promise.all([owner, viewer])).toEqual([true, true]);
    expect(strokeIds({ strokes: r.ink.strokes("note.md") })).toEqual(["moved"]);
    expect(r.ink.strokes("note.md")[0]!.bbox.x).toBe(36);
    expect(await r.ink.settle()).toBe(true); await r.disk.flush();
    if (failure === "missing") {
      const saved = parsePage(r.adapter.files.get(path)!, "review-page").data;
      expect(strokeIds(saved)).toEqual(["moved"]);
      expect(saved.textBoxes).toEqual(page().textBoxes);
    } else {
      expect(r.ink.isDamagedLocked("note.md")).toBe(true);
      expect(r.adapter.writes()).toEqual([]);
    }
  });
});
