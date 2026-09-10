/**
 * The strip's buttons at rest wear the THEME'S surface, and that is chosen.
 *
 * Found by the host stylesheet sweep of 2026-09-07, the same sweep that found
 * the chip's height and the knob's hover colour: `.handwriting-mobile-tool`
 * declares `background: transparent; box-shadow: none; color: var(--text-muted)`
 * at specificity (0,1,0), and Obsidian's own `button:not(.clickable-icon)`
 * declares a colour, a background and a shadow at (0,1,1). The host wins all
 * three, so at rest every button on the strip shows the theme's button face
 * and not the transparent one the file spells out. The owner's ruling, when
 * shown: "i think the obsidian rule should work, people will like that they
 * can customize the toolbar slightly." SO THE HOST'S SURFACE STAYS. This
 * file exists so the next sweep reads that as a decision and not as a defect
 * to fix back.
 *
 * What it pins, on one and the same button, under the host's reduced sheet
 * and without it:
 *   - at REST the host's surface shows with the host in the cascade, and the
 *     plugin's transparent one shows without - the two ARE different, by
 *     design, and the difference is measured off the composited pixels;
 *   - ACTIVE, HOVERED and PRESSED are the plugin's, with the host or
 *     without: those rules are (0,2,0) and (0,3,0) and beat the host's
 *     (0,1,1) outright;
 *   - the `.handwriting-mobile-tool` that is a DIV (the settings preview's
 *     fixed row, `FoldOrderControl.ts`) is never a `button`, so the host's
 *     rule never reaches it and the plugin's transparent declaration is
 *     what paints it, host or no host.
 *
 * "the strip is the same before and after" is a claim about two commits and
 * no single run can make it; what this file gives a reviewer is one set of
 * numbers to take at each and compare. They were compared (2026-09-07) and
 * matched to the pixel.
 *
 * Run: npm run test:render.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { hostFixture, hostVars, launch, openFoldOrder, openStrip } from "./harness";

let browser: Browser;
beforeAll(async () => {
	browser = await launch();
});
afterAll(async () => {
	await browser?.close();
});

/**
 * The whole reduced host button, box and surface. The tokens are the app's
 * desktop values where the app has one value, and a stated choice where it
 * has several: `--interactive-normal` is given a grey no other injected
 * token uses, so a pixel that reads it can only have come from the host's
 * rule.
 */
const HOST_BUTTON_CSS = [hostFixture("obsidian-button-rules.css"), hostFixture("obsidian-button-surface-rules.css")];
const HOST_SURFACE = "#c8ccd2";
const HOST_BUTTON_VARS = hostVars({
	"--input-height": "30px",
	"--input-font-weight": "400",
	"--font-ui-small": "13px",
	"--button-radius": "5px",
	"--size-4-1": "4px",
	"--size-4-3": "12px",
	"--interactive-normal": HOST_SURFACE,
	"--input-shadow": "inset 0 0 0 1px rgba(0, 0, 0, 0.12)",
	"--text-color": "#1f1f1f",
});

/**
 * The tokens the plugin's OWN hover and pressed rules read, which the
 * harness does not inject. They are the theme's, not the host's, so both
 * pages get them: without them those two rules are invalid at
 * computed-value time and would paint nothing, and the comparison below
 * would be of two absences.
 */
const THEME_STATE_VARS = hostVars({
	"--background-modifier-hover": "#dfe3ea",
	"--background-modifier-active-hover": "#cfd5df",
});

