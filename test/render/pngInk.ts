/**
 * Ink in a compositor screenshot: what the viewer sees, after every clip and
 * transform, as opposed to what a canvas's backing store holds. A backing
 * store can carry a stroke that an ancestor's overflow then hides, and a
 * rectangle can cover a point that nothing paints; the PNG the browser
 * composited is the only reading that answers "is the ink on the screen".
 *
 * The decoder is the one LagPinchD4 uses (the plugin's own inflate), kept here
 * so a test can sample small clips cheaply instead of decoding a whole pane.
 */
import { inflate, unpredict } from "../../src/pdf/Flate";

export interface Decoded { width: number; height: number; channels: number; px: Uint8Array }

export function decodePng(png: Uint8Array): Decoded {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let at = 8, width = 0, height = 0, colorType = 0;
	const idat: Uint8Array[] = [];
	while (at + 8 <= png.length) {
		const len = view.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8));
		if (type === "IHDR") { width = view.getUint32(at + 8); height = view.getUint32(at + 12); colorType = png[at + 17]!; }
		else if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len));
		else if (type === "IEND") break;
		at += 12 + len;
	}
	const channels = colorType === 6 ? 4 : 3;
	const z = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
	let o = 0; for (const d of idat) { z.set(d, o); o += d.length; }
	const raw = inflate(z); if (!raw) throw new Error("png inflate failed");
	const px = unpredict(raw, 15, channels, 8, width); if (!px) throw new Error("png unpredict failed");
	return { width, height, channels, px };
}

export type Ink = "red" | "green" | "blue";
export const INK_CSS: Record<Ink, string> = { red: "#ff0000", green: "#00b400", blue: "#0000ff" };

/** Loose colour test: the channel leads the other two by 40, so the whole anti-aliased footprint counts (see LagPinchVisibleInk). */
export const isInkLoose = (d: Decoded, i: number, ink: Ink): boolean => {
	const r = d.px[i]!, g = d.px[i + 1]!, b = d.px[i + 2]!;
	if (ink === "red") return r > 150 && r > g + 40 && r > b + 40;
	if (ink === "green") return g > 120 && g > r + 40 && g > b + 40;
	return b > 150 && b > r + 40 && b > g + 40;
};

/** Pixels of `ink` in a decoded clip, with the bbox in the clip's own device px. */
export function countInk(d: Decoded, ink: Ink) {
	let n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (let py = 0; py < d.height; py++) for (let px = 0; px < d.width; px++) {
		const i = (py * d.width + px) * d.channels;
		if (!isInkLoose(d, i, ink)) continue;
		n++; x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
	}
	return n ? { n, x0, y0, x1, y1 } : { n: 0 };
}
