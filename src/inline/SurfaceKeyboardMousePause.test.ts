import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	fakeEl,
	installFakeWindow,
	penEvent,
	recorder,
} from "../../test/routerHarness";
import { InlinePenRouter, mouseMayStartOrHover, ownedMouseStroke } from "./InlinePenRouter";
import { clearToolPicked, markToolPicked, setMouseInk } from "./MouseInk";
import { penInkEnabled, resetPenInkForTest, setPenInk } from "./PenInk";
import { resetPenToolsForTest } from "./PenToolsMode";

let uninstallWindow: () => void = () => {};
const routers: InlinePenRouter[] = [];
beforeAll(() => {
	uninstallWindow = installFakeWindow();
});
afterAll(() => uninstallWindow());
beforeEach(() => {
	setMouseInk(true);
	resetPenInkForTest();
	resetPenToolsForTest();
});
afterEach(() => {
	for (const router of routers.splice(0)) router.dispose();
	setMouseInk(false);
	resetPenInkForTest();
	clearToolPicked();
});

function recordedMouseEvent(type: string, timestamp: number, pointerId: number, buttons: number) {
	let prevented = false;
	const event = penEvent(type, timestamp, {
		pointerType: "mouse",
		pointerId,
		buttons,
	});
	(event as unknown as { preventDefault(): void }).preventDefault = () => {
		prevented = true;
	};
	Object.defineProperty(event, "defaultPrevented", { get: () => prevented });
	return event;
}

describe("Surface Keyboard mouse pause ownership", () => {
	it("blocks fresh mouse start/hover while preserving the explicit grant", () => {
		expect(mouseMayStartOrHover(true, false)).toBe(true);
		expect(mouseMayStartOrHover(true, true)).toBe(false);
		expect(mouseMayStartOrHover(false, true)).toBe(false);
	});

	it("continues only the exact already-claimed mouse pointer through pause", () => {
		expect(ownedMouseStroke("mouse", 42, 42, true)).toBe(true);
		expect(ownedMouseStroke("mouse", 41, 42, true)).toBe(false);
		expect(ownedMouseStroke("pen", 42, 42, true)).toBe(false);
		expect(ownedMouseStroke("mouse", 42, null, true)).toBe(false);
	});

	it("keeps a claimed mouse live through Keyboard, while a second mouse stays native", () => {
		const el = fakeEl();
		const rec = recorder();
		const router = new InlinePenRouter(el as unknown as HTMLElement, el as unknown as HTMLElement, {
			...rec.cb,
			penOff: () => !penInkEnabled(),
		});
		routers.push(router);
		const fire = (event: PointerEvent) => el.handlers.get(event.type)!(event);

		const down = recordedMouseEvent("pointerdown", 100, 42, 1);
		fire(down);
		expect(rec.downs).toBe(1);
		expect(down.defaultPrevented).toBe(true);
		setPenInk(false);
		expect(router.finishActiveStroke({ preserveMouse: true })).toBe(false);
		fire(recordedMouseEvent("pointermove", 108, 42, 1));
		const up = recordedMouseEvent("pointerup", 116, 42, 0);
		fire(up);
		const fresh = recordedMouseEvent("pointerdown", 124, 43, 1);
		fire(fresh);
		expect(rec.ups).toBe(1);
		expect(rec.rawCalls.length).toBeGreaterThan(0);
		expect(up.defaultPrevented).toBe(true);
		expect(fresh.defaultPrevented).toBe(false);
		expect(rec.downs).toBe(1);
		expect(router.isStroking).toBe(false);
	});

	it("finishes the exact claimed mouse once on lost capture after Keyboard", () => {
		const el = fakeEl();
		const rec = recorder();
		const router = new InlinePenRouter(el as unknown as HTMLElement, el as unknown as HTMLElement, {
			...rec.cb,
			penOff: () => !penInkEnabled(),
		});
		routers.push(router);
		const fire = (event: PointerEvent) => el.handlers.get(event.type)!(event);

		fire(recordedMouseEvent("pointerdown", 200, 52, 1));
		setPenInk(false);
		fire(recordedMouseEvent("lostpointercapture", 208, 53, 0));
		expect(rec.ups).toBe(0);
		const lost = recordedMouseEvent("lostpointercapture", 216, 52, 0);
		fire(lost);
		expect(rec.ups).toBe(1);
		expect(lost.defaultPrevented).toBe(false);
		expect(router.isStroking).toBe(false);
	});

	it("pauses and resumes the derived pen-less mouse grant without changing the explicit switch", () => {
		setMouseInk(false);
		markToolPicked();
		const el = fakeEl();
		const rec = recorder();
		const router = new InlinePenRouter(el as unknown as HTMLElement, el as unknown as HTMLElement, {
			...rec.cb,
			penOff: () => !penInkEnabled(),
		});
		routers.push(router);
		const fire = (event: PointerEvent) => el.handlers.get(event.type)!(event);
		fire(recordedMouseEvent("pointerdown", 300, 61, 1));
		fire(recordedMouseEvent("pointerup", 308, 61, 0));
		expect(rec.ups).toBe(1);
		setPenInk(false);
		const paused = recordedMouseEvent("pointerdown", 316, 62, 1);
		fire(paused);
		expect(paused.defaultPrevented).toBe(false);
		expect(rec.downs).toBe(1);
		setPenInk(true);
		markToolPicked();
		fire(recordedMouseEvent("pointerdown", 324, 63, 1));
		fire(recordedMouseEvent("pointerup", 332, 63, 0));
		expect(rec.ups).toBe(2);
		expect(penInkEnabled()).toBe(true);
	});
});
