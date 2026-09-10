/**
 * The slides surface's sidecar, in the schema (slides-ink-design §3.1, §4).
 *
 * Two rules are asserted here and nowhere else, because they are the whole of
 * the backward-compatibility promise:
 *
 *  - `surface: "slides"` survives a round trip, so a slides sidecar announces
 *    which coordinate world its numbers live in instead of looking like a
 *    legacy canvas page whose geometry something might reinterpret.
 *  - the sidecar's id, `<pageId>.slides`, is a LEGAL page id. It has to be:
 *    it is interpolated into a vault path by `PageStore.path`, which throws on
 *    anything `isSafePageId` refuses. And it is an id no note can carry, so no
 *    note or canvas path can ever load it - they read `handwriting-page-id`
 *    out of frontmatter, and the claim never writes the suffixed form.
 */

import { describe, expect, it } from "vitest";

import { PageData, emptyPage, isSafePageId, parsePage, serializePage } from "./PageData";

function slidesPage(pageId: string): PageData {
	return {
		...emptyPage(pageId),
		surface: "slides",
		coordSpace: "slide-logical",
		deck: { width: 960, height: 700 },
		slides: [
			{ index: 0, hash: "1a2b3c4d" },
			{ index: 1, hash: "deadbeef" },
		],
	};
}

describe("slides sidecar schema", () => {
	it("round-trips surface, coordSpace, deck and slides", () => {
		const page = slidesPage("11111111-2222-3333-4444-555555555555.slides");
		const back = parsePage(serializePage(page), "fallback").data;
		expect(back.surface).toBe("slides");
		expect(back.coordSpace).toBe("slide-logical");
		expect(back.deck).toEqual({ width: 960, height: 700 });
		expect(back.slides).toEqual([
			{ index: 0, hash: "1a2b3c4d" },
			{ index: 1, hash: "deadbeef" },
		]);
	});

	it("keeps deck and slides out of unknownTop, so one save cannot write them twice", () => {
		const page = slidesPage("aaaa.slides");
		const back = parsePage(serializePage(page), "fallback").data;
		expect(Object.keys(back.unknownTop)).toEqual([]);
		const json = JSON.parse(serializePage(back)) as Record<string, unknown>;
		expect(Object.keys(json).filter((k) => k === "deck" || k === "slides")).toEqual([
			"deck",
			"slides",
		]);
	});

	it("accepts <uuid>.slides as a page id, so PageStore can build its path", () => {
		expect(isSafePageId("11111111-2222-3333-4444-555555555555.slides")).toBe(true);
		expect(isSafePageId("page-1756900000000-ab12cd.slides")).toBe(true);
		// The suffix buys no new powers: a hostile id is still refused, so a
		// note carrying `../../x` cannot reach the ink folder's parent by
		// asking for the slides sidecar of it.
		expect(isSafePageId("../../x.slides")).toBe(false);
		expect(isSafePageId(".hidden.slides")).toBe(false);
	});

	it("writes nothing new for a note or canvas sidecar", () => {
		const inline: PageData = { ...emptyPage("plain"), surface: "inline" };
		const json = JSON.parse(serializePage(inline)) as Record<string, unknown>;
		expect("deck" in json).toBe(false);
		expect("slides" in json).toBe(false);
	});

	it("still drops a surface it does not know", () => {
		const raw = JSON.stringify({ schemaVersion: 1, pageId: "x", surface: "hologram" });
		expect(parsePage(raw, "x").data.surface).toBeUndefined();
	});

	it("drops a half-written deck whole, but filters the slide list per entry", () => {
		// The two fields fail differently and the difference is deliberate: a
		// deck size with one number missing says nothing about the other, while
		// each slide entry is an independent index->hash fact, so a bad one is
		// skipped and its siblings on BOTH sides of it survive.
		const raw = JSON.stringify({
			schemaVersion: 1,
			pageId: "x.slides",
			surface: "slides",
			deck: { width: 960 },
			slides: [
				{ index: 0, hash: "first" },
				{ index: -1, hash: "negative" },
				{ index: 1.5, hash: "fractional" },
				{ index: 2 },
				"not an object",
				{ index: 3, hash: "last" },
			],
		});
		const back = parsePage(raw, "x.slides").data;
		expect(back.deck).toBeUndefined();
		expect(back.slides).toEqual([
			{ index: 0, hash: "first" },
			{ index: 3, hash: "last" },
		]);
	});

	it("preserves a stroke's 1-based page number, which is how a slide is keyed", () => {
		const page: PageData = {
			...slidesPage("x.slides"),
			strokes: [
				{
					id: "s1",
					tool: "pen",
					color: "#fff",
					width: 2,
					createdAt: 1,
					page: 3,
					points: [
						{ x: -40, y: 12, pressure: 0.5, t: 0 },
						{ x: 10, y: 20, pressure: 0.5, t: 8 },
					],
					bbox: { x: -40, y: 12, width: 50, height: 8 },
				},
			],
		};
		const back = parsePage(serializePage(page), "x.slides").data;
		expect(back.strokes).toHaveLength(1);
		expect(back.strokes[0]!.page).toBe(3);
		// Negative logical x is the letterbox margin left of the deck, and it
		// has to survive: the whole viewport is inkable (design §3.4).
		expect(back.strokes[0]!.points[0]!.x).toBe(-40);
	});
});
