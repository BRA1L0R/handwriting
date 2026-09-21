import { describe, expect, it } from "vitest";
import { copyPreviewPaperBackground, fractionOf, previewPaperCopyable, previewPaperPhase, previewPaperPitch } from "./PaperPan";

describe("previewPaperPhase and fractionOf: what the preview paper's rounding lands on the grid", () => {
	const phaseOf = (value: string) => previewPaperPhase({ getPropertyValue: (name: string) => name === "--handwriting-paper-phase" ? value : "" }, "--handwriting-paper-phase");
	it.each([["4px", 4], ["13.328125px", 13.328125], ["-2px", -2], ["0px", 0]] as const)("phase %j reads %s layout px", (value, phase) => {
		expect(phaseOf(value)).toBe(phase);
	});
	it.each([["1.5em"], [""], ["calc(4px)"]] as const)("phase %j is not planned here and reads 0", value => {
		expect(phaseOf(value)).toBe(0);
	});
	it.each([[12, 0], [12.4, 0.4], [-0.25, 0.75], [11.9999999, 0], [Number.NaN, 0]] as const)("the fraction of %s is %s", (v, f) => {
		expect(fractionOf(v)).toBeCloseTo(f, 9);
	});
});

const pitchOf = (value: string) => previewPaperPitch({ getPropertyValue: (name: string) => name === "--handwriting-paper-pitch" ? value : "" });

describe("previewPaperPitch: the preview paper folds only by a pitch that is a px length", () => {
	it.each([
		["28px", 28], [" 16.8px ", 16.8], [".5px", 0.5], ["40.25px", 40.25],
	] as const)("%j is a pitch of %s layout px", (value, pitch) => {
		expect(pitchOf(value)).toBe(pitch);
	});

	it.each([
		["2.5rem"], ["calc(28px)"], ["bogus"], [""], ["0px"], ["-28px"], ["28"], ["28 px"], ["NaNpx"],
	] as const)("%j is no pitch: the scroller's own route carries the note", value => {
		expect(pitchOf(value)).toBeNull();
	});
});

describe("previewPaperCopyable: only the paper this overlay planned, on its own pitch, attached to the text", () => {
	// A 28 px pitch: the lined stops run 4 -> 32, the across ones 0 -> 28, and the dots' tile is 28 px square.
	const lines = "repeating-linear-gradient(rgba(0, 0, 0, 0) 4px, rgba(0, 0, 0, 0) 31px, rgb(54, 54, 54) 31px, rgb(54, 54, 54) 32px)";
	const across = "repeating-linear-gradient(to right, rgba(0, 0, 0, 0) 0px, rgba(0, 0, 0, 0) 27px, rgb(54, 54, 54) 27px, rgb(54, 54, 54) 28px)";
	const dots = "radial-gradient(circle, rgb(54, 54, 54) 1px, rgba(0, 0, 0, 0) 1.5px)";
	// A theme's own gradients on the scroller, attached local, with periods of their own: the cost harness's control arm.
	const themeOwn = "repeating-linear-gradient(11deg, rgba(0, 0, 0, 0.02) 0px, rgba(0, 0, 0, 0.02) 1px, rgba(0, 0, 0, 0) 1px, rgba(0, 0, 0, 0) 6px)";

	it.each([
		["lined", lines, "local", "auto"],
		["grid, two layers whose stops carry commas", `${lines}, ${across}`, "local, local", "auto, auto"],
		["dotted, a tile one pitch square", dots, "local", "28px 28px"],
	] as const)("%s paper is copyable", (_label, image, attachment, size) => {
		expect(previewPaperCopyable({ backgroundImage: image, backgroundAttachment: attachment, backgroundSize: size }, 28)).toBe(true);
	});

	it.each([
		["no paper", "none", "local", "auto"],
		["an empty value", "", "local", "auto"],
		["a theme's image", 'url("paper.png")', "local", "auto"],
		["a gradient beside a theme's image", `${lines}, url("x.png")`, "local, local", "auto, auto"],
		["paper a theme attached to the pane", lines, "scroll", "auto"],
		["grid with one layer re-attached", `${lines}, ${across}`, "local, fixed", "auto, auto"],
		["a theme's own gradients, on their own period", themeOwn, "local", "auto"],
		["the paper's kind at another pitch", lines, "local", "auto"],
		["dots on a tile that is not the pitch", dots, "local", "20px 20px"],
	] as const)("%s is not copyable", (_label, image, attachment, size) => {
		const pitch = _label === "the paper's kind at another pitch" ? 42 : 28;
		expect(previewPaperCopyable({ backgroundImage: image, backgroundAttachment: attachment, backgroundSize: size }, pitch)).toBe(false);
	});
});

describe("copyPreviewPaperBackground: the resolved background, and not its attachment", () => {
	it("copies image, size, position, repeat, colour, origin and clip as the scroller resolved them", () => {
		const style: Record<string, string> = {};
		const cs = {
			getPropertyValue: () => "", backgroundImage: "radial-gradient(circle, red 1px, transparent 1.5px)", backgroundSize: "28px 28px",
			backgroundPosition: "3px 4px", backgroundRepeat: "repeat", backgroundColor: "rgb(30, 30, 30)", backgroundOrigin: "padding-box",
			backgroundClip: "border-box", backgroundAttachment: "local",
		};
		copyPreviewPaperBackground({ style: style as unknown as CSSStyleDeclaration }, cs as unknown as CSSStyleDeclaration);
		expect(style).toEqual({
			backgroundImage: cs.backgroundImage, backgroundSize: "28px 28px", backgroundPosition: "3px 4px", backgroundRepeat: "repeat",
			backgroundColor: "rgb(30, 30, 30)", backgroundOrigin: "padding-box", backgroundClip: "border-box",
		});
	});
});
