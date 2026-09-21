import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { launch, type Browser, type BrowserEngine } from "./harness";
import css from "../../styles.css?raw";
import type {} from "./notePaperPage";

describe.each(["chromium", "webkit"] satisfies BrowserEngine[])("per-note paper CSS in %s", engine => {
	let browser: Browser;
	let script: string;
	beforeAll(async () => {
		const bundled = await build({ entryPoints: [fileURLToPath(new URL("./notePaperPage.ts", import.meta.url))], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
			alias: { obsidian: fileURLToPath(new URL("../obsidian-stub.ts", import.meta.url)) } });
		script = bundled.outputFiles[0]!.text;
		browser = await launch(engine);
	});
	afterAll(async () => { await browser?.close(); });
	it("keeps notes and a second-window pane independent and restores global CSS on cleanup", async () => {
		const page = await browser.newPage();
		try {
			const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
			await page.setContent("<!doctype html><html><head></head><body></body></html>");
			await page.addScriptTag({ content: script });
			const result = await page.evaluate(css => window.paperProbe(css), css);
			expect(result.initial.map(item => item.attribute)).toEqual(["lines", "none", null, "lines"]);
			expect(result.initial[0]!.image.match(/repeating-linear-gradient/g)).toHaveLength(1);
			expect(result.initial[1]!.image).toBe("none");
			expect(result.initial[2]!.image.match(/repeating-linear-gradient/g)).toHaveLength(2);
			expect(result.initial[3]!.image).toBe(result.initial[0]!.image);
			for (const index of [0, 3]) {
				expect(result.changed[index]!.image).toContain("radial-gradient");
				expect(result.changed[index]!.size.split(", ").every(size => size === "28px 28px"), result.changed[index]!.size).toBe(true);
			}
			expect(result.switched[0]!.image).toBe("none");
			expect(result.switched[1]!.image).toBe("none");
			expect(result.switched[2]!.image).toBe(result.initial[0]!.image);
			expect(result.switched[3]!.image).toContain("radial-gradient");
			for (const { global, override, result: item } of result.matrix) {
				const effective = override === "default" ? global : override;
				if (effective === "none") expect(item.image).toBe("none");
				else if (effective === "dots") expect(item.image).toContain("radial-gradient");
				else expect(item.image.match(/repeating-linear-gradient/g)).toHaveLength(effective === "grid" ? 2 : 1);
				// Dots tile one pitch square on every layer; lined and grid paper, and
				// none, are untiled.
				if (effective === "dots") expect(item.size.split(", ").every(size => size === "28px 28px"), item.size).toBe(true);
				else expect(item.size.split(", ").every(value => value === "auto"), item.size).toBe(true);
			}
			for (const item of result.cleared) {
				expect(item.attribute).toBeNull();
				expect(item.image).toBe(result.initial[0]!.image);
				expect(item.size).toBe("auto");
			}
			for (const item of [...result.initial, ...result.changed, ...result.switched, ...result.cleared]) {
				expect(item.text).toBe("note textreading textPDF");
				expect(item.reading).toBe("none"); expect(item.pdf).toBe("none");
				if (item.image !== "none") expect(item.attachment.split(", ").every(value => value === "local")).toBe(true);
			}
			expect(result.writes).toBe(0);
			expect(errors).toEqual([]);
		} finally { await page.close(); }
	});
});
