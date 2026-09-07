import { afterEach, describe, expect, it } from "vitest";
import {
	InkPreset,
	MAX_PRESETS_PER_TOOL,
	addPreset,
	applyInkPreset,
	colorNameFor,
	forgetInkPreset,
	getInkPresets,
	inkPresetsFor,
	normalizeInkPresets,
	PRESET_DOT_MAX_PX,
	PRESET_DOT_MIN_PX,
	presetChips,
	presetDotPx,
	presetLabel,
	presetsFor,
	starReplaces,
	removePreset,
	setInkPresetActions,
	setInkPresets,
	sizeWordFor,
	starInkPreset,
} from "./InkPresets";
import { HIGHLIGHTER_COLORS, PEN_COLORS } from "./InkColor";
import { INK_SIZE_STEPS } from "./InkSize";

const pen = (hex: string, size = 1): InkPreset => ({
	tool: "pen",
	hex,
	name: colorNameFor("pen", hex),
	size,
});

const RED = PEN_COLORS.find((c) => c.name === "red")!.hex;
const BLUE = PEN_COLORS[0]!.hex;

describe("normalizeInkPresets — data.json is never trusted", () => {
	it("answers an empty list for anything that is not an array", () => {
		expect(normalizeInkPresets(undefined)).toEqual([]);
		expect(normalizeInkPresets(null)).toEqual([]);
		expect(normalizeInkPresets("red")).toEqual([]);
		expect(normalizeInkPresets({ tool: "pen" })).toEqual([]);
	});

	it("drops entries with no usable tool, and keeps the rest", () => {
		const list = normalizeInkPresets([
			null,
			"nope",
			{ tool: "eraser", hex: RED, size: 1 },
			{ hex: RED, size: 1 },
			{ tool: "pen", hex: RED, size: 1.8 },
		]);
		expect(list).toEqual([{ tool: "pen", hex: RED, name: "red", size: 1.8 }]);
	});

	it("clamps a junk size rather than dropping the slot somebody saved", () => {
		const [a, b, c] = normalizeInkPresets([
			{ tool: "pen", hex: RED, size: "fat" },
			{ tool: "pen", hex: RED, size: -3 },
			{ tool: "pen", hex: RED, size: 99 },
		]);
		expect(a!.size).toBe(1);
		expect(b!.size).toBe(1);
		expect(c!.size).toBe(4);
	});

	it("normalises the hex through the palette's own rule", () => {
		const [keep, fix] = normalizeInkPresets([
			{ tool: "pen", hex: "#A1B2C3", size: 1 },
			{ tool: "pen", hex: "tomato", size: 1 },
		]);
		// Any six-digit hex survives, lowercased (custom colors);
		// nonsense falls back to the tool's default rather than throwing.
		expect(keep!.hex).toBe("#a1b2c3");
		expect(fix!.hex).toBe(PEN_COLORS[0]!.hex);
	});

	it("names a nameless entry from the palette", () => {
		const [p] = normalizeInkPresets([{ tool: "pen", hex: RED, size: 1 }]);
		expect(p!.name).toBe("red");
	});

	it("caps each tool at four and counts the tools separately", () => {
		const raw = [
			...Array.from({ length: 7 }, () => ({ tool: "pen", hex: RED, size: 1 })),
			...Array.from({ length: 6 }, () => ({
				tool: "highlighter",
				hex: HIGHLIGHTER_COLORS[0]!.hex,
				size: 1,
			})),
		];
		const list = normalizeInkPresets(raw);
		expect(presetsFor(list, "pen")).toHaveLength(MAX_PRESETS_PER_TOOL);
		expect(presetsFor(list, "highlighter")).toHaveLength(MAX_PRESETS_PER_TOOL);
	});
});

describe("addPreset — first empty slot, then the last one", () => {
	it("fills the empty slots in order", () => {
		let list: InkPreset[] = [];
		list = addPreset(list, pen(RED));
		list = addPreset(list, pen(BLUE));
		expect(presetsFor(list, "pen").map((p) => p.hex)).toEqual([RED, BLUE]);
	});

	it("replaces the LAST slot once the tool is full, never the first", () => {
		let list: InkPreset[] = [];
		for (const c of PEN_COLORS.slice(0, MAX_PRESETS_PER_TOOL)) list = addPreset(list, pen(c.hex));
		const before = presetsFor(list, "pen").map((p) => p.hex);
		list = addPreset(list, pen("#a1b2c3"));
		const after = presetsFor(list, "pen").map((p) => p.hex);
		expect(after).toHaveLength(MAX_PRESETS_PER_TOOL);
		// Slot 1 - the one most likely to be on a hotkey - is untouched.
		expect(after[0]).toBe(before[0]);
		expect(after.at(-1)).toBe("#a1b2c3");
	});

	it("leaves the other tool's slots exactly where they were", () => {
		const yellow = HIGHLIGHTER_COLORS[0]!.hex;
		let list: InkPreset[] = [
			{ tool: "highlighter", hex: yellow, name: "yellow", size: 1 },
			pen(RED),
		];
		list = addPreset(list, pen(BLUE));
		expect(presetsFor(list, "highlighter").map((p) => p.hex)).toEqual([yellow]);
		expect(presetsFor(list, "pen").map((p) => p.hex)).toEqual([RED, BLUE]);
	});

	it("never mutates the list it was handed", () => {
		const list: InkPreset[] = [pen(RED)];
		const next = addPreset(list, pen(BLUE));
		expect(list).toHaveLength(1);
		expect(next).toHaveLength(2);
	});
});

