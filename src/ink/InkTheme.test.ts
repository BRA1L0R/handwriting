import { beforeEach, describe, expect, it } from "vitest";
import {
	DARK_MAX_LUMINANCE,
	inkColorFor,
	inkThemeAdaptationEnabled,
	inkThemeCacheSize,
	inkThemeOverride,
	isDarkTheme,
	refreshInkTheme,
	relativeLuminance,
	resetInkTheme,
	resolveInkColor,
	setInkThemeAdaptation,
	setInkThemeOverride,
	withRawInk,
} from "./InkTheme";

const LIGHT_INK = "#E6E6E6";

function docWith(theme: "theme-dark" | "theme-light"): Document {
	return {
		body: { classList: { contains: (c: string) => c === theme } },
	} as unknown as Document;
}

beforeEach(() => {
	resetInkTheme();
});

describe("resolveInkColor, dark theme", () => {
	it("lifts the near-blacks a OneNote import actually carries", () => {
		for (const c of ["#000000", "#000", "#111111", "#1F1F1F", "#1f1f1f", "#1c1f26"]) {
			expect(resolveInkColor(c, true)).toBe(LIGHT_INK);
		}
	});

	it("adapts on the dark side of the luminance threshold and not past it", () => {
		// 0.10 relative luminance sits between these two greys.
		expect(relativeLuminance(0x55, 0x55, 0x55)).toBeLessThan(0.1);
		expect(relativeLuminance(0x5a, 0x5a, 0x5a)).toBeGreaterThan(0.1);
		expect(resolveInkColor("#555555", true)).toBe(LIGHT_INK);
		expect(resolveInkColor("#5a5a5a", true)).toBe("#5a5a5a");
	});

	it("keeps graphite and black apart: only one of the two neutral pens moves", () => {
		// Both are neutral greys, so the spread test cannot separate them and
		// the threshold is the only thing that can. At 0.18 they both landed
		// on #E6E6E6 and the palette lost a pen (review, 2026-09-04).
		expect(relativeLuminance(0x5f, 0x66, 0x73)).toBeGreaterThan(0.1);
		expect(resolveInkColor("#5f6673", true)).toBe("#5f6673");
		expect(resolveInkColor("#1c1f26", true)).toBe(LIGHT_INK);
	});

	it("still catches every black a note or an import carries", () => {
		for (const c of ["#000000", "#1c1f26", "#1E1E1E", "#333333", "#333"]) {
			expect(resolveInkColor(c, true)).toBe(LIGHT_INK);
		}
	});

	it("leaves hues alone, however dark they are", () => {
		// The whole reason the rule is not luminance alone: navy is darker
		// than the threshold and must still read as navy.
		expect(relativeLuminance(0, 0x4f, 0x8b)).toBeLessThan(0.1);
		for (const c of ["#004F8B", "#E71225", "#008C3A", "#2f6de0", "#cf3040", "#ffd60a"]) {
			expect(resolveInkColor(c, true)).toBe(c);
		}
	});

	it("leaves near-white alone: it is already visible on a dark page", () => {
		expect(resolveInkColor("#ffffff", true)).toBe("#ffffff");
		expect(resolveInkColor("#f4f4f2", true)).toBe("#f4f4f2");
	});
});

describe("resolveInkColor, light theme", () => {
	// There is no light-theme rule. The mirror of the dark one was written
	// for symmetry and removed on the review of 2026-09-04: the palette's
	// "white" pen is chosen to write on dark FIGURES, not because the page
	// is dark, so darkening it on the light theme destroyed the annotation
	// the writer had just made.
	it("leaves the white pen white, whatever the page under it is", () => {
		expect(resolveInkColor("#f4f4f2", false)).toBe("#f4f4f2");
		expect(resolveInkColor("#f4f4f2", true)).toBe("#f4f4f2");
	});

	it("touches nothing at all: near-white, near-black, grey or hue", () => {
		for (const c of [
			"#ffffff",
			"#fff",
			"#eeeeee",
			"#dddddd",
			"#000000",
			"#1c1f26",
			"#1F1F1F",
			"#5f6673",
			"#004F8B",
			"#E71225",
			"#008C3A",
			"#ffd60a",
			"#ffffffcc",
			"rgba(255, 255, 255, 0.25)",
		]) {
			expect(resolveInkColor(c, false)).toBe(c);
		}
	});
});

