export type PointerTraceRole = "sample" | "lifecycle" | "annotation";

export interface PointerTraceSample {
	t: number;
	x: number;
	y: number;
	p: number;
}

export interface PointerTraceEntry {
	t: number;
	type: string;
	id: number;
	ptr: string;
	buttons: number;
	button: number;
	pressure: number;
	x: number;
	y: number;
	tx: number;
	ty: number;
	note: string;
	cs?: PointerTraceSample[];
	eventId?: string;
	epoch?: number;
	role?: PointerTraceRole;
	sourceT?: number;
	observationT?: number;
	partial?: boolean;
	termination?: "silent-lift";
}

export interface PointerTraceMeta {
	evictedRows: number;
	evictedSamples: number;
	retainedRows: number;
	retainedSamples: number;
	truncated: boolean;
	partialBatch: boolean;
}

export interface PointerDeliveryAnalysis {
	available: boolean;
	reason?: string;
	incomplete: boolean;
	truncated: boolean;
	partialBatch: boolean;
	evictedRows: number;
	evictedSamples: number;
	streams: Record<string, {
		parentCount: number;
		sampleCount: number;
		coalescedParentCount: number;
		sourceSpacing: Spacing;
		observationSpacing: Spacing;
	}>;
	contacts: Record<string, {
		epoch: number;
		pointerId: number;
		incomplete: boolean;
		streams: Record<string, { parentCount: number; sampleCount: number }>;
		lifecycle: Array<{ type: string; sourceT: number; observationT: number; x: number; y: number; pressure: number }>;
	}>;
	epochs: number[];
}

export interface Spacing {
	count: number;
	min: number | null;
	max: number | null;
	mean: number | null;
}

const EMPTY_SPACING: Spacing = { count: 0, min: null, max: null, mean: null };

function spacing(values: number[]): Spacing {
	if (values.length === 0) return { ...EMPTY_SPACING };
	return {
		count: values.length,
		min: Math.min(...values),
		max: Math.max(...values),
		mean: values.reduce((sum, value) => sum + value, 0) / values.length,
	};
}

function hasAnalysisFields(event: PointerTraceEntry): boolean {
	return (
		typeof event.eventId === "string" &&
		typeof event.epoch === "number" &&
		typeof event.role === "string" &&
		typeof event.sourceT === "number" &&
		typeof event.observationT === "number"
	);
}

function eventKey(event: PointerTraceEntry): string {
	return `${event.epoch}:${event.eventId}`;
}

function streamState() {
	return { parentCount: 0, sampleCount: 0, coalescedParentCount: 0, source: [] as Array<{ value: number; key: string }>, observation: [] as Array<{ value: number; key: string }> };
}

function finishSpacing(values: Array<{ value: number; key: string }>): Spacing {
	const previous = new Map<string, number>();
	const gaps: number[] = [];
	for (const point of values) {
		if (!Number.isFinite(point.value)) continue;
		const last = previous.get(point.key);
		if (last !== undefined) {
			const delta = point.value - last;
			if (Number.isFinite(delta) && delta >= 0) gaps.push(delta);
		}
		previous.set(point.key, point.value);
	}
	return spacing(gaps);
}