describe("removePreset", () => {
	it("drops the indexed slot and closes the gap", () => {
		let list: InkPreset[] = [pen(RED), pen(BLUE), pen("#a1b2c3")];
		list = removePreset(list, "pen", 1);
		expect(presetsFor(list, "pen").map((p) => p.hex)).toEqual([RED, "#a1b2c3"]);
	});

	it("leaves the list alone for an index nothing occupies", () => {
		const list: InkPreset[] = [pen(RED)];
		expect(removePreset(list, "pen", 3)).toEqual(list);
		expect(removePreset(list, "pen", -1)).toEqual(list);
		expect(removePreset(list, "highlighter", 0)).toEqual(list);
	});
});

describe("presetLabel", () => {
	it("uses the palette's word for a colour the palette knows", () => {
		expect(presetLabel(pen(RED, 1.8))).toBe("red, bold");
	});

	it("falls back to the hex for a colour it does not", () => {
		expect(presetLabel(pen("#a1b2c3", 0.6))).toBe("#a1b2c3, fine");
	});

	it("reuses the size words the Ink size commands already use", () => {
		for (const step of INK_SIZE_STEPS) {
			expect(presetLabel(pen(RED, step.mult))).toBe(`red, ${step.name}`);
		}
	});

	it("names an in-between width with the nearest step, ties to the finer", () => {
		// The sliders are continuous, so most starred pens land between two
		// steps. 0.8 is exactly between fine (0.6) and medium (1).
		expect(sizeWordFor(0.65)).toBe("fine");
		expect(sizeWordFor(0.8)).toBe("fine");
		expect(sizeWordFor(1.4)).toBe("medium");
		expect(sizeWordFor(3)).toBe("bold");
	});

	it("reads a highlighter's word from the highlighter's own palette", () => {
		const pink = HIGHLIGHTER_COLORS.find((c) => c.name === "pink")!.hex;
		expect(colorNameFor("highlighter", pink)).toBe("pink");
		// The same hex means nothing on the pen's palette, so it stays a hex.
		expect(colorNameFor("pen", pink)).toBe(pink);
	});
});

describe("session state and the action hook", () => {
	afterEach(() => {
		setInkPresets([]);
		setInkPresetActions(null);
	});

	it("hands the strip one tool's slots at a time", () => {
		setInkPresets([pen(RED), { tool: "highlighter", hex: "#ffd60a", name: "yellow", size: 1 }]);
		expect(inkPresetsFor("pen").map((p) => p.hex)).toEqual([RED]);
		expect(inkPresetsFor("highlighter").map((p) => p.hex)).toEqual(["#ffd60a"]);
		expect(getInkPresets()).toHaveLength(2);
	});

	it("copies rather than aliases, so the caller's array cannot drift into it", () => {
		const mine = [pen(RED)];
		setInkPresets(mine);
		mine.push(pen(BLUE));
		expect(getInkPresets()).toHaveLength(1);
	});

	it("routes the strip's three gestures to whatever main registered", () => {
		const seen: string[] = [];
		setInkPresetActions({
			apply: (tool, index) => void seen.push(`apply ${tool} ${index}`),
			star: (tool) => void seen.push(`star ${tool}`),
			remove: (tool, index) => void seen.push(`remove ${tool} ${index}`),
		});
		applyInkPreset("pen", 2);
		starInkPreset("highlighter");
		forgetInkPreset("pen", 0);
		expect(seen).toEqual(["apply pen 2", "star highlighter", "remove pen 0"]);
	});

	it("is silent, not fatal, before main has registered anything", () => {
		setInkPresetActions(null);
		expect(() => applyInkPreset("pen", 0)).not.toThrow();
		expect(() => starInkPreset("pen")).not.toThrow();
		expect(() => forgetInkPreset("pen", 0)).not.toThrow();
	});
});

