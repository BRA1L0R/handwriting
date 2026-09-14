/**
 * THE FINGER SCROLL CARRIES ITS OWN POSITION.
 *
 * THE SYMPTOM. At 10% a finger pan travels about three quarters of the
 * finger: thirty 1.3 px moves scroll the note 30 px of screen, not 39. At
 * 100% the plain scroller does the same at its own grain - a 1.3 px move
 * lands one layout px. The fling that follows a pan glides short the same
 * way.
 *
 * THE MECHANISM. The assist pan, the parole catch-up and the fling tick moved
 * the scroller with `scrollLeft -= d`, starting each move from the offset the
 * scroller reported. The engine keeps an offset on a grid - whole layout px on
 * a plain scroller, whole zoomed px under a zoom-shrunk host (ten layout px at
 * 10%) - so every move lost its remainder to the read-back and the next move
 * started from the rounded value. The fix (AssistScroll.ts) carries a float
 * target per gesture and writes it absolutely; the read-back only adopts a
 * scroll something else made.
 *
 * THE RIG. The real router on the shared element fake (test/routerHarness.ts)
 * with its two scroll offsets replaced by a model of the engine's grid: a
 * written offset is clamped to the range and kept as a whole number of grid
 * steps (floored, as the zoomed read-back was measured: +10 layout px for a
 * +13 write at 10%; a rounding variant shows the rule does not depend on the
 * engine's direction of rounding), and read back as that. Zoom path: one grid
 * step is one screen px, 1/k layout px. Plain path: one layout px. Travel is
 * reported in screen px, the unit the finger moves in. Every travel cell
 * compares with the requested distance, never with today's: at 100% the
 * plain path under-scrolled too, so "unchanged" would be the wrong claim.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { carryFrom, carryPinned, carryStep, scrollGrid } from "./AssistScroll";
import { InlinePenRouter } from "./InlinePenRouter";
import { fakeEl, installFakeWindow, rafCallbacks, recorder } from "../../test/routerHarness";

type Path = "zoom" | "plain";
type Rounding = "floor" | "round";

let clock = 1000;
let undoWindow: () => void;
const routers: InlinePenRouter[] = [];

beforeAll(() => {
	undoWindow = installFakeWindow();
});

afterAll(() => {
	undoWindow();
});

beforeEach(() => {
	clock = 1000;
	rafCallbacks.clear();
	vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
	for (const r of routers.splice(0)) r.dispose();
	vi.restoreAllMocks();
});

function ptr(type: string, pointerId: number, x: number, y: number, buttons: number, pointerType = "touch"): PointerEvent {
	return {
		type,
		pointerType,
		pointerId,
		isPrimary: true,
		clientX: x,
		clientY: y,
		pressure: buttons === 0 ? 0 : 0.5,
		buttons,
		button: 0,
		timeStamp: clock,
		tiltX: 0,
		tiltY: 0,
		width: 0,
		height: 0,
		preventDefault: () => {},
		stopPropagation: () => {},
	} as unknown as PointerEvent;
}

/** A router at note scale `k` over a scroller that keeps its offsets on the engine's grid for `path`. */
function rig(k: number, path: Path, rounding: Rounding = "floor", range = { x: 1_000_000, y: 1_000_000 }) {
	const el = fakeEl() as ReturnType<typeof fakeEl> & Record<string, unknown>;
	// Grid steps per layout px: one screen px under the zoomed host, one layout px on the plain scroller.
	const perLayout = path === "zoom" ? k : 1;
	const keep = (v: number, max: number) => {
		const steps = Math.min(Math.max(0, v), max) * perLayout;
		return (rounding === "round" ? Math.round(steps) : Math.floor(steps + 1e-7)) / perLayout;
	};
	let left = 0;
	let top = 0;
	Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => left, set: (v: number) => void (left = keep(v, range.x)) });
	Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => void (top = keep(v, range.y)) });
	Object.assign(el, { clientWidth: 900, clientHeight: 700, scrollWidth: 900 + range.x, scrollHeight: 700 + range.y });
	const router = new InlinePenRouter(el as unknown as HTMLElement, el as unknown as HTMLElement, recorder().cb, () => k);
	routers.push(router);
	const fire = (ev: PointerEvent) => {
		const handler = el.handlers.get(ev.type);
		if (!handler) throw new Error(`router registered no handler for ${ev.type}`);
		handler(ev);
	};
	return { el, router, fire, k, path, grid: path === "zoom" ? 1 / k : 1 };
}

type Rig = ReturnType<typeof rig>;

/**
 * A finger down, one 10 px move past the assist slop (the assist engages and
 * scrolls), then `moves` moves of `dx` screen px, `ms` apart. Returns the
 * offsets after the engaging move and after the last move, before any lift.
 */