describe("colour forms", () => {
	it("preserves an eight-digit hex alpha", () => {
		expect(resolveInkColor("#00000080", true)).toBe("#E6E6E680");
		expect(resolveInkColor("#000000ff", true)).toBe("#E6E6E6ff");
	});

	it("preserves a four-digit hex alpha", () => {
		expect(resolveInkColor("#0008", true)).toBe("#E6E6E688");
	});

	it("reads rgb() and rgba(), comma and slash forms", () => {
		expect(resolveInkColor("rgb(0, 0, 0)", true)).toBe(LIGHT_INK);
		expect(resolveInkColor("rgb(0 0 0)", true)).toBe(LIGHT_INK);
		expect(resolveInkColor("rgb(31, 31, 31)", true)).toBe(LIGHT_INK);
		expect(resolveInkColor("rgb(0, 79, 139)", true)).toBe("rgb(0, 79, 139)");
	});

	it("carries an rgba alpha across into the adapted colour", () => {
		expect(resolveInkColor("rgba(0, 0, 0, 0.5)", true)).toBe("rgba(230, 230, 230, 0.5)");
		expect(resolveInkColor("rgba(0 0 0 / 50%)", true)).toBe("rgba(230, 230, 230, 0.5)");
		// Fully opaque is not an alpha worth spelling out.
		expect(resolveInkColor("rgba(0, 0, 0, 1)", true)).toBe(LIGHT_INK);
	});

	it("passes unknown strings through untouched", () => {
		for (const c of ["", "  ", "red", "black", "var(--text-normal)", "#12", "#gggggg", "hsl(0 0% 0%)", "rgb(0%, 0%, 0%)"]) {
			expect(resolveInkColor(c, true)).toBe(c);
			expect(resolveInkColor(c, false)).toBe(c);
		}
	});
});

describe("memoisation", () => {
	it("parses a colour once per theme and answers from the memo after that", () => {
		expect(inkThemeCacheSize()).toEqual({ dark: 0, light: 0 });
		const first = resolveInkColor("#000000", true);
		expect(inkThemeCacheSize()).toEqual({ dark: 1, light: 0 });
		for (let i = 0; i < 100; i++) {
			expect(resolveInkColor("#000000", true)).toBe(first);
		}
		expect(inkThemeCacheSize()).toEqual({ dark: 1, light: 0 });
		// The two themes answer differently, so they memo separately.
		resolveInkColor("#000000", false);
		expect(inkThemeCacheSize()).toEqual({ dark: 1, light: 1 });
	});

	it("stops growing at the cap instead of emptying itself", () => {
		// 600 distinct colours through a 512-entry memo. Strings are
		// primitives, so `toBe` cannot tell a memo hit from a recompute -
		// the map's own size is the observable, and it separates the two
		// policies completely: never-clear ends at 512, clear-at-cap ends at
		// 88 (the 513th empties it, and the last 88 refill it).
		const colors = Array.from({ length: 600 }, (_, i) => `rgba(0, 0, 0, ${(i + 1) / 1000})`);
		const first = colors.map((c) => resolveInkColor(c, true));
		expect(inkThemeCacheSize()).toEqual({ dark: 512, light: 0 });

		// The first colour is still IN the memo, which is the whole point:
		// under clear-at-cap it was evicted by colour 513 and re-reading it
		// would put the map back to a handful of entries. Here nothing moves.
		expect(resolveInkColor(colors[0]!, true)).toBe(first[0]);
		expect(inkThemeCacheSize()).toEqual({ dark: 512, light: 0 });

		// And every colour past the cap still resolves correctly - not
		// storing an answer is not the same as not having one.
		for (let i = 512; i < 600; i++) {
			expect(resolveInkColor(colors[i]!, true)).toBe(first[i]);
		}
		expect(inkThemeCacheSize()).toEqual({ dark: 512, light: 0 });
		expect(first[0]).toBe("rgba(230, 230, 230, 0.001)");
		expect(first[599]).toBe("rgba(230, 230, 230, 0.6)");
	});

	it("memoises the pass-through answer too, so a hue is parsed once as well", () => {
		// A note of blue annotations must not re-parse per stroke per frame
		// just because the answer is "leave it alone".
		const navy = ["#004", "F8B"].join("");
		expect(resolveInkColor(navy, true)).toBe(navy);
		expect(inkThemeCacheSize()).toEqual({ dark: 1, light: 0 });
		for (let i = 0; i < 100; i++) expect(resolveInkColor(navy, true)).toBe(navy);
		expect(inkThemeCacheSize()).toEqual({ dark: 1, light: 0 });
	});
});

describe("isDarkTheme", () => {
	it("reads the body class Obsidian stamps", () => {
		expect(isDarkTheme(docWith("theme-dark"))).toBe(true);
		expect(isDarkTheme(docWith("theme-light"))).toBe(false);
		expect(isDarkTheme({} as unknown as Document)).toBe(false);
	});
});