/**
 * The row's model, decided without a DOM. Every question the builder in
 * MobileTools.ts asks - which chips exist, how big each dot is, which one is
 * the pen in hand - is answered here, so the DOM test downstream only has to
 * prove the buttons follow this.
 */
describe("presetChips — the row a nib's pop draws", () => {
	const BLUE = PEN_COLORS[0]!.hex;

	it("is empty for a tool nobody has starred, which is the fresh-install row", () => {
		expect(presetChips([], BLUE, 1)).toEqual([]);
	});

	it("draws one chip per slot, in slot order, each labelled and indexed", () => {
		const chips = presetChips([pen(RED, 1.8), pen(BLUE, 0.6)], "#000000", 1);
		expect(chips.map((c) => c.index)).toEqual([0, 1]);
		expect(chips.map((c) => c.hex)).toEqual([RED, BLUE]);
		expect(chips.map((c) => c.label)).toEqual(["red, bold", "blue, fine"]);
	});

	it("rings the chip whose colour AND size are both in hand", () => {
		const chips = presetChips([pen(RED, 1.8), pen(RED, 0.6)], RED, 1.8);
		expect(chips.map((c) => c.current)).toEqual([true, false]);
	});

	it("rings nothing when the colour matches but the width does not", () => {
		// The whole reason a preset is a PAIR: a red bold and a red fine are
		// two different pens, and a ring on colour alone would say the user
		// is holding one they are not.
		const chips = presetChips([pen(RED, 1.8)], RED, 0.6);
		expect(chips[0]!.current).toBe(false);
	});

	it("rings nothing when the width matches but the colour does not", () => {
		const chips = presetChips([pen(RED, 1)], BLUE, 1);
		expect(chips[0]!.current).toBe(false);
	});

	it("ignores hex case, which the palette and data.json disagree about", () => {
		const chips = presetChips([pen(RED, 1)], RED.toUpperCase(), 1);
		expect(chips[0]!.current).toBe(true);
	});

	it("forgives the last decimal of a px round trip, but not a real difference", () => {
		// The sliders work in PIXELS, so a starred multiplier makes a
		// multiplier -> px -> multiplier trip before it is compared, and the
		// ring must not be lost to arithmetic. A size the user can actually
		// see the difference of still loses it.
		expect(presetChips([pen(RED, 1)], RED, 1 + 4e-4)[0]!.current).toBe(true);
		expect(presetChips([pen(RED, 1)], RED, 1.05)[0]!.current).toBe(false);
	});
});

describe("presetDotPx — the dot's diameter, in the slider's own vocabulary", () => {
	it("draws the finest step smallest and the boldest largest", () => {
		const fine = INK_SIZE_STEPS[0]!.mult;
		const bold = INK_SIZE_STEPS[INK_SIZE_STEPS.length - 1]!.mult;
		expect(presetDotPx(fine)).toBe(PRESET_DOT_MIN_PX);
		expect(presetDotPx(bold)).toBe(PRESET_DOT_MAX_PX);
		expect(presetDotPx(INK_SIZE_STEPS[1]!.mult)).toBeGreaterThan(PRESET_DOT_MIN_PX);
		expect(presetDotPx(INK_SIZE_STEPS[1]!.mult)).toBeLessThan(PRESET_DOT_MAX_PX);
	});

	it("clamps outside the steps rather than drawing off the chip", () => {
		// The sliders run wider than the three named steps (the pen to 3x),
		// and a dot bigger than its 22px cell would overlap its neighbour.
		expect(presetDotPx(0.05)).toBe(PRESET_DOT_MIN_PX);
		expect(presetDotPx(3)).toBe(PRESET_DOT_MAX_PX);
	});

	it("rises with the multiplier in between, so two presets can be told apart", () => {
		expect(presetDotPx(0.9)).toBeLessThan(presetDotPx(1.4));
	});
});

describe("starReplaces — what the star will do when it is pressed", () => {
	it("appends until the slots are full, then replaces", () => {
		const full = Array.from({ length: MAX_PRESETS_PER_TOOL }, () => pen(RED, 1));
		expect(starReplaces([])).toBe(false);
		expect(starReplaces(full.slice(0, MAX_PRESETS_PER_TOOL - 1))).toBe(false);
		expect(starReplaces(full)).toBe(true);
		// And the star still WORKS when full - `addPreset` replaces the last,
		// so this is a label, never a disabled button.
		expect(addPreset(full, pen(PEN_COLORS[0]!.hex, 0.6))).toHaveLength(MAX_PRESETS_PER_TOOL);
	});
});
