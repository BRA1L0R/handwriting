import { describe, expect, it } from "vitest";
import { ScrollExpansionDemand, SurfaceExtents, ZERO_EXTENT } from "./SurfaceExtent";

const room = { left: 0, top: 0, width: 400, height: 600, edgeX: 400, edgeY: 600, origin: { left: 0, top: 0 }, fontZoom: 1, pinchScale: 1 };
describe("scroll expansion demand", () => {
	it("defaults off and seeds once on enabling, with no stationary ratchet", () => {
		const demand = new ScrollExpansionDemand();
		demand.sample("a", false, 0, 0);
		expect(demand.reserve(room)).toBe(ZERO_EXTENT);
		demand.sample("a", true, 0, 0);
		expect(demand.reserve({ ...room })).toEqual({ x: 800, y: 1200 });
		demand.applied(1024, 1536);
		const revision = demand.revision;
		for (let i = 0; i < 20; i++) expect(demand.sample("a", true, 0, 0)).toBe(revision);
		expect(demand.reserve({ ...room, edgeX: 1024, edgeY: 1536 })).toEqual(ZERO_EXTENT);
	});
	it("only requests an axis moving forward near its edge; camera is irrelevant", () => {
		const demand = new ScrollExpansionDemand();
		demand.sample("a", true, 0, 0); demand.reserve({ ...room }); demand.applied(1024, 1536);
		const revision = demand.revision;
		expect(demand.sample("a", true, 0, 100)).toBe(revision);
		expect(demand.sample("a", true, 0, 900)).toBeGreaterThan(revision);
		expect(demand.reserve({ ...room, top: 900, edgeX: 1024, edgeY: 1536 })).toEqual({ x: 0, y: 2100 });
		demand.applied(1024, 2560);
		const next = demand.revision;
		expect(demand.sample("a", true, 0, 800)).toBe(next);
		expect(demand.sample("a", true, 0, 800)).toBe(next);
	});
	it("uses note origin and font zoom, respects existing room and reseeds another note", () => {
		const demand = new ScrollExpansionDemand();
		demand.sample("a", true, 0, 0);
		expect(demand.reserve({ ...room, edgeX: 4000, edgeY: 4000 })).toEqual(ZERO_EXTENT);
		demand.sample("b", true, 0, 0);
		expect(demand.reserve({ ...room, origin: { left: 40, top: 20 }, fontZoom: 2 })).toEqual({ x: 380, y: 590 });
	});
	it("disable stops demand without clearing per-note session grants", () => {
		const extents = new SurfaceExtents();
		const demand = new ScrollExpansionDemand();
		demand.sample("a", true, 0, 0);
		const grant = extents.grow("a", demand.reserve({ ...room }));
		demand.sample("a", false, 200, 500);
		expect(demand.reserve({ ...room })).toBe(ZERO_EXTENT);
		expect(extents.get("a")).toBe(grant);
		extents.handleRename("a", "b"); expect(extents.get("b")).toBe(grant);
		extents.handleDelete("b"); expect(extents.get("b")).toBe(ZERO_EXTENT);
	});
});