function pan(r: Rig, moves: number, dx: number, ms = 16, startAt = 5000) {
	r.el.scrollLeft = startAt;
	let x = 600;
	r.fire(ptr("pointerdown", 5, x, 300, 1));
	x -= 10;
	clock += ms;
	r.fire(ptr("pointermove", 5, x, 300, 1));
	const start = r.el.scrollLeft as number;
	for (let i = 0; i < moves; i++) {
		x += dx;
		clock += ms;
		r.fire(ptr("pointermove", 5, x, 300, 1));
	}
	return { start, end: r.el.scrollLeft as number, x };
}

/** Screen px travelled between two offsets. */
const screenPx = (r: Rig, from: number, to: number) => (to - from) * r.k;

/** Lift the finger and run the fling's frames 16 ms apart until it stops itself. */
function liftAndGlide(r: Rig, x: number) {
	clock += 16;
	r.fire(ptr("pointerup", 5, x, 300, 0));
	const lifted = r.el.scrollLeft as number;
	let frames = 0;
	while (rafCallbacks.size > 0 && frames < 2000) {
		const [id, cb] = rafCallbacks.entries().next().value as [number, FrameRequestCallback];
		rafCallbacks.delete(id);
		clock += 16;
		cb(clock);
		frames++;
	}
	return { lifted, end: r.el.scrollLeft as number, frames, pending: rafCallbacks.size };
}

describe("the carry's arithmetic (AssistScroll.ts)", () => {
	it("keeps the float target through a read-back the grid rounded", () => {
		const first = carryStep(carryFrom(5000), { offset: 5000, range: 1e6 }, 13, 10);
		expect(first.carry.target).toBe(5013);
		// The engine kept 5010; the next move starts from 5013, not from 5010.
		const second = carryStep(first.carry, { offset: 5010, range: 1e6 }, 13, 10);
		expect(second.adopted, "a read-back within one grid step of the last write is the engine's rounding, not a scroll").toBe(false);
		expect(second.carry.target).toBe(5026);
	});

	it("adopts a read-back more than one grid step from the last write", () => {
		const step = carryStep({ target: 5013, written: 5013 }, { offset: 9000, range: 1e6 }, 13, 10);
		expect(step.adopted).toBe(true);
		expect(step.carry.target).toBe(9013);
	});

	it("clamps to the range, and below only when the range is not a number", () => {
		expect(carryStep(carryFrom(95), { offset: 95, range: 100 }, 13, 1).carry.target).toBe(100);
		expect(carryStep(carryFrom(5), { offset: 5, range: 100 }, -13, 1).carry.target).toBe(0);
		expect(carryStep(carryFrom(5), { offset: 5, range: Number.NaN }, 1e9, 1).carry.target).toBe(1e9 + 5);
	});

	it("reads the grid as one screen px in layout px, never finer than one layout px", () => {
		expect(scrollGrid(10)).toBe(10);
		expect(scrollGrid(1)).toBe(1);
		expect(scrollGrid(0.5)).toBe(1);
		expect(scrollGrid(Number.POSITIVE_INFINITY)).toBe(1);
	});

	it("calls a clamped target pinned only when the scroller sits within one grid step of it", () => {
		const pinnedStep = carryStep({ target: 100, written: 100 }, { offset: 100, range: 100 }, 13, 10);
		expect(pinnedStep.moved).toBe(false);
		expect(carryPinned(pinnedStep, 95, 10)).toBe(true);
		const moving = carryStep({ target: 50, written: 50 }, { offset: 50, range: 100 }, 13, 10);
		expect(carryPinned(moving, 50, 10)).toBe(false);
	});
});

describe("a finger pan travels the finger's distance, within one grid step, on both paths", () => {
	const cells: { k: number; path: Path; rounding?: Rounding; dx: number; note: string }[] = [
		{ k: 0.1, path: "zoom", dx: -1.3, note: "10% under the zoom host: the move is 13 layout px on a 10 px grid" },
		{ k: 0.15, path: "zoom", dx: -1.3, note: "15% under the zoom host" },
		{ k: 0.5, path: "zoom", dx: -1.3, note: "50% under the zoom host" },
		{ k: 0.1, path: "zoom", rounding: "round", dx: -1.3, note: "10% under the zoom host, an engine that rounds to nearest" },
		{ k: 1, path: "plain", dx: -1.3, note: "100% on the plain scroller: the move is 1.3 layout px on a 1 px grid" },
		{ k: 0.1, path: "plain", dx: -1.25, note: "10% on the plain scroller with 12.5 layout px moves: the finer grid loses half a px a move" },
		{ k: 0.1, path: "plain", dx: -1.3, note: "10% on the plain scroller with 1.3 px moves: 13 whole layout px, nothing to lose either way" },
	];
	for (const c of cells) {
		it(`${c.note}: 30 moves travel ${Math.abs(30 * c.dx)} px of screen`, () => {
			const r = rig(c.k, c.path, c.rounding);
			const { start, end } = pan(r, 30, c.dx);
			const want = Math.abs(30 * c.dx);
			const gridScreen = r.grid * c.k;
			const got = screenPx(r, start, end);
			expect(
				Math.abs(got - want),
				`travelled ${got.toFixed(3)} px of screen for ${want} px of finger (grid ${gridScreen} screen px): the pan started each move from the grid-rounded read-back`
			).toBeLessThanOrEqual(gridScreen + 1e-9);
		});
	}
});