type Rgb = [number, number, number];
const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const parseRgb = (css: string): Rgb => {
	const m = css.match(/(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/);
	if (!m) throw new Error(`not a colour: ${css}`);
	return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const hexToRgb = (hex: string): Rgb => {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const show = (c: Rgb): string => `rgb(${c.map((v) => v.toFixed(1)).join(", ")})`;

/** A painted colour is within this of the token it should be. */
const TOLERANCE = 8;

interface StateRead {
	backgroundColor: string;
	boxShadow: string;
	color: string;
	/** What the element was when read: its classes and any inline style. */
	className: string;
	inline: string;
}

interface SurfaceProbe {
	tag: string;
	/** `(hover: hover)` matched, so the plugin's hover rule is in force. */
	hoverMedia: boolean;
	rest: StateRead;
	active: StateRead;
	pressed: StateRead;
	hover: StateRead;
	/** Painted: a pixel inside the resting button clear of its icon. */
	restPainted: Rgb;
	/** Painted: the strip just outside that button, what "transparent" shows. */
	behindPainted: Rgb;
}

/** Read one pixel of a screenshot, averaged over a 3x3 patch. */
const patch = async (
	page: Page,
	png: { toString(encoding: "base64"): string },
	x: number,
	y: number
): Promise<Rgb> =>
	page.evaluate(
		async ({ url, x, y }: { url: string; x: number; y: number }) => {
			const img = new Image();
			img.src = url;
			await img.decode();
			const canvas = document.createElement("canvas");
			canvas.width = img.naturalWidth;
			canvas.height = img.naturalHeight;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("no 2d context");
			ctx.drawImage(img, 0, 0);
			const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const sum: [number, number, number] = [0, 0, 0];
			let n = 0;
			for (let yy = y - 1; yy <= y + 1; yy++) {
				for (let xx = x - 1; xx <= x + 1; xx++) {
					const i = (yy * width + xx) * 4;
					sum[0] += data[i] ?? 0;
					sum[1] += data[i + 1] ?? 0;
					sum[2] += data[i + 2] ?? 0;
					n++;
				}
			}
			return [sum[0] / n, sum[1] / n, sum[2] / n] as [number, number, number];
		},
		{ url: `data:image/png;base64,${png.toString("base64")}`, x, y }
	);

/** The first idle tool on the strip, read in each of its states. */
const surfaceAt = async (withHost: boolean): Promise<SurfaceProbe> => {
	const h = await openStrip(browser, {
		hostCss: withHost ? [...HOST_BUTTON_CSS, HOST_BUTTON_VARS, THEME_STATE_VARS] : [THEME_STATE_VARS],
	});
	try {
		// Resolved ONCE to a handle. A locator re-resolves on every call, so
		// the moment `is-active` is added to "the first idle tool" the first
		// idle tool is the next button along, and every state below would
		// be read off a different element (measured 2026-09-07).
		const first = h.page
			.locator(".handwriting-mobile-tool:not(.is-active):not(.is-disabled):not([hidden])")
			.first();
		expect(await first.count(), "no idle tool on the strip").toBeGreaterThan(0);
		const idle = await first.elementHandle();
		if (!idle) throw new Error("the idle tool has no handle");

		const read = async (): Promise<StateRead> =>
			idle.evaluate((el: HTMLElement) => {
				const cs = getComputedStyle(el);
				return {
					backgroundColor: cs.backgroundColor,
					boxShadow: cs.boxShadow,
					color: cs.color,
					className: el.className,
					inline: el.getAttribute("style") ?? "",
				};
			});

		await h.page.mouse.move(0, 0);
		const meta = await idle.evaluate((el: HTMLElement) => ({
			tag: el.tagName,
			hoverMedia: window.matchMedia("(hover: hover)").matches,
		}));
		const rest = await read();

		await idle.evaluate((el: HTMLElement) => el.classList.add("is-active"));
		const active = await read();
		await idle.evaluate((el: HTMLElement) => el.classList.remove("is-active"));

		await idle.evaluate((el: HTMLElement) => el.classList.add("is-pressed"));
		const pressed = await read();
		await idle.evaluate((el: HTMLElement) => el.classList.remove("is-pressed"));

		await idle.hover();
		const hover = await read();
		await h.page.mouse.move(0, 0);

		// PAINTED. The resting button's face 4px in from its left edge, at
		// its vertical middle: inside the 8px corner radius' straight run,
		// clear of the 18px icon centred in the 32px box, and clear of the
		// host's 1px inset ring. And the strip's own top padding straight
		// above that point - 4px of padding inside a 1px border, so row 2
		// is bare strip - for what "transparent" resolves to on this page.
		// Not the neighbouring gap: it is 2px wide, and the button on the
		// other side of it is the active tool, filled with the accent.
		// Both pixels go through the strip's own opacity, which is why they
		// are compared with each other and not with a token.
		const box = await idle.boundingBox();
		if (!box) throw new Error("the idle tool has no box");
		const strip = h.page.locator(".handwriting-mobile-tools").first();
		const sbox = await strip.boundingBox();
		if (!sbox) throw new Error("the strip has no box");
		const shot = await strip.screenshot();
		const restPainted = await patch(
			h.page,
			shot,
			Math.round(box.x - sbox.x + 4),
			Math.round(box.y - sbox.y + box.height / 2)
		);
		const behindPainted = await patch(h.page, shot, Math.round(box.x - sbox.x + 4), 2);

		return { ...meta, rest, active, pressed, hover, restPainted, behindPainted };
	} finally {
		await h.close();
	}
};

/** The settings preview's fixed row: `.handwriting-mobile-tool`s that are DIVs. */
const fixedDivAt = async (withHost: boolean): Promise<{ tag: string; backgroundColor: string; count: number }> => {
	const h = await openFoldOrder(browser, {
		realStrip: true,
		modalWidth: 700,
		viewport: 1400,
		hostCss: withHost ? [...HOST_BUTTON_CSS, HOST_BUTTON_VARS] : undefined,
	});
	try {
		return await h.page.evaluate(() => {
			const divs = Array.from(document.querySelectorAll<HTMLElement>(".handwriting-fold-fixed-btn"));
			const first = divs[0];
			if (!first) throw new Error("no fixed-row buttons in the fold order control");
			return {
				tag: first.tagName,
				backgroundColor: getComputedStyle(first).backgroundColor,
				count: divs.length,
			};
		});
	} finally {
		await h.close();
	}
};

const TRANSPARENT = "rgba(0, 0, 0, 0)";

describe("the strip's buttons at rest show the host's button surface, on purpose", () => {
	it("keeps the host's resting surface, and keeps active, hover and pressed its own, on the same button with the host's rule and without it", async () => {
		const plain = await surfaceAt(false);
		const host = await surfaceAt(true);

		// THE THING READ IS A BUTTON, on both pages, and hover exists.
		expect(plain.tag).toBe("BUTTON");
		expect(host.tag).toBe("BUTTON");
		expect(plain.hoverMedia, "this page has no hover; the hover reading below is vacuous").toBe(true);

		const surface = hexToRgb(HOST_SURFACE);
		// eslint-disable-next-line no-console
		console.log(
			`strip button read: "${plain.rest.className}" inline "${plain.rest.inline}"; as active "${plain.active.className}" inline "${plain.active.inline}"`
		);
		// eslint-disable-next-line no-console
		console.log(
			`strip rest: plain ${plain.rest.backgroundColor} / ${plain.rest.boxShadow} / ${plain.rest.color}, painted ${show(
				plain.restPainted
			)} on ${show(plain.behindPainted)}; with host ${host.rest.backgroundColor} / ${host.rest.boxShadow} / ${
				host.rest.color
			}, painted ${show(host.restPainted)} on ${show(host.behindPainted)}; active ${plain.active.backgroundColor} | ${
				host.active.backgroundColor
			}; hover ${plain.hover.backgroundColor} | ${host.hover.backgroundColor}; pressed ${
				plain.pressed.backgroundColor
			} | ${host.pressed.backgroundColor}`
		);

		// AT REST, WITHOUT THE HOST: the plugin's own declaration, transparent
		// and unshadowed, and the pixel inside the button is the strip's.
		expect(plain.rest.backgroundColor).toBe(TRANSPARENT);
		expect(plain.rest.boxShadow).toBe("none");
		expect(distance(plain.restPainted, plain.behindPainted), "the plain button paints a surface of its own").toBeLessThanOrEqual(
			TOLERANCE
		);

		// AT REST, WITH THE HOST: the host's surface, BY DESIGN. The
		// computed value is the host's token and the painted pixel is that
		// token's colour, not the strip's behind it. If this ever reads
		// transparent, someone has "fixed" the resting surface the owner
		// chose to keep - see the comment at `.handwriting-mobile-tool` in
		// styles.css before changing this expectation.
		expect(host.rest.backgroundColor).toBe(`rgb(${surface.join(", ")})`);
		expect(host.rest.boxShadow).not.toBe("none");
		// The strip composites at opacity 0.92 over the page, so the painted
		// face is a shade lighter than the token; the tolerance here allows
		// that blend (at most 0.08 of the gap to white per channel) and the
		// ordering assertion after it does not depend on the number at all.
		expect(distance(host.restPainted, surface), `the host's surface did not paint: ${show(host.restPainted)}`).toBeLessThanOrEqual(
			2 * TOLERANCE
		);
		expect(distance(host.restPainted, surface), "the button's face is nearer the strip than the host's token").toBeLessThan(
			distance(host.restPainted, host.behindPainted)
		);
		expect(distance(host.restPainted, host.behindPainted), "with the host the button is indistinguishable from the strip").toBeGreaterThan(
			4 * TOLERANCE
		);

		// EVERY OTHER STATE IS THE PLUGIN'S, host or no host: the same
		// computed value on both pages, and none of them the host's surface.
		for (const state of ["active", "hover", "pressed"] as const) {
			expect(host[state].backgroundColor, `${state} differs with the host's rule in the cascade`).toBe(
				plain[state].backgroundColor
			);
			expect(host[state].backgroundColor, `${state} is the host's surface`).not.toBe(host.rest.backgroundColor);
			expect(plain[state].backgroundColor, `${state} painted nothing`).not.toBe(TRANSPARENT);
		}
	});

	it("leaves the settings preview's DIV tools alone: no host rule ever reached them", async () => {
		const plain = await fixedDivAt(false);
		const host = await fixedDivAt(true);
		expect(plain.tag).toBe("DIV");
		expect(host.tag).toBe("DIV");
		expect(plain.count).toBeGreaterThan(0);
		// The plugin's transparent declaration is what paints these, with
		// the host's button rule in the cascade or without it: `button:not()`
		// matches no DIV. Deleting that declaration as "dead" would leave
		// these on the user-agent default, which is also transparent today
		// and is nobody's decision.
		expect(plain.backgroundColor).toBe(TRANSPARENT);
		expect(host.backgroundColor).toBe(TRANSPARENT);
	});
});
