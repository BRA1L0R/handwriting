import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { fileURLToPath } from "node:url";
import css from "../../styles.css?raw";

let browser: Browser, script: string;

beforeAll(async () => {
	const built = await build({
		entryPoints: [fileURLToPath(new URL("./ribbonWidthFloorPage.ts", import.meta.url))],
		bundle: true, write: false, format: "iife", platform: "browser",
		alias: { obsidian: fileURLToPath(new URL("./iphoneObsidianStub.ts", import.meta.url)) },
	});
	script = built.outputFiles[0]!.text;
	browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

async function mounted() {
	const p = await browser.newPage({ viewport: { width: 700, height: 540 } });
	await p.setContent("<!doctype html><body></body>");
	await p.addStyleTag({ content: css });
	await p.addScriptTag({ content: script });
	return p;
}

it("the width floor is the pixel-identity at 100% (backing===dpr)", async () => {
	const p = await mounted();
	try {
		const res = await p.evaluate(() => (window as any).ribbonWidthFloorIdentity());
		expect(res.identical, `first differing byte at index ${res.firstDiffAt} of ${res.length}`).toBe(true);
	} finally { await p.close(); }
});

it("committed ink at 12.5% pinch reads back at least one device pixel wide (peak alpha >=128, count >0)", async () => {
	const p = await mounted();
	const errors: string[] = [];
	p.on("pageerror", e => errors.push(String(e)));
	try {
		const res = await p.evaluate(() => (window as any).ribbonWidthFloorRun());
		expect(errors, "page errors").toEqual([]);
		// eslint-disable-next-line no-console
		console.log("\n===== ribbon width floor =====");
		for (const key of ["at100Default", "at12_5Default", "at100Thin", "at12_5Thin"] as const) {
			const r = (res as any)[key];
			console.log(`${key.padEnd(14)} zoom=${r.zoomBefore} pressure=${r.pressure} backing=${r.backing} dpr=${r.dpr} strokes=${r.strokeCount} peakAlpha=${r.stats?.peakAlpha} countAtLeast128=${r.stats?.countAtLeast128} countAboveZero=${r.stats?.countAboveZero}`);
		}
		// Pass condition per the ruling: peak alpha >= 128 AND count > 0, at
		// the low-pressure ("hairline") arm, which is the one the floor must
		// rescue. This is the assertion that goes RED without the floor.
		expect(res.at12_5Thin.stats.peakAlpha).toBeGreaterThanOrEqual(128);
		expect(res.at12_5Thin.stats.countAtLeast128).toBeGreaterThan(0);
		// The default-pressure arm was already borderline-visible before the
		// floor (peak 176); it must stay visible too.
		expect(res.at12_5Default.stats.peakAlpha).toBeGreaterThanOrEqual(128);
		expect(res.at12_5Default.stats.countAtLeast128).toBeGreaterThan(0);
	} finally { await p.close(); }
}, 60_000);

it("committedBacking does not move just because cssScale was mutated with no reallocation in between", async () => {
	// NOT a pixel-identity test: a direct cssScale mutation (with no
	// handleResize/reallocation) also perturbs the router's screen->world
	// conversion for the pen input the fixture draws with (cssScale is the
	// divisor `InlinePenRouter.sampleFrom`'s scaleProvider uses), so the
	// drawn stroke's own WORLD geometry differs between a mutated and an
	// unmutated run - a confound unrelated to the floor. Comparing painted
	// pixels across that mutation does not isolate the floor's behaviour, so
	// this asserts the one thing a cssScale mutation can prove cheaply and
	// unconfounded: the STORED field itself is untouched by it. See
	// HANDBACK.md for why the full locked-frame paint scenario is not
	// reproduced end-to-end.
	const p = await mounted();
	const errors: string[] = [];
	p.on("pageerror", e => errors.push(String(e)));
	try {
		const res = await p.evaluate(() => (window as any).ribbonWidthFloorLockedCheck(0.05));
		expect(errors, "page errors").toEqual([]);
		expect(res.backingAfterMutation).toBe(res.backingBeforeMutation);
	} finally { await p.close(); }
}, 60_000);
