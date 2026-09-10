import { describe, expect, it } from "vitest";
import css from "../styles.css?raw";
import main from "./main.ts?raw";

function rule(selector: string): string {
	const start = css.indexOf(selector);
	expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
	const open = css.indexOf("{", start);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

describe("the light page stays inside the dedicated canvas boundary", () => {
	it("gives the dedicated canvas light paper and readable typed text", () => {
		expect(rule(".handwriting-root")).toContain("background: #ffffff");
		expect(rule(".handwriting-box")).toContain("color: #1c1f26");
		const editing = rule(".handwriting-box.is-editing");
		expect(editing).toContain("background: #ffffff");
		expect(editing).toContain("border-color: rgba(28, 31, 38, 0.2)");
	});

	it("does not turn inline notes or PDF overlays into white sheets", () => {
		for (const selector of [
			".markdown-source-view.handwriting-page",
			".handwriting-pdf-ink",
			".handwriting-embed-ink",
		]) {
			const blocks = [...css.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[^\\{]*\\{([^}]*)\\}`, "g"))];
			for (const match of blocks) expect(match[1]).not.toMatch(/background(?:-color)?:\s*#fff(?:fff)?/i);
		}
	});
});

describe("the obsolete live-adaptation control is gone without migration", () => {
	it("removes only the row and retains the compatibility key", () => {
		expect(main).not.toContain('name: "Adapt ink colour to the theme"');
		expect(main).toContain("inkAdaptsToTheme: boolean;");
		expect(main).toContain("inkAdaptsToTheme: false,");
		expect(main).toContain("inkAdaptsToTheme: raw?.inkAdaptsToTheme === true,");
		expect(main).toContain('case "inkAdaptsToTheme":');
	});

	it("leaves both export controls present", () => {
		expect(main).toContain('name: "Ink color when exporting"');
		expect(main).toContain('name: "Ink color when flattening PDFs"');
	});
});