describe("inkColorFor", () => {
	it("returns the stored colour under either live theme", () => {
		refreshInkTheme(docWith("theme-dark"));
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		expect(inkColorFor("#000000")).toBe("#000000");
		refreshInkTheme(docWith("theme-light"));
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		expect(inkColorFor({ color: "#ffffff" })).toBe("#ffffff");
	});

	it("retains the compatibility setting without letting it recolour live ink", () => {
		refreshInkTheme(docWith("theme-dark"));
		expect(inkThemeAdaptationEnabled()).toBe(true);
		expect(inkColorFor({ color: "#1c1f26" })).toBe("#1c1f26");
		setInkThemeAdaptation(false);
		expect(inkThemeAdaptationEnabled()).toBe(false);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		expect(inkColorFor("#ffffff")).toBe("#ffffff");
		setInkThemeAdaptation(true);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
	});

	it("returns the stored colour inside an export scope, nesting included", () => {
		refreshInkTheme(docWith("theme-dark"));
		const seen = withRawInk(() => {
			const outer = inkColorFor({ color: "#000000" });
			const inner = withRawInk(() => inkColorFor({ color: "#000000" }));
			// The inner scope's exit must not re-arm adaptation for the rest
			// of the outer one.
			const after = inkColorFor({ color: "#000000" });
			return [outer, inner, after];
		});
		expect(seen).toEqual(["#000000", "#000000", "#000000"]);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
	});

	it("unwinds the export scope when the painter throws", () => {
		refreshInkTheme(docWith("theme-dark"));
		expect(() =>
			withRawInk(() => {
				throw new Error("canvas is gone");
			})
		).toThrow("canvas is gone");
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
	});

	it("is byte-for-byte idempotent for live colours", () => {
		refreshInkTheme(docWith("theme-dark"));
		expect(inkColorFor({ color: inkColorFor({ color: "#000000" }) })).toBe("#000000");
		refreshInkTheme(docWith("theme-light"));
		expect(inkColorFor({ color: inkColorFor({ color: "#ffffff" }) })).toBe("#ffffff");
	});
});

/**
 * The override, for a surface painting on a background that is not the body's.
 *
 * The case it exists for: Obsidian's presenter chooses its deck stylesheet
 * from the Appearance CONFIG value, so "adapt to system" on a light-mode OS
 * puts a BLACK deck under a body with no `theme-dark` class. Every assertion
 * here is therefore written with the body saying light.
 */
describe("setInkThemeOverride", () => {
	it("records a deck override without recolouring live ink", () => {
		refreshInkTheme(docWith("theme-light"));
		expect(isDarkTheme(docWith("theme-light"))).toBe(false);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		setInkThemeOverride(true);
		expect(inkThemeOverride()).toBe(true);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		expect(inkColorFor("#000000")).toBe("#000000");
		expect(inkThemeCacheSize()).toEqual({ dark: 0, light: 0 });
	});

	it("clears the compatibility override without changing live colour", () => {
		refreshInkTheme(docWith("theme-light"));
		setInkThemeOverride(true);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		setInkThemeOverride(null);
		expect(inkThemeOverride()).toBeNull();
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
	});

	it("overrides the other way too: a white deck under a dark workspace", () => {
		refreshInkTheme(docWith("theme-dark"));
		setInkThemeOverride(false);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		setInkThemeOverride(null);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
	});

	it("survives a css-change: refreshInkTheme re-reads the body and leaves it standing", () => {
		setInkThemeOverride(true);
		// A theme switch mid-presentation is the event that used to be the only
		// way the flag moved. It must not cancel the deck's reading.
		refreshInkTheme(docWith("theme-light"));
		expect(inkThemeOverride()).toBe(true);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		// And the refresh really did happen underneath, for when the deck goes.
		setInkThemeOverride(null);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
	});

	it("is cleared by the test seam, so no deck leaks into the next test", () => {
		setInkThemeOverride(true);
		resetInkTheme();
		expect(inkThemeOverride()).toBeNull();
		refreshInkTheme(docWith("theme-light"));
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
	});

	it("does not outrank stored live colour or a raw scope", () => {
		refreshInkTheme(docWith("theme-light"));
		setInkThemeOverride(true);
		setInkThemeAdaptation(false);
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
		setInkThemeAdaptation(true);
		expect(withRawInk(() => inkColorFor({ color: "#000000" }))).toBe("#000000");
		expect(inkColorFor({ color: "#000000" })).toBe("#000000");
	});
});

describe("DARK_MAX_LUMINANCE, as the slides surface reads it", () => {
	it("separates the presenter's two decks with room on both sides", () => {
		// black.css paints #191919 and white.css #fff; the slides surface asks
		// this exact question of the deck's measured background.
		expect(relativeLuminance(0x19, 0x19, 0x19)).toBeLessThan(DARK_MAX_LUMINANCE);
		expect(relativeLuminance(0xff, 0xff, 0xff)).toBeGreaterThan(DARK_MAX_LUMINANCE);
	});
});
