/**
 * The paper plan, at the arithmetic level: the pitch, rule and phase the
 * lined, grid and dotted paper are drawn with, from the text's size, the note
 * origin and how many device px a layout px covers. Pitch and phase never take
 * the zoom: the host's CSS zoom scales the paper with the note, the way graph
 * paper scales with what is drawn on it. The rule does, only to stay at least
 * one device px thick.
 *
 * The render suite reads the real engine and is what proves the paper on
 * screen. This file is the table the module has to meet. It also carries a
 * copy of the formula that shipped in 1.4.19 (a power-of-two subset of the
 * 28 px grid re-levelled with the zoom, and blind to the text size), run
 * through the same rows as a control: it must FAIL them, or the rows could
 * not see the difference.
 */

import { describe, expect, it } from "vitest";
import { BASE_FONT_PX, BASE_PITCH, paperPlan, paperThickness, type PaperPlan } from "./PaperPlan";

// updatePaperSpacing as it shipped, in this module's shape: layout px chosen
// per zoom, with no text size and no phase in it.
function shippedPlan(z: number, _textFontPx: number): PaperPlan {
	const level = Math.min(20, Math.max(0, Math.ceil(Math.log2(1 / z) - 1e-6)));
	return { pitch: 28 * 2 ** level, rule: 1 / Math.min(1, z), dot: 1, phase: null, phaseX: null };
}

// text font px -> pitch, rule (layout px) at 100 percent and dpr 2, where the
// floor (half a layout px) is under every literal rule: the agreed table.
const ROWS: Array<[number, number, number]> = [
	[16, 28, 1], [24, 42, 1.5], [17.6, 30.796875, 1.1], [20, 35, 1.25], [12, 21, 0.75], [32, 56, 2],
];