export function analyzePointerDeliveryTrace(
	events: readonly PointerTraceEntry[],
	meta?: Partial<PointerTraceMeta>
): PointerDeliveryAnalysis {
	if (events.length === 0 || events.some((event) => !hasAnalysisFields(event))) {
		return {
			available: false,
			reason: "trace lacks additive event identity, epoch, role, or source/observation timing fields",
			incomplete: false,
			truncated: false,
			partialBatch: false,
			evictedRows: 0,
			evictedSamples: 0,
			streams: {},
			contacts: {},
			epochs: [],
		};
	}

	const groups = new Map<string, PointerTraceEntry[]>();
	for (const event of events) {
		const key = eventKey(event);
		const group = groups.get(key);
		if (group) group.push(event);
		else groups.set(key, [event]);
	}
	const streams: Record<string, ReturnType<typeof streamState>> = {};
	const contacts: Record<string, PointerDeliveryAnalysis["contacts"][string]> = {};
	const active = new Map<string, string>();
	const serials = new Map<string, number>();
	let incomplete = Boolean(meta?.partialBatch || meta?.truncated || meta?.evictedRows || meta?.evictedSamples);
	const epochs = [...new Set(events.map((event) => event.epoch!))].sort((a, b) => a - b);

	for (const group of groups.values()) {
		const event = group.find((candidate) => candidate.role === "lifecycle" && /^(pointerdown|pointerup|pointercancel)$/.test(candidate.type))
			?? group.find((candidate) => candidate.role !== "annotation")
			?? group[0]!;
		const epoch = event.epoch!;
		const pointer = `${epoch}:${event.id}`;
		const silentLift = event.role === "lifecycle" && event.termination === "silent-lift";
		if (event.role === "lifecycle" && (/^(pointerdown|pointerup|pointercancel)$/.test(event.type) || silentLift)) {
			if (event.type === "pointerdown") {
				const serial = (serials.get(pointer) ?? 0) + 1;
				serials.set(pointer, serial);
				const key = `${pointer}:${serial}`;
				active.set(pointer, key);
				contacts[key] = { epoch, pointerId: event.id, incomplete: false, streams: {}, lifecycle: [] };
			}
			const key = active.get(pointer) ?? `${pointer}:unpaired:${event.eventId}`;
			const contact = contacts[key] ?? (contacts[key] = { epoch, pointerId: event.id, incomplete: true, streams: {}, lifecycle: [] });
			if (key.includes(":unpaired:")) incomplete = true;
			contact.lifecycle.push({ type: silentLift ? "silent-lift" : event.type, sourceT: event.sourceT!, observationT: event.observationT!, x: event.x, y: event.y, pressure: event.pressure });
			if (event.type !== "pointerdown") active.delete(pointer);
			continue;
		}
		if (event.role !== "sample" || (event.type !== "pointermove" && event.type !== "pointerrawupdate")) continue;
		const stream = (streams[event.type] ??= streamState());
		const key = active.get(pointer) ?? `${pointer}:unpaired:${event.eventId}`;
		const contact = contacts[key] ?? (contacts[key] = { epoch, pointerId: event.id, incomplete: true, streams: {}, lifecycle: [] });
		if (key.endsWith(":unpaired")) {
			contact.incomplete = true;
			incomplete = true;
		}
		const childSamples = event.cs && event.cs.length > 0
			? event.cs
			: event.partial
				? []
				: [{ t: event.sourceT!, x: event.x, y: event.y, p: event.pressure }];
		if (event.partial) {
			contact.incomplete = true;
			incomplete = true;
		}
		stream.parentCount++;
		stream.sampleCount += childSamples.length;
		if (event.cs && event.cs.length > 0) stream.coalescedParentCount++;
		stream.observation.push({ value: event.observationT!, key });
		stream.source.push(...childSamples.map((sample) => ({ value: sample.t, key })));
		const contactStream = (contact.streams[event.type] ??= { parentCount: 0, sampleCount: 0 });
		contactStream.parentCount++;
		contactStream.sampleCount += childSamples.length;
	}

	for (const contact of Object.values(contacts)) {
		if (contact.lifecycle.length === 0 || !["pointerup", "pointercancel", "silent-lift"].includes(contact.lifecycle.at(-1)!.type)) {
			contact.incomplete = true;
			incomplete = true;
		}
	}
	if (meta?.evictedRows || meta?.evictedSamples || meta?.truncated || meta?.partialBatch) {
		for (const contact of Object.values(contacts)) contact.incomplete = true;
	}
	return {
		available: true,
		incomplete,
		truncated: Boolean(meta?.truncated),
		partialBatch: Boolean(meta?.partialBatch),
		evictedRows: meta?.evictedRows ?? 0,
		evictedSamples: meta?.evictedSamples ?? 0,
		streams: Object.fromEntries(Object.entries(streams).map(([name, stream]) => [name, {
			parentCount: stream.parentCount,
			sampleCount: stream.sampleCount,
			coalescedParentCount: stream.coalescedParentCount,
			sourceSpacing: finishSpacing(stream.source),
			observationSpacing: finishSpacing(stream.observation),
		}])),
		contacts,
		epochs,
	};
}
