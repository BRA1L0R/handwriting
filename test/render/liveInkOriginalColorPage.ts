import type { CameraState } from "../../src/camera/coordinates";
import {
	refreshInkTheme,
	resetInkTheme,
	setInkThemeAdaptation,
	setInkThemeOverride,
} from "../../src/ink/InkTheme";
import { DEFAULT_PEN } from "../../src/ink/PenStyle";
import { computeBBox, type InkPoint, type InkStroke } from "../../src/ink/Stroke";
import { drawStroke } from "../../src/ink/StrokeRenderer";
import { TailRenderer } from "../../src/ink/TailRenderer";
import { WetInkRenderer } from "../../src/ink/WetInkRenderer";

const COLOR = "#1c1f26";
const CAM: CameraState = { x: 0, y: 0, zoom: 1 };
const STYLE = { ...DEFAULT_PEN, color: COLOR, baseWidth: 8 };

function canvas(): HTMLCanvasElement {
	const el = document.createElement("canvas");
	el.width = 120;
	el.height = 60;
	return el;
}

function dominantOpaqueColor(el: HTMLCanvasElement): string {
	const data = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
	const counts = new Map<string, number>();
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3]! < 250) continue;
		const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const winner = [...counts].sort((a, b) => b[1] - a[1])[0];
	if (!winner) return "none";
	return `rgb(${winner[0]})`;
}

function stroke(): InkStroke {
	const points: InkPoint[] = [
		{ x: 10, y: 15, pressure: 0.7, t: 0 },
		{ x: 40, y: 16, pressure: 0.7, t: 8 },
		{ x: 75, y: 18, pressure: 0.7, t: 16 },
		{ x: 105, y: 20, pressure: 0.7, t: 24 },
	];
	return {
		id: "live-colour",
		tool: "pen",
		color: COLOR,
		width: STYLE.baseWidth,
		points,
		bbox: computeBBox(points, STYLE.baseWidth),
		createdAt: 0,
	};
}

function render(): Record<string, string> {
	document.body.className = "theme-dark";
	resetInkTheme();
	refreshInkTheme(document);
	setInkThemeAdaptation(true);
	setInkThemeOverride(true);

	const committed = canvas();
	drawStroke(committed.getContext("2d")!, CAM, stroke(), undefined, true, false);

	const wet = canvas();
	const wetRenderer = new WetInkRenderer(wet, false);
	wetRenderer.beginStroke({ x: 10, y: 30, pressure: 0.7, t: 0 }, STYLE);
	wetRenderer.appendPoint(CAM, STYLE, { x: 105, y: 30, pressure: 0.7, t: 8 });

	const head = canvas();
	new TailRenderer(head).drawHead(
		CAM,
		STYLE,
		{ x: 10, y: 30 },
		{ x: 105, y: 30 },
		0.7,
		STYLE.baseWidth / 2
	);

	const predicted = canvas();
	new TailRenderer(predicted).draw(
		10,
		30,
		[
			{ x: 55, y: 30, pressure: 0.7, timestamp: 8, tiltX: 0, tiltY: 0 },
			{ x: 105, y: 30, pressure: 0.7, timestamp: 16, tiltX: 0, tiltY: 0 },
		],
		COLOR,
		STYLE.baseWidth
	);

	return {
		committed: dominantOpaqueColor(committed),
		wet: dominantOpaqueColor(wet),
		head: dominantOpaqueColor(head),
		predicted: dominantOpaqueColor(predicted),
	};
}

(window as Window & { liveInkOriginalColor?: { render: typeof render } }).liveInkOriginalColor = {
	render,
};