describe("paper plan", () => {
	it.each(ROWS)("text at %s px draws a %s px pitch and a %s px rule and dot radius", (font, pitch, rule) => {
		const plan = paperPlan(font, 0, 2)!;
		expect(plan.pitch).toBeCloseTo(pitch, 9);
		expect(plan.rule).toBeCloseTo(rule, 9);
		expect(plan.dot).toBeCloseTo(rule, 9);
	});

	it("is 28 px at Obsidian's default text size, and scales with the text by the same factor", () => {
		expect(BASE_PITCH).toBe(28);
		expect(BASE_FONT_PX).toBe(16);
		for (const font of [8, 13, 16, 18.5, 24, 40]) {
			const plan = paperPlan(font, 0, 4)!;
			expect(plan.pitch / 28, `pitch factor at ${font} px`).toBeCloseTo(font / 16, 12);
			expect(plan.rule / plan.pitch, `rule to pitch at ${font} px`).toBeCloseTo(1 / 28, 12);
		}
	});

	it("puts the pitch on a whole 1/64 layout px at the text scale, and exactly on 28 x the scale where that already is one", () => {
		expect([16, 20, 24, 12, 32].map(font => paperPlan(font, 0, 1)!.pitch)).toEqual([28, 35, 42, 21, 56]);
		// 28 x 1.1 is 30.8, which is no whole number of 1/64 px: a dot tile stored in that unit would drift.
		expect(paperPlan(17.6, 0, 1)!.pitch).toBe(30.796875);
		for (const font of [8.5, 13, 15.2, 17.6, 18.5, 19.9, 21.3, 26.1]) {
			const pitch = paperPlan(font, 0, 1)!.pitch;
			expect(pitch * 64, `pitch ${pitch} at ${font} px is a whole number of 1/64 px`).toBe(Math.round(pitch * 64));
			expect(Math.abs(pitch - 28 * font / 16), `pitch ${pitch} at ${font} px is within 1/128 px of 28 x the scale`).toBeLessThanOrEqual(1 / 128 + 1e-12);
		}
	});

	it("keeps a dot's soft edge inside half its tile at 10 percent and above, from 12.5 px text at dpr 1", () => {
		// A dot is centred in its pitch-square tile and does not continue past it; its soft edge is 1.5 x its radius.
		for (const dpr of [1, 1.25, 1.5, 2, 3])
			for (const z of [0.1, 0.2, 0.5, 1, 2])
				for (const font of [12.5, 13, 16, 17.6, 20, 24, 32]) {
					const plan = paperPlan(font, 0, dpr * z)!;
					expect(plan.dot * 1.5, `soft edge at ${font} px text, z ${z}, dpr ${dpr}`).toBeLessThanOrEqual(plan.pitch / 2);
				}
		// Below that, at 10 percent on dpr 1, the floored edge (1.5 x sqrt(2)/2 / 0.1 = 10.61 px) reaches past half a 12 px text's tile (10.5).
		expect(paperPlan(12, 0, 0.1)!.dot * 1.5).toBeGreaterThan(paperPlan(12, 0, 0.1)!.pitch / 2);
	});

	it("sizes rules and dots by one thickness policy: one layout px times the text's scale, floored to cover a device px", () => {
		for (const scale of [0.5, 1, 1.1, 1.5, 3])
			for (const mark of ["rule", "dot"] as const) expect(paperThickness(mark, scale, 1e9), `literal ${mark} at scale ${scale}`).toBe(scale);
		// A rule under one device px floors at 1 + 1/64, so a rule whose stops sit on pixel centres still covers one; one that
		// covers a device px keeps its width; a dot's radius floors at
		// sqrt(2)/2 device px, the smallest disc that always holds a pixel centre.
		expect(paperThickness("rule", 1, 0.2), "rule floor at 10 percent, dpr 2").toBe(5.078125);
		expect(paperThickness("dot", 1, 0.2), "dot floor at 10 percent, dpr 2").toBe(Math.SQRT1_2 / 0.2);
		expect(paperThickness("rule", 1.5, 0.5), "rule floor at 50 percent, dpr 1, over a 1.5 literal").toBe(2.03125);
		expect(paperThickness("dot", 1.5, 0.5), "a 1.5 literal dot over its 1.414 floor").toBe(1.5);
		expect(paperThickness("rule", 1.5, 1), "a literal 1.5 already over one device px").toBe(1.5);
		expect(paperThickness("rule", 1, 1), "exactly one device px keeps its literal width: 100 percent on dpr 1, 50 percent on dpr 2").toBe(1);
		expect(paperThickness("rule", 1, 1.001), "just over one device px keeps its literal width").toBe(1);
		expect(paperThickness("rule", 1, 0.999), "just under one device px floors at 1 + 1/64").toBe(1.015625 / 0.999);
		for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
			for (const mark of ["rule", "dot"] as const) expect(paperThickness(mark, 1.25, bad), `no usable device ratio (${bad}) is the literal ${mark}`).toBe(1.25);
		for (const [font] of ROWS) {
			const plan = paperPlan(font, 0, 0.3)!;
			expect([plan.rule, plan.dot]).toEqual([paperThickness("rule", font / 16, 0.3), paperThickness("dot", font / 16, 0.3)]);
		}
	});

	it("keeps the rule at least one device px and the dot radius sqrt(2)/2 at every zoom and dpr, the pitch unmoved by either, and the phase on each one's device px grid", () => {
		const base = paperPlan(16, 10.3, 1)!;
		for (const dpr of [1, 1.25, 1.5, 2, 3])
			for (const z of [4, 2, 1, 0.8, 0.5, 0.37, 0.25, 0.2, 0.1, 0.05]) {
				const plan = paperPlan(16, 10.3, dpr * z)!;
				expect(plan.rule * dpr * z, `device px of the rule at z ${z}, dpr ${dpr}`).toBeGreaterThanOrEqual(1 - 1e-12);
				if (dpr * z < 1) expect(plan.rule * dpr * z, `the floor under one device px at z ${z}, dpr ${dpr}`).toBeCloseTo(1 + 1 / 64, 12);
				expect(plan.dot * dpr * z, `device px of the dot radius at z ${z}, dpr ${dpr}`).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-12);
				expect(plan.rule).toBeGreaterThanOrEqual(1);
				expect(plan.dot).toBeGreaterThanOrEqual(1);
				expect(plan.pitch, `pitch at z ${z}, dpr ${dpr}`).toBe(base.pitch);
				const dev = dpr * z, onGrid = plan.phase! * dev;
				expect(Math.abs(onGrid - Math.round(onGrid)), `phase ${plan.phase} on the device px grid at z ${z}, dpr ${dpr}`).toBeLessThanOrEqual(dev / 128 + 1e-9);
				const off = (((plan.phase! - 10.3) % plan.pitch) + plan.pitch) % plan.pitch;
				expect(Math.min(off, plan.pitch - off), `phase within half a device px of the origin at z ${z}, dpr ${dpr}`).toBeLessThanOrEqual(0.5 / dev + 1 / 128 + 1e-9);
			}
		// At 10 percent and dpr 2 the literal rule is a fifth of a device px; the plan is 1 + 1/64.
		expect(paperPlan(16, 0, 0.2)!.rule).toBe(5.078125);
		expect(paperPlan(16, 0, 0.2)!.dot).toBe(Math.SQRT1_2 / 0.2);
	});

	it("puts the phase on the note origin, mod the pitch, on the device px grid, in [0, pitch), to 1/64 px", () => {
		const at = (font: number, y: number | null, dev = 1) => paperPlan(font, y, dev)!.phase;
		expect(at(16, 0)).toBe(0);
		expect(at(16, 28)).toBe(0);
		// One device px per layout px: the origin to the nearest whole px.
		expect(at(16, 10.3)).toBe(10);
		expect(at(16, 38.3)).toBe(10);
		expect(at(16, 10.5)).toBe(11);
		expect(at(16, -10)).toBe(18);
		expect(at(24, 50)).toBe(8);
		expect(at(17.6, 40)).toBe(9);
		// Two device px per layout px: to the nearest half px; half a device px per layout px: to the nearest 2 px.
		expect(at(16, 10.3, 2)).toBe(10.5);
		expect(at(16, 10.3, 0.5)).toBe(10);
		expect(at(16, 11.2, 0.5)).toBe(12);
		// With no usable device ratio, the fold alone, to 1/64 px.
		expect(at(16, 10.3, 0)).toBe(10.296875);
		// Rounds up onto the pitch itself: wraps to 0, never equal to the pitch.
		expect(at(16, 27.999)).toBe(0);
		for (const [font, y] of [[16, 10.3], [24, -300.2], [17.6, 7.2], [12, 1000.01]] as const)
			for (const dev of [1, 2, 0.6, 0.2]) {
				const plan = paperPlan(font, y, dev)!;
				expect(plan.phase! * 64, `phase ${plan.phase} at ${font} px, origin ${y}, ${dev} device px per px`).toBe(Math.round(plan.phase! * 64));
				expect(plan.phase).toBeGreaterThanOrEqual(0);
				expect(plan.phase).toBeLessThan(plan.pitch);
				const off = (((plan.phase! - y) % plan.pitch) + plan.pitch) % plan.pitch;
				expect(Math.min(off, plan.pitch - off), `phase vs origin at ${font} px, ${dev} device px per px`).toBeLessThanOrEqual(0.5 / dev + 1 / 128 + 1e-9);
			}
		expect(at(16, null)).toBeNull();
		expect(at(16, Number.NaN)).toBeNull();
	});

	it("puts the x phase on the text column's left edge by the same rule, and plans none without a column", () => {
		const at = (font: number, x: number | null) => paperPlan(font, 7, 1, x)!.phaseX;
		expect(at(16, 0)).toBe(0);
		expect(at(16, 10.3)).toBe(10);
		expect(at(16, 38.3)).toBe(10);
		expect(at(16, -10)).toBe(18);
		expect(at(24, 50)).toBe(8);
		expect(at(16, 27.999)).toBe(0);
		expect(at(16, null)).toBeNull();
		expect(at(16, Number.NaN)).toBeNull();
		// The y phase is untouched by the column, and a caller that passes no column gets no x phase.
		expect(paperPlan(16, 10.3, 1, 5)!.phase).toBe(10);
		expect(paperPlan(16, 10.3, 1)!.phaseX).toBeNull();
	});

	it("plans nothing for a text size that is not a finite positive number", () => {
		for (const font of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(paperPlan(font, 0, 1)).toBeNull();
	});
});

describe("control: the formula that shipped", () => {
	it("re-levels with the zoom: 448 px at 10 percent", () => {
		expect(shippedPlan(0.1, 16).pitch).toBe(448);
	});

	it.fails("fails the table at a larger text size (28 px under 24 px text)", () => {
		const plan = shippedPlan(1, 24);
		expect(plan.pitch).toBeCloseTo(ROWS[1]![1], 9);
	});
});
