/**
 * Z10 RECORDER: every camera sync's ladder terms, as exact doubles, for the
 * offline reconstruction to be checked against live rows rather than against
 * two change records.
 *
 * Test-only and opt-in (`lagOptions.z10`). It wraps four overlay prototype
 * methods and reads, after each real call, the rects that call has just read.
 * No layout write happens between the product's read and the recorder's, so
 * the recorder's read returns the same double the product used. It adds rect
 * reads and so it is a CORRECTNESS instrument, never a timing one.
 *
 * The chain it records: `anchorCameraY` picks rung n and reads its rect,
 * `canonicalCameraY` adopts or holds the raw origin, `gateAnchorParity`
 * compares the ladder's implied top with `anchorTop` and may call
 * `refuseDocumentAnchor`, after which the next sync has no ladder.
 */

import { anchorParityBar, anchorRefusals, documentAnchorLadder, documentAnchorRefused } from "../../src/inline/DocumentAnchor";
import { anchorPaddingTop } from "../../src/inline/DocumentTop";

export interface Z10Row {
	/** Sync index since install, and which method opened the row. */
	i: number;
	t: number;
	scrollTop: number;
	scrollLeft: number;
	/** The host's inline zoom and transform as written, and the computed zoom. */
	hostZoomStyle: string;
	hostTransform: string;
	hostZoomComputed: string;
	hostZoomSupport: boolean | null;
	cssScaleBefore: number;
	cssScaleAfter: number;
	containerOffsetWidth: number | null;
	containerRectWidth: number | null;
	containerRectTop: number | null;
	refusedBefore: boolean;
	refusedAfter: boolean;
	camYBefore: number;
	camYAfter: number;
	/** `anchorCameraY` calls inside this sync (the read-only twin is recorded apart). */
	anchor: Array<{
		overlayTop: number; bypass: boolean | null; dpr: number; result: { layout: number; rung: number; impliedTop: number } | null;
		spacing: number | null; rungs: number | null; rungRectTop: number | null;
		padding: number | null; cssScale: number; panY: number; from: number;
		contentRectTop: number; shipped: number | null; bar: number | null;
	}>;
	canonical: Array<{ raw: number; adopt: boolean; prior: number | null; returned: number }>;
	gate: Array<{ reason: string; implied: number; rungTopLayout: number; shipped: number | null; contentTop: number; bar: number;
		refusalsBefore: number; refusalsAfter: number; last: unknown }>;
	/** Syncs that returned before the camera (deferred pinch, locked frame, invalid geometry). */
	early: boolean;
	/** `window.devicePixelRatio` at the sync: the layout zoom factor's public face. */
	dpr: number;
}

export interface Z10Recording {
	installedAt: { refused: boolean; refusals: number; last: unknown; ladderLive: boolean; rungs: number | null; scrollTop: number; cssScale: number };
	rows: Z10Row[];
	twin: Z10Row["anchor"];
	refusalLog: Array<{ atSync: number; value: unknown; scrollTop: number }>;
	/** C1's natural-column measurement (resize, theme refresh, takeover), per call, with the sync it landed in. */
	measureCalls: Array<{ atSync: number; box: boolean; hostZoomBefore: string; hostZoomAfter: string }>;
	stop: () => void;
}