describe("the read-back still adopts a scroll something else made", () => {
	it("a wheel scroll in the middle of a pan becomes the pan's new start, within one grid step", () => {
		const r = rig(0.1, "zoom");
		const first = pan(r, 10, -1.3);
		r.el.scrollLeft = (r.el.scrollLeft as number) + 4000;
		const external = r.el.scrollLeft as number;
		let x = first.x;
		for (let i = 0; i < 10; i++) {
			x -= 1.3;
			clock += 16;
			r.fire(ptr("pointermove", 5, x, 300, 1));
		}
		const got = screenPx(r, external, r.el.scrollLeft as number);
		expect(Math.abs(got - 13), `after the wheel the pan travelled ${got} px of screen from the wheel's offset for 13 px of finger: the pan wrote over the wheel or started from its own older target`).toBeLessThanOrEqual(1);
	});
});

describe("the fling after a pan glides the same distance and stops on the same frame on both grids", () => {
	it("at 10% under the zoom host the glide matches an ungridded scroller within one screen px", () => {
		const glide = (path: Path) => {
			const r = rig(0.1, path);
			const p = pan(r, 10, -8);
			return { r, ...liftAndGlide(r, p.x) };
		};
		const gridded = glide("zoom");
		// The same pan and fling at the same k on the plain scroller, whose grid (1 layout px) is a tenth of the zoom
		// grid: the reference glide.
		const fine = glide("plain");
		expect(gridded.pending, "the zoom glide never stopped").toBe(0);
		expect(fine.pending, "the plain glide never stopped").toBe(0);
		const a = screenPx(gridded.r, gridded.lifted, gridded.end);
		const b = screenPx(fine.r, fine.lifted, fine.end);
		expect(Math.abs(a - b), `zoom glide ${a.toFixed(2)} px vs plain ${b.toFixed(2)} px of screen`).toBeLessThanOrEqual(1);
		expect(gridded.frames, "the glide stopped on a different frame").toBe(fine.frames);
		expect(a, "precondition: the fling actually glided").toBeGreaterThan(50);
	});

	it("against an edge the glide stops at the range within one grid step, and does not keep asking for frames", () => {
		const r = rig(0.1, "zoom", "floor", { x: 6205, y: 1_000_000 });
		const p = pan(r, 10, -8);
		expect(p.end, "precondition: the pan stopped short of the edge").toBeLessThan(6100);
		const g = liftAndGlide(r, p.x);
		expect(g.pending).toBe(0);
		expect(Math.abs((r.el.scrollLeft as number) - 6205), "stopped away from the edge").toBeLessThanOrEqual(10);
		expect(g.frames, "the glide ran its full physics instead of stopping at the edge").toBeLessThan(40);
	});
});

describe("a palm-gated finger that earns parole scrolls from the catch-up's carried target", () => {
	it("at 10% under the zoom host the catch-up and the move after it land within one grid step of the finger", () => {
		const r = rig(0.1, "zoom");
		r.el.scrollLeft = 5000;
		// A pen hovering beside the page: the next touch is swallowed as a palm and watched for parole.
		r.fire(ptr("pointermove", 9, 800, 300, 0, "pen"));
		clock += 10;
		r.fire(ptr("pointerdown", 5, 600, 300, 1));
		clock += 16;
		r.fire(ptr("pointermove", 5, 596, 300, 1));
		expect(r.el.scrollLeft, "precondition: the touch was swallowed as a palm (it scrolled before earning parole)").toBe(5000);
		// 23.99 px from the down point: past the parole distance, so the finger converts to the assist pan and the whole
		// run-up is applied at once - 239.9 layout px, which the 10 px grid keeps as 230.
		clock += 16;
		r.fire(ptr("pointermove", 5, 600 - 23.99, 300, 1));
		expect(r.el.scrollLeft, "precondition: parole was earned and the catch-up scrolled").toBeGreaterThan(5000);
		expect(Math.abs(screenPx(r, 5000, r.el.scrollLeft as number) - 23.99), "the catch-up landed more than one grid step from the finger").toBeLessThanOrEqual(1);
		// The next move is half a px. From the carried 5239.9 it reaches 5244.9, kept as 5240; from the rounded read-back it
		// would reach 5235, kept as 5230, 1.49 px of screen short of the finger.
		clock += 16;
		r.fire(ptr("pointermove", 5, 600 - 24.49, 300, 1));
		const got = screenPx(r, 5000, r.el.scrollLeft as number);
		expect(Math.abs(got - 24.49), `after parole and one more move the finger travelled 24.49 px and the note ${got.toFixed(2)}: the move started from the catch-up's grid-rounded read-back`).toBeLessThanOrEqual(1);
	});
});
