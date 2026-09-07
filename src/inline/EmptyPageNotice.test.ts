/**
 * The empty-page refusal's two pure rules, tested without a pen, a canvas or
 * an obsidian stub in sight.
 *
 * Alan, hardware, 1.4.12: "holding ctrl and touching eraser end to screen
 * spams toast notification - there is no ink on the note to erase, even
 * though there is". Two defects in one sentence, and they are separable:
 *
 *   - "spams"           one Notice per pen contact, and an eraser scrub is
 *                       many contacts. Fixed by `EmptyPageNoticeGate`.
 *   - "even though      the store's stroke list is a CACHE, and a note whose
 *      there is"        sidecar has not been read yet holds nothing in it.
 *                       Fixed by refusing to speak on "unknown".
 *
 * Both live here so neither needs a rig to pin. The wiring that connects them
 * to the eraser and the lasso is covered by `EmptyPageNotices.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
	EmptyPageNoticeGate,
	emptyPageNoticeText,
	inkChangeRearmsNotice,
} from "./EmptyPageNotice";
import overlaySrc from "./InkOverlay.ts?raw";
import { codeOnly } from "../CodeOnly";

describe("emptyPageNoticeText", () => {
	it("names the tool that refused", () => {
		expect(emptyPageNoticeText("none", "erase")).toBe(
			"Handwriting: no ink on the page to erase"
		);
		expect(emptyPageNoticeText("none", "select")).toBe(
			"Handwriting: no ink on the page to select"
		);
	});

	it("says nothing about a page that has ink", () => {
		expect(emptyPageNoticeText("ink", "erase")).toBeNull();
		expect(emptyPageNoticeText("ink", "select")).toBeNull();
	});

	it("says nothing about a page the store has not read yet", () => {
		// The "even though there is" half. Silence is the only honest answer
		// while the sidecar is unread: the page may be covered in ink.
		expect(emptyPageNoticeText("unknown", "erase")).toBeNull();
		expect(emptyPageNoticeText("unknown", "select")).toBeNull();
	});
});

describe("EmptyPageNoticeGate", () => {
	it("speaks once, then stays quiet however long the scrub lasts", () => {
		const gate = new EmptyPageNoticeGate();
		expect(gate.claim("note.md", "erase")).toBe(true);
		// Twenty re-lands of the nib, which is what "spams" was.
		for (let i = 0; i < 20; i++) expect(gate.claim("note.md", "erase")).toBe(false);
	});

	it("the eraser's refusal and the lasso's are two pieces of news", () => {
		const gate = new EmptyPageNoticeGate();
		expect(gate.claim("note.md", "erase")).toBe(true);
		expect(gate.claim("note.md", "select")).toBe(true);
		expect(gate.claim("note.md", "erase")).toBe(false);
		expect(gate.claim("note.md", "select")).toBe(false);
	});

	it("a different note has heard nothing", () => {
		const gate = new EmptyPageNoticeGate();
		expect(gate.claim("a.md", "erase")).toBe(true);
		expect(gate.claim("b.md", "erase")).toBe(true);
		expect(gate.claim("a.md", "erase")).toBe(false);
	});

	it("ink changing on a note makes both its refusals news again", () => {
		const gate = new EmptyPageNoticeGate();
		gate.claim("a.md", "erase");
		gate.claim("a.md", "select");
		gate.claim("b.md", "erase");

		gate.forget("a.md");

		expect(gate.claim("a.md", "erase")).toBe(true);
		expect(gate.claim("a.md", "select")).toBe(true);
		// ...and only that note's. `forget` is wired to onInkChanged, which
		// names one path.
		expect(gate.claim("b.md", "erase")).toBe(false);
	});

	// WHICH ink changes re-arm it. The gate is wired to the store's
	// change notification, and that notification fires for ink arriving AND
	// for the last of it leaving. Re-arming on the second one is what put
	// "no ink on the page to erase" in front of the person who had just
	// erased it: an eraser scrub re-lands the nib every few hundred ms, so
	// the landing after the one that emptied the page found a re-armed gate
	// and spoke.
	it("ink arriving re-arms the refusal; the page being emptied does not", () => {
		expect(inkChangeRearmsNotice("ink"), "ink arrived and the gate stayed shut").toBe(true);
		expect(
			inkChangeRearmsNotice("none"),
			"the page was emptied and the gate re-armed, so the next landing speaks"
		).toBe(false);
		expect(
			inkChangeRearmsNotice("unknown"),
			"an unread sidecar re-armed the gate; nothing is known about that note yet"
		).toBe(false);
	});

	// AND THE OVERLAY ACTUALLY ASKS. The rule above is worth nothing if the
	// subscription that re-arms the gate does not consult it; the rig that
	// drives the erase branch never runs `mount`, so nothing else on this
	// line can see that wiring. Read as CODE, so the comment beside it
	// cannot satisfy the assertion.
	it("the overlay re-arms through this rule, not on any ink change", () => {
		const src = codeOnly(overlaySrc).split("\r\n").join("\n");
		const at = src.indexOf("this.offInkChanged = onInkChanged(");
		expect(at, "the overlay no longer subscribes to ink changes").toBeGreaterThan(-1);
		const end = src.indexOf("});", at);
		expect(end, "the subscription has no end in InkOverlay.ts any more").toBeGreaterThan(at);
		const body = src.slice(at, end);
		expect(
			body,
			"the ink-change subscription forgets the notice without asking whether ink arrived"
		).toContain("inkChangeRearmsNotice(");
	});

	it("forgetAll clears every note, for a switch or a teardown", () => {
		const gate = new EmptyPageNoticeGate();
		gate.claim("a.md", "erase");
		gate.claim("b.md", "select");

		gate.forgetAll();

		expect(gate.claim("a.md", "erase")).toBe(true);
		expect(gate.claim("b.md", "select")).toBe(true);
	});

	it("a surface with no file behind it never speaks and never remembers", () => {
		const gate = new EmptyPageNoticeGate();
		expect(gate.claim(null, "erase")).toBe(false);
		expect(gate.claim(null, "erase")).toBe(false);
		// A null path recorded nothing, so the real note is still unheard.
		expect(gate.claim("note.md", "erase")).toBe(true);
	});
});