export function installZ10Recorder(proto: Record<string, any>, view: any, overlay: any, options?: { transformHost?: boolean; plantLimit?: number }): Z10Recording {
	// THE BASE CONTROL: the transform host on the same commit, chosen before any
	// pinch writes a host form. `hostZoomSupport` is the per-overlay cache
	// `hostZoomSupported()` fills once; setting it here is what that method
	// would have answered on an engine without css zoom.
	if (options?.transformHost) overlay.hostZoomSupport = false;
	const realSync = proto.syncCamera, realAnchor = proto.anchorCameraY, realGate = proto.gateAnchorParity, realCanon = proto.canonicalCameraY;
	// THE GUARD PLANT: a lower exact-range limit on the prototype, so the ladder path can be read taking over above it.
	const realLimit = proto.zoomRectExactLimit;
	if (options?.plantLimit !== undefined && realLimit) proto.zoomRectExactLimit = () => options.plantLimit;
	// C1's measurement takes the plugin's zoom off the host and measures; the caller writes it back. Recorded so a
	// resize cell shows the path ran, and whether a sync landed between the measure and the write-back.
	const realMeasure = proto.measureNaturalColumn;
	const measureCalls: Z10Recording["measureCalls"] = [];
	if (realMeasure) proto.measureNaturalColumn = function z10Measure(this: any, box: unknown) {
		const before = this.view.dom.style.zoom;
		const out = realMeasure.call(this, box);
		measureCalls.push({ atSync: syncs, box: box !== null && box !== undefined, hostZoomBefore: before, hostZoomAfter: this.view.dom.style.zoom });
		return out;
	};
	const rows: Z10Row[] = [];
	const twin: Z10Row["anchor"] = [];
	const refusalLog: Z10Recording["refusalLog"] = [];
	let current: Z10Row | null = null, syncs = 0;
	const host = () => view.dom as HTMLElement;
	const rectTop = (el: Element | null | undefined) => el ? el.getBoundingClientRect().top : null;

	// Every refusal from here on, whoever calls it, with the sync it landed in.
	let lastValue: unknown = anchorRefusals.last;
	Object.defineProperty(anchorRefusals, "last", {
		configurable: true, enumerable: true,
		get: () => lastValue,
		set: (v: unknown) => { lastValue = v; refusalLog.push({ atSync: current ? current.i : -1, value: v, scrollTop: view.scrollDOM.scrollTop }); },
	});
	const installedHeld = documentAnchorLadder(view);
	const installedAt = { refused: documentAnchorRefused(view), refusals: anchorRefusals.count, last: lastValue,
		ladderLive: !!installedHeld, rungs: installedHeld ? installedHeld.rungs.length : null, scrollTop: view.scrollDOM.scrollTop, cssScale: overlay.cssScale };

	proto.anchorCameraY = function z10Anchor(this: any, overlayTop: number) {
		const from = Number.isFinite(this.anchorCameraYLayout) ? this.anchorCameraYLayout : this.view.scrollDOM.scrollTop;
		// The Z10 bypass decision, where the source has one (null before the fix).
		const bypass = typeof this.anchorTopExactOnZoomHost === "function" ? this.anchorTopExactOnZoomHost(overlayTop) as boolean : null;
		const result = realAnchor.call(this, overlayTop);
		const held = documentAnchorLadder(this.view);
		const padding = anchorPaddingTop(this.view, this.contentStyle?.paddingTop, this.cssScale);
		const contentRectTop = this.view.contentDOM.getBoundingClientRect().top;
		const shipped = padding === null ? null : contentRectTop + padding;
		const entry = {
			overlayTop, bypass, dpr: this.dpr as number, result: result ? { layout: result.layout, rung: result.rung, impliedTop: result.impliedTop } : null,
			spacing: held ? held.spacing : null, rungs: held ? held.rungs.length : null,
			rungRectTop: held && result ? rectTop(held.rungs[result.rung]) : null,
			padding, cssScale: this.cssScale, panY: this.panY(), from, contentRectTop, shipped,
			bar: result && held ? anchorParityBar(contentRectTop, result.rung * held.spacing, this.cssScale) : null,
		};
		(current ? current.anchor : twin).push(entry);
		return result;
	};
	proto.canonicalCameraY = function z10Canon(this: any, raw: number, adopt: boolean) {
		const prior = this.cameraOriginY ? this.cameraOriginY.y as number : null;
		const returned = realCanon.call(this, raw, adopt);
		if (current && adopt) current.canonical.push({ raw, adopt, prior, returned });
		return returned;
	};
	proto.gateAnchorParity = function z10Gate(this: any, reason: string, implied: number, rungTopLayout: number) {
		const padding = anchorPaddingTop(this.view, this.contentStyle?.paddingTop, this.cssScale);
		const contentTop = this.view.contentDOM.getBoundingClientRect().top;
		const before = anchorRefusals.count;
		const out = realGate.call(this, reason, implied, rungTopLayout);
		current?.gate.push({ reason, implied, rungTopLayout, shipped: padding === null ? null : contentTop + padding, contentTop,
			bar: anchorParityBar(contentTop, rungTopLayout, this.cssScale), refusalsBefore: before, refusalsAfter: anchorRefusals.count, last: lastValue });
		return out;
	};
	proto.syncCamera = function z10Sync(this: any, ...a: unknown[]) {
		if (this !== overlay) return realSync.apply(this, a);
		const c = this.container as HTMLElement | null;
		const row: Z10Row = {
			i: syncs++, t: performance.now(), scrollTop: this.view.scrollDOM.scrollTop, scrollLeft: this.view.scrollDOM.scrollLeft,
			hostZoomStyle: host().style.zoom, hostTransform: host().style.transform, hostZoomComputed: getComputedStyle(host()).zoom,
			hostZoomSupport: typeof this.hostZoomSupport === "boolean" ? this.hostZoomSupport : null,
			cssScaleBefore: this.cssScale, cssScaleAfter: NaN,
			containerOffsetWidth: c ? c.offsetWidth : null, containerRectWidth: c ? c.getBoundingClientRect().width : null, containerRectTop: c ? c.getBoundingClientRect().top : null,
			refusedBefore: documentAnchorRefused(this.view), refusedAfter: false,
			camYBefore: this.camera?.y ?? NaN, camYAfter: NaN, anchor: [], canonical: [], gate: [], early: false, dpr: window.devicePixelRatio,
		};
		const outer = current;
		current = row;
		try { return realSync.apply(this, a); } finally {
			row.cssScaleAfter = this.cssScale;
			row.camYAfter = this.camera?.y ?? NaN;
			row.refusedAfter = documentAnchorRefused(this.view);
			row.early = row.anchor.length === 0;
			rows.push(row);
			current = outer;
		}
	};
	return {
		installedAt, rows, twin, refusalLog, measureCalls,
		stop: () => {
			proto.syncCamera = realSync; proto.anchorCameraY = realAnchor; proto.gateAnchorParity = realGate; proto.canonicalCameraY = realCanon;
			if (realLimit) proto.zoomRectExactLimit = realLimit;
			if (realMeasure) proto.measureNaturalColumn = realMeasure;
			Object.defineProperty(anchorRefusals, "last", { configurable: true, enumerable: true, writable: true, value: lastValue });
		},
	};
}
