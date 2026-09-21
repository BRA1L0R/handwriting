/**
 * The Slides host's `nib()`, executed through its production caller, in real
 * Chromium.
 *
 * The nib is a closure inside `HandwritingPlugin.startSlidesInk` (main.ts). No
 * test had ever run it: every Slides suite hands `SlidesDeck` a host of its
 * own whose nib is a literal. So this page runs the REAL chain, unedited:
 *
 *   startSlidesInk() builds the host  ->  setSlidesInk(true, host)
 *   -> scanForSlides() finds `.slides-container > .reveal > .slides`
 *   -> new SlidesDeck(..., host)  ->  a pen `pointerdown` on `.reveal`
 *   -> SlidesDeck.onPointerDown  ->  host.nib()  ->  StrokeBuilder, wet layer,
 *   commit, repaint, persist  ->  host.scheduleSidecar  ->  plugin.store.schedule
 *
 * The plugin instance is `Object.create(HandwritingPlugin.prototype)` (the
 * pattern `SettingsUnknownKeys.test.ts` established), and only the Obsidian
 * boundary the host's OTHER members read is supplied by hand: the active
 * file, the vault read, the page-id pair and the page store. `nib` reads none
 * of those; it reads the session's tool, colour and size, which this page sets
 * through the same setters the commands and the strip call.
 *
 * THE PAGE THIS MIRRORS: a presentation of a two-slide deck in Obsidian's dark
 * theme, a 960x700 Reveal slide at scale 1 inside a container that is not at
 * the window origin (31,27), written on with a pen: a row per nib setting.
 */
import HandwritingPlugin from "../../src/main";
import { setInkSizeMult, setInlineTool } from "../../src/inline/InkOverlay";
import { setPenInk } from "../../src/inline/PenInk";
import { setInkColorHex } from "../../src/ink/InkColor";
import type { InkStroke, InkTool } from "../../src/ink/Stroke";
import { setSlidesInk } from "../../src/slides/SlidesInkSurface";
import {
	closestInColumn,
	drawMarks,
	frames,
	gesture,
	installHostDom,
	line,
	sample,
	type Marks,
	type Order,
	type Pt,
} from "./penMarks";

installHostDom();

export const SLIDE_BG = "#1e1e1e";
const SOURCE = "slide 0\n\n---\n\nslide 1";

interface Scheduled {
	id: string;
	strokes: InkStroke[];
}

let scheduled: Scheduled[] = [];
let started = false;

function buildDeck(): { container: HTMLElement; slides: HTMLElement } {
	document.querySelectorAll(".slides-container").forEach((el) => el.remove());
	const container = document.body.appendChild(document.createElement("div"));
	container.className = "slides-container";
	container.style.cssText = `position:absolute;left:31px;top:27px;width:1000px;height:760px;background:${SLIDE_BG};`;
	const reveal = container.appendChild(document.createElement("div"));
	reveal.className = "reveal";
	reveal.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;";
	const slides = reveal.appendChild(document.createElement("div"));
	slides.className = "slides";
	// Reveal's own arrangement: a fixed logical slide size, scaled by transform.
	slides.style.cssText =
		"position:absolute;left:20px;top:30px;width:960px;height:700px;transform:scale(1);transform-origin:0 0;";
	for (let i = 0; i < 2; i++) {
		const s = slides.appendChild(document.createElement("section"));
		s.textContent = `slide ${i}`;
		s.style.cssText = `position:absolute;left:0;top:0;width:960px;color:#8a8a8a;font:32px monospace;${i === 0 ? "" : "display:none;"}`;
		if (i === 0) s.classList.add("present");
	}
	return { container, slides };
}

/** The production plugin method, on an instance with only the boundary supplied. */
function startProductionSlidesInk(): void {
	if (started) return;
	started = true;
	const plugin = Object.create(HandwritingPlugin.prototype) as Record<string, unknown>;
	plugin.manifest = { version: "slides-nib-page" };
	plugin.app = {
		workspace: { getActiveFile: () => ({ path: "Deck.md" }) },
		vault: {
			getFileByPath: (path: string) => ({ path }),
			cachedRead: async () => SOURCE,
		},
	};
	// Shadow the two prototype methods the id members call: the vault's
	// frontmatter is not what is under test, and nib() never reads them.
	plugin.notePageId = () => "deck-page";
	plugin.claimNotePageId = async (_path: string, proposed: string) => ({ pageId: proposed });
	plugin.store = {
		load: async () => null,
		schedule: (id: string, page: { strokes: InkStroke[] }) => {
			scheduled.push({ id, strokes: JSON.parse(JSON.stringify(page.strokes)) as InkStroke[] });
		},
		saveNow: async (id: string, page: { strokes: InkStroke[] }) => {
			scheduled.push({ id, strokes: JSON.parse(JSON.stringify(page.strokes)) as InkStroke[] });
		},
	};
	(plugin as unknown as { startSlidesInk(): void }).startSlidesInk();
}

