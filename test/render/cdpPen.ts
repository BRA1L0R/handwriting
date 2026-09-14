/**
 * REAL PEN INPUT through the browser, not a script-made PointerEvent.
 *
 * `Input.dispatchMouseEvent` with `pointerType: "pen"` enters Chromium's input
 * pipeline where a tablet's events do: the browser hit-tests the point, picks
 * the target, sets pointer capture, and delivers a trusted PointerEvent whose
 * `pointerType` is "pen". A `dispatchEvent` from page script does none of
 * that: it delivers to whatever element the script chose, untrusted, with no
 * capture. The fixture that this serves records, on the page, `isTrusted` and
 * `pointerType` of what arrived, so a driver that quietly degraded to a mouse
 * would be caught by the run and not by a type check.
 *
 * Coordinates are CSS px in the page's main-frame viewport, the frame
 * `page.screenshot({ clip })` uses. Pressure travels in the protocol field
 * named `force` (protocol.d.ts, dispatchMouseEventParameters), not `pressure`.
 * The protocol assigns the pointer id; nothing here claims one.
 */
import type { CDPSession } from "playwright";

export interface PenOptions { pressure?: number; tiltX?: number; tiltY?: number }

const base = (o?: PenOptions) => ({ pointerType: "pen" as const, tiltX: o?.tiltX ?? 0, tiltY: o?.tiltY ?? 0 });

/** Pen touches down at (x, y): left button, one click, the given pressure. */
export async function penPress(cdp: CDPSession, x: number, y: number, o?: PenOptions): Promise<void> {
	await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, force: o?.pressure ?? 0.5, ...base(o) });
}

/** Pen moves to (x, y) with the left button still down. */
export async function penMove(cdp: CDPSession, x: number, y: number, o?: PenOptions): Promise<void> {
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, force: o?.pressure ?? 0.5, ...base(o) });
}

/** Pen lifts at (x, y). */
export async function penRelease(cdp: CDPSession, x: number, y: number): Promise<void> {
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, force: 0, ...base() });
}

/** `n + 1` points from `a` to `b` inclusive, straight line. */
export function linePoints(a: { x: number; y: number }, b: { x: number; y: number }, n: number): { x: number; y: number }[] {
	return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));
}

/**
 * A whole stroke: press at the first point, move through every following
 * point, release at the last. `between(i)` runs after the move to point `i`,
 * with the pen still down; the caller's mid-contact captures live there. The
 * release always happens, even if `between` throws, so a failed capture cannot
 * leave the browser holding a pen down for the next case.
 */
export async function penStroke(cdp: CDPSession, points: { x: number; y: number }[], o?: PenOptions & { between?: (i: number) => Promise<void> }): Promise<void> {
	if (points.length < 2) throw new Error("penStroke needs at least two points");
	const first = points[0]!, last = points[points.length - 1]!;
	await penPress(cdp, first.x, first.y, o);
	try {
		for (let i = 1; i < points.length; i++) {
			const p = points[i]!;
			await penMove(cdp, p.x, p.y, o);
			if (o?.between) await o.between(i);
		}
	} finally {
		await penRelease(cdp, last.x, last.y);
	}
}
