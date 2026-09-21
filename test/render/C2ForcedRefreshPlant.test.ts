/**
 * A DETERMINISTIC version of the C2 finding - instead of
 * leaving the race to natural mount timing (11/12 reps in the earlier
 * reads), drive a real pinch to its end (creates the pan-anchor hold,
 * schedules its held-consumer measure) and call the private
 * `refreshViewportColumn` directly in the SAME synchronous tick, before any
 * frame lets the held measure run. If `refreshViewportColumn` still runs
 * (`ran: true`) and the hold survives (`after.strokes`... - read via
 * `holdBefore`/`after`, the hold object itself is read before and after),
 * that rules out "the window just got narrower", not only "it didn't happen
 * to fire this time". The page perturbs the frozen column first, so the
 * refresh re-commits on this rig by construction (asserted below), not
 * through deferral C3. Part 2 of C2 must carry the hold through it.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";

declare const process: { env: Record<string, string | undefined> };
const root = fileURLToPath(new URL("../../", import.meta.url));
let browser: Browser, script: string;
const reports: unknown[] = [];

beforeAll(async () => {
	browser = await chromium.launch({ headless: true });
	script = (await build({
		entryPoints: [root + "test/render/scrollColumnAnchorPage.ts"], bundle: true, write: false, format: "iife", platform: "browser",
		alias: { obsidian: root + "test/render/iphoneObsidianStub.ts" },
	})).outputFiles[0]!.text;
}, 180_000);

afterAll(async () => {
	await browser?.close();
	if (process.env.HW_C2_FORCED_REPORT) writeFileSync(process.env.HW_C2_FORCED_REPORT, JSON.stringify(reports, null, 1));
});

it("forced: refreshViewportColumn called synchronously inside a pending settle hold, 5 reps", async () => {
	const results: unknown[] = [];
	for (let i = 0; i < 5; i++) {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
		try {
			await page.addScriptTag({ content: script });
			const r: any = await page.evaluate(() => (window as any).scrollColumnAnchor.runTearForcedRefreshPlant(0.1, 60090, null, true, { fx: 0.5, fy: 0.5 }, 900, 450));
			r.settled = await page.evaluate(() => (window as any).scrollColumnAnchor.runTearForcedRefreshSettled());
			results.push(r);
			// eslint-disable-next-line no-console
			console.log(`FORCED-PLANT rep=${i}: ran=${r.ran} hadHold=${r.hadHold} outcomeBefore=${r.outcomeBefore} outcomeAfter=${r.outcomeAfter} stillHeld=${r.stillHeld} generationChanged=${r.generationChanged} settled=${JSON.stringify(r.settled)}`);
			await page.evaluate(() => (window as any).scrollColumnAnchor.runTearTeardown());
		} finally {
			await page.close();
		}
	}
	reports.push(...results);
	// eslint-disable-next-line no-console
	console.log(`FORCED-PLANT ran-distribution: ${JSON.stringify(results.map((r: any) => r.ran))}`);
	// Liveness only: the method must actually have been reachable (ran=true)
	// for a green "no cancel" reading to mean anything - a false "ran" would
	// be a vacuous plant (its own guard refused, not C1 closing the race).
	expect(results.length).toBe(5);
	// PART 2: a same-scale re-commit with no settle of its own carries the pending hold instead of retiring it.
	for (const [i, r] of (results as any[]).entries()) {
		expect(r.ran, `rep ${i}: refreshViewportColumn measured`).toBe(true);
		expect(r.generationChanged, `rep ${i}: the forced refresh re-committed`).toBe(true);
		expect(r.hadHold, `rep ${i}: the pinch end left a hold`).toBe(true);
		expect(r.outcomeBefore, `rep ${i}: the hold was pending when the refresh ran`).toBe("pending");
		expect(r.outcomeAfter, `rep ${i}: the refresh left the hold pending`).toBe("pending");
		expect(r.stillHeld, `rep ${i}: the same hold is still the overlay's`).toBe(true);
		expect(r.settled.outcome, `rep ${i}: the carried hold converged after frames`).toBe("converged");
		expect(r.settled.holdRemaining, `rep ${i}: no hold left behind`).toBe(false);
	}
}, 120_000);

for (const panEngaged of [false, true]) {
	it(`a pane resize inside the settle commit does not fail the settle, and the scroll stays where the settle put it: pan=${panEngaged}`, async () => {
		for (let rep = 0; rep < 3; rep++) {
			const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
			try {
				await page.addScriptTag({ content: script });
				const r: any = await page.evaluate(p => (window as any).scrollColumnAnchor.runTearSettleResize("before-release", p, 900, 450), panEngaged);
				reports.push({ kind: "settle-resize-nested", rep, ...r });
				// eslint-disable-next-line no-console
				console.log(`SETTLE-RESIZE nested pan=${panEngaged} rep=${rep} ${JSON.stringify(r)}`);
				// The regime: the pane narrowed, the settle committed once, and its handleResize nested a same-scale commit.
				expect(r.paneNarrowed, `rep ${rep}: the pane narrowed`).toBe(true);
				expect(r.settleCommits, `rep ${rep}: one settle commit`).toBe(1);
				expect(r.nested, `rep ${rep}: a same-scale commit nested inside the settle commit`).toBe(true);
				expect(r.outcome, `rep ${rep}: the nested commit is not a second consumer of the hold`).not.toBe("failed");
				expect(r.holdRemaining, `rep ${rep}: no hold left behind`).toBe(false);
				expect(r.final, `rep ${rep}: the scroll stays where the settle commit put it`).toEqual(r.landing);
				await page.evaluate(() => (window as any).scrollColumnAnchor.runTearTeardown());
			} finally { await page.close(); }
		}
	}, 120_000);

	it(`a pane resize while the settle is pending carries the settle to convergence: pan=${panEngaged}`, async () => {
		for (let rep = 0; rep < 3; rep++) {
			const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
			try {
				await page.addScriptTag({ content: script });
				const r: any = await page.evaluate(p => (window as any).scrollColumnAnchor.runTearSettleResize("during-hold", p, 900, 450), panEngaged);
				reports.push({ kind: "settle-resize-pending", rep, ...r });
				// eslint-disable-next-line no-console
				console.log(`SETTLE-RESIZE pending pan=${panEngaged} rep=${rep} ${JSON.stringify(r)}`);
				expect(r.paneNarrowed, `rep ${rep}: the pane narrowed`).toBe(true);
				expect(r.outcomeAtRelease, `rep ${rep}: the settle was pending when the resize ran`).toBe("pending");
				expect(r.nested, `rep ${rep}: the resize commit was not nested`).toBe(false);
				expect(r.outcome, `rep ${rep}: the settle converged through the resize`).toBe("converged");
				expect(r.holdRemaining, `rep ${rep}: no hold left behind`).toBe(false);
				expect(r.final, `rep ${rep}: the scroll stays where the settle commit put it`).toEqual(r.landing);
				await page.evaluate(() => (window as any).scrollColumnAnchor.runTearTeardown());
			} finally { await page.close(); }
		}
	}, 120_000);
}

it("a same-scale commit inside CodeMirror's update does not carry a pending settle, and the plugin survives", async () => {
	for (let rep = 0; rep < 3; rep++) {
		const page = await browser.newPage({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 });
		try {
			await page.addScriptTag({ content: script });
			const r: any = await page.evaluate(() => (window as any).scrollColumnAnchor.runTearUpdateCarry(900, 450));
			reports.push({ kind: "settle-commit-in-update", rep, ...r });
			// eslint-disable-next-line no-console
			console.log(`SETTLE-IN-UPDATE rep=${rep} ${JSON.stringify(r)}`);
			// The regime: a pending settle, the font and the pane both changed, and a commit ran inside CodeMirror's update.
			expect(r.outcomeAtRelease, `rep ${rep}: the settle was pending`).toBe("pending");
			expect(r.fontChanged, `rep ${rep}: the content font size changed`).toBe(true);
			expect(r.paneNarrowed, `rep ${rep}: the pane narrowed`).toBe(true);
			expect(r.inUpdateCommits, `rep ${rep}: a commit ran inside CodeMirror's update`).toBeGreaterThan(0);
			expect(r.threw, `rep ${rep}: no commit threw`).toEqual([]);
			expect(r.crashed, `rep ${rep}: CodeMirror did not deactivate the plugin`).toBe(false);
			expect(r.holdRemaining, `rep ${rep}: no hold left behind`).toBe(false);
			await page.evaluate(() => (window as any).scrollColumnAnchor.runTearTeardown());
		} finally { await page.close(); }
	}
}, 120_000);