async function mount(): Promise<{ slides: HTMLElement; reveal: HTMLElement }> {
	setSlidesInk(false);
	started = false;
	scheduled = [];
	const { container, slides } = buildDeck();
	startProductionSlidesInk();
	await frames(10);
	// Let the deck's sidecar load settle, so a stroke persists rather than
	// parking behind the load window.
	await new Promise((r) => setTimeout(r, 50));
	await frames(4);
	return { slides, reveal: container.querySelector<HTMLElement>(".reveal")! };
}

export interface NibRow {
	tool: InkTool;
	mult: number;
	pressure: number;
	/** Row centre, client px. */
	y: number;
	/** Painted thickness at the row's middle, css px, from the committed backing. */
	paintedCss: number;
}

export interface NibRun {
	rows: NibRow[];
	/** The strokes the deck handed its store, last write. */
	stored: Array<Pick<InkStroke, "tool" | "color" | "width">>;
	/** css px per logical slide px. */
	k: number;
	committedFound: boolean;
}

const HEX: Record<InkTool, string> = { pen: "#e6e6e6", highlighter: "#4cc9f0" };

/** Contiguous run of alpha >= 128 through (x, y) on the committed backing, in css px. */
function thicknessAt(canvas: HTMLCanvasElement, x: number, y: number): number {
	const r = canvas.getBoundingClientRect();
	const bx = Math.floor(((x - r.left) * canvas.width) / r.width);
	const by = Math.floor(((y - r.top) * canvas.height) / r.height);
	const g = canvas.getContext("2d")!;
	const span = Math.ceil((60 * canvas.height) / r.height);
	const col = g.getImageData(bx, Math.max(0, by - span), 1, 2 * span + 1).data;
	const at = (i: number): number => col[i * 4 + 3]!;
	const mid = Math.min(span, by);
	if (at(mid) < 128) return 0;
	let top = mid;
	while (top > 0 && at(top - 1) >= 128) top--;
	let bottom = mid;
	while (bottom < 2 * span && at(bottom + 1) >= 128) bottom++;
	return ((bottom - top + 1) * r.height) / canvas.height;
}

/**
 * One stroke per setting, each on its own row: pen in the left column,
 * highlighter in the right, sizes x1/x2/x4 at pressures 0.5 and 1.
 */
async function nibRun(): Promise<NibRun> {
	const { slides, reveal } = await mount();
	setPenInk(true);
	const rect = slides.getBoundingClientRect();
	const k = rect.width / slides.clientWidth;
	const rows: NibRow[] = [];
	let pid = 900;
	const columns: Array<{ tool: InkTool; x0: number }> = [
		{ tool: "pen", x0: rect.left + 60 },
		{ tool: "highlighter", x0: rect.left + 380 },
	];
	for (const { tool, x0 } of columns) {
		let y = rect.top + 110;
		for (const mult of [1, 2, 4]) {
			for (const pressure of [0.5, 1]) {
				setInlineTool(tool);
				setInkColorHex(tool, HEX[tool]);
				setInkSizeMult(tool, mult);
				await gesture(line({ x: x0, y }, { x: x0 + 240, y }, 5), ++pid, pressure);
				rows.push({ tool, mult, pressure, y, paintedCss: 0 });
				y += 80;
			}
		}
	}
	setInlineTool("pen");
	setInkSizeMult("pen", 1);
	setInkSizeMult("highlighter", 1);
	await frames(8);
	const committed = reveal.querySelector<HTMLCanvasElement>("canvas.handwriting-slides-ink");
	if (committed) {
		for (let i = 0; i < rows.length; i++) {
			const col = columns.find((c) => c.tool === rows[i]!.tool)!;
			const backing = rows[i]!.tool === "highlighter"
				? reveal.querySelector<HTMLCanvasElement>("canvas.handwriting-slides-highlight")!
				: committed;
			rows[i]!.paintedCss = thicknessAt(backing, col.x0 + 120, rows[i]!.y);
		}
	}
	const last = scheduled[scheduled.length - 1];
	return {
		rows,
		stored: (last?.strokes ?? []).map((s) => ({ tool: s.tool, color: s.color, width: s.width })),
		k,
		committedFound: committed !== null,
	};
}

export interface SlidesScene {
	marks: Marks;
	clip: { x: number; y: number; width: number; height: number };
	storedTools: InkTool[];
}

/** The highlighter composite marks, on a slide. See `HighlighterPixels.test.ts`. */
async function slidesScene(opts: { order: Order; penHex: string }): Promise<SlidesScene> {
	const { slides } = await mount();
	setPenInk(true);
	setInkSizeMult("pen", 4);
	setInkSizeMult("highlighter", 2);
	const r = slides.getBoundingClientRect();
	const c: Pt = { x: r.left + 360, y: r.top + 300 };
	const marks = await drawMarks(c, opts.order, opts.penHex, 1200);
	setInkSizeMult("pen", 1);
	setInkSizeMult("highlighter", 1);
	const box = document.querySelector<HTMLElement>(".slides-container")!.getBoundingClientRect();
	const last = scheduled[scheduled.length - 1];
	return {
		marks,
		clip: { x: box.left, y: box.top, width: box.width, height: box.height },
		storedTools: (last?.strokes ?? []).map((s) => s.tool),
	};
}

(window as unknown as { __nib: unknown }).__nib = { nibRun, slidesScene };
(window as unknown as { __hl: unknown }).__hl = { sample, closestInColumn };
