/**
 * `InlineInkStore.inkPresence` - the difference between "this note has no
 * ink" and "nobody has looked".
 *
 * `hasInk` collapses both into `false`, and every caller that turns that
 * `false` into a sentence for a human says the first when it means the
 * second. That is the "even though there is" half of Alan's 1.4.12 eraser
 * report: the note was full of ink, the sidecar simply had not been read into
 * the session yet.
 *
 * The cheap-certainty case is the one worth pinning hardest. A note with no
 * `handwriting-page-id` can have no sidecar - they are keyed by id - so it is
 * certainly empty off one metadata lookup, with no file read at all. Without
 * that, every untouched note in the vault would answer "unknown" and cost a
 * caller a disk read to be told what the metadata already knew.
 */

import { describe, expect, it } from "vitest";
import { InlineInkStore, InlineInkHost } from "./InlineInkStore";
import { PageData, ParseResult, emptyPage } from "../model/PageData";
import { InkStroke } from "../ink/Stroke";

function stroke(id: string): InkStroke {
	return {
		id,
		tool: "pen",
		color: "#000000",
		width: 2,
		points: [
			{ x: 0, y: 0, pressure: 0.5, t: 0 },
			{ x: 10, y: 0, pressure: 0.5, t: 8 },
		],
		bbox: { x: 0, y: 0, width: 10, height: 0 },
		createdAt: 0,
	} as InkStroke;
}

function inkedPage(id: string): PageData {
	const p = emptyPage(id);
	p.surface = "inline";
	p.strokes = [stroke("s1")];
	return p;
}

function ok(data: PageData): ParseResult {
	return { data, recovered: false, damaged: false } as ParseResult;
}

/** Ids only for notes the test says are claimed; everything else is unclaimed. */
class FakeHost implements InlineInkHost {
	ids = new Map<string, string>();
	sidecars = new Map<string, ParseResult>();
	reads: string[] = [];
	/** Blocks `loadSidecar` so the "mid-load" state can be observed. */
	gate: (() => void) | null = null;
	readPageId(path: string): string | null {
		this.reads.push(path);
		return this.ids.get(path) ?? null;
	}
	async claimId(_path: string, proposedId: string): Promise<{ pageId: string }> {
		return { pageId: proposedId };
	}
	async loadSidecar(pageId: string): Promise<ParseResult | null> {
		if (this.gate) await new Promise<void>((r) => (this.gate = r));
		return this.sidecars.get(pageId) ?? null;
	}
	scheduleSidecar(): void {}
	notify(): void {}
}

describe("InlineInkStore.inkPresence", () => {
	it('an unread note that HAS a sidecar is "unknown", not "none"', async () => {
		const store = new InlineInkStore();
		const host = new FakeHost();
		host.ids.set("inked.md", "p1");
		host.sidecars.set("p1", ok(inkedPage("p1")));
		store.attachHost(host);

		// The exact state Alan's eraser met: ink on disk, nothing in session.
		expect(store.hasInk("inked.md")).toBe(false);
		expect(store.inkPresence("inked.md")).toBe("unknown");

		await store.ensureLoaded("inked.md");

		expect(store.inkPresence("inked.md")).toBe("ink");
	});

	it('an unclaimed note is certainly "none" off metadata alone, with no file read', async () => {
		const store = new InlineInkStore();
		const host = new FakeHost();
		store.attachHost(host);

		expect(store.inkPresence("plain.md")).toBe("none");
		// readPageId is the whole cost. loadSidecar was never reached.
		expect(host.reads).toEqual(["plain.md"]);
	});

	it('a loaded note whose sidecar held nothing is "none"', async () => {
		const store = new InlineInkStore();
		const host = new FakeHost();
		host.ids.set("empty.md", "p2");
		store.attachHost(host);

		await store.ensureLoaded("empty.md");

		expect(store.inkPresence("empty.md")).toBe("none");
	});

	it('a load still in flight is "unknown"', async () => {
		const store = new InlineInkStore();
		const host = new FakeHost();
		host.ids.set("slow.md", "p3");
		host.sidecars.set("p3", ok(inkedPage("p3")));
		host.gate = () => undefined;
		store.attachHost(host);

		const loading = store.ensureLoaded("slow.md");
		expect(store.inkPresence("slow.md")).toBe("unknown");

		host.gate?.();
		await loading;

		expect(store.inkPresence("slow.md")).toBe("ink");
	});

	it('session strokes answer "ink" whether or not anything is persisted', () => {
		const store = new InlineInkStore();
		store.attachHost(new FakeHost());
		store.commit("fresh.md", stroke("live"));

		expect(store.inkPresence("fresh.md")).toBe("ink");
	});

	it('with no host the session is the whole truth, so empty is "none"', () => {
		// Headless mode: no sidecar exists behind the session, so there is
		// nothing unread and "unknown" would be a lie in the other direction.
		const store = new InlineInkStore();

		expect(store.inkPresence("anything.md")).toBe("none");
	});

	it("hasInk is left exactly as it was - no guessing in either direction", () => {
		const store = new InlineInkStore();
		const host = new FakeHost();
		host.ids.set("inked.md", "p1");
		host.sidecars.set("p1", ok(inkedPage("p1")));
		store.attachHost(host);

		// Still the plain read of the session cache. Callers that need
		// certainty ask inkPresence; this one keeps its old meaning so no
		// existing reader silently changes behaviour.
		expect(store.hasInk("inked.md")).toBe(false);
	});
});
