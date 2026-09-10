/**
 * The page half of the fold-order harness: the real `FoldOrderControl`, in a
 * page shaped like Obsidian with a settings modal open over a note.
 *
 * WHY A SECOND PAGE. The defect this exists for is a RESIZE defect - "i
 * narrowed the window and it didnt update the more line" (alan, 2026-09-05) -
 * and every layer it could live in needs a real engine: a `ResizeObserver`
 * that actually fires, a `window.resize` that actually arrives, a pane whose
 * `clientWidth` actually changes, and a strip whose `offsetWidth`s are real
 * numbers. The unit suite's fake DOM answers 0 to every dimension, so
 * `layoutOverflow` bails at `available <= 0` and no fold is ever computed
 * there at all. There is no fake that can see this.
 *
 * WHAT IS REAL HERE
 *   - `FoldOrderControl`, its `detectStripWidth`, its `measure`/`refold`, its
 *     `watchWidth` listeners, and the preview `MobileTools` it builds.
 *   - `styles.css`, injected verbatim by the caller, including the
 *     `--handwriting-fold-keep` arithmetic that positions the dashed line.
 *   - The browser's layout, its ResizeObserver and its resize event.
 *
 * WHAT IS STANDING IN
 *   - Obsidian's workspace markup, rebuilt from the class names
 *     `detectStripWidth` reads: `.workspace-split.mod-root`, a
 *     `.workspace-leaf.mod-active`, and a pane holding a `.cm-editor`. If
 *     Obsidian renames one of those this page keeps passing while the plugin
 *     stops working - the same honest limit `buildLeaf` carries.
 *   - The settings modal: a FIXED-WIDTH box, because Obsidian's settings
 *     modal does not shrink with the window until the window is narrower than
 *     the modal. That fixed width is the whole premise of the case: the
 *     control's own root does not change size, so the ResizeObserver on it
 *     has nothing to report and the window listener is the only live path.
 *   - `MobileToolsHost`, the same no-op fake the strip page uses.
 */

import {
	MobileTools,
	normalizeFoldOrder,
	setStripFoldOrder,
	type MobileToolsHost,
} from "../../src/inline/MobileTools";
import { FoldOrderControl, detectStripWidth } from "../../src/inline/FoldOrderControl";
import { installObsidianDom } from "./obsidianDom";
import HandwritingPlugin, { HandwritingSettingTab } from "../../src/main";

let fingerAvailable = false;
const fakeHost = (): MobileToolsHost => ({
	fingerInkAvailable: () => fingerAvailable,
	exec: () => {},
	setPlacement: () => {},
	activeTool: () => "pen",
	eraserOn: () => false,
	eraserWholeStroke: () => false,
	setEraserWholeStroke: () => {},
	lassoOn: () => false,
	spaceOn: () => false,
	panOn: () => false,
	toolColor: () => "#3b7dd8",
	eraserRadiusPx: () => 10,
	setEraserRadiusPx: () => {},
	inkSizeMult: () => 1,
	setInkSizeMult: () => {},
	canUndo: () => true,
	canRedo: () => true,
	canPasteInk: () => true,
	mouseInkOn: () => false,
	armMouseInkQuietly: () => {},
	disarmMouseInkQuietly: () => {},
	toast: () => {},
	recordingOn: () => false,
	hasInkSelection: () => true,
	paletteFor: () => [],
	pickColor: () => {},
	presetsFor: () => [],
	applyPreset: () => {},
	starPreset: () => {},
	forgetPreset: () => {},
	setEditorFocus: () => {},
	penInksHere: () => true,
	// The widest strip, so the fold this page measures is a desktop's rather
	// than a phone's - and so the button set does not move under the test.
	hasTouch: () => false,
});

export interface FoldOrderOptions {
	realSettings?: boolean;
	initialOrder?: string[];
	fingerAvailable?: boolean;
	corner?: Parameters<MobileTools["setCorner"]>[0];
	/**
	 * Whether a REAL strip is up in the editor pane. Alan's toolbar was, so
	 * both branches of `detectStripWidth` that can win in practice - the
	 * strip's own parent, and the active editor's pane - get a case.
	 */
	realStrip: boolean;
	/** The settings modal's width. Fixed; it is what does not shrink. */
	modalWidth: number;
	/**
	 * A left sidebar of this many pixels, which a real Obsidian window has and
	 * which does NOT give width back when the window narrows - the note's pane
	 * absorbs the whole change.
	 */
	sidebar?: number;
	/**
	 * Put a SECOND real strip in that sidebar - a note open in the side dock,
	 * with its toolbar up. The sidebar is a fixed width and sits EARLIER in
	 * document order than the root split, which is the shape Obsidian's
	 * workspace has.
	 */
	sidebarStrip?: boolean;
	/** Build the editor's strip collapsed to its pill, as a phone leaves it. */
	collapsed?: boolean;
	/** The modal shrinks with the window (Obsidian's does, past a point). */
	modalFluid?: boolean;
	/** No workspace at all, so the cascade falls through to `innerWidth`. */
	noWorkspace?: boolean;
	/** No `.mod-active` leaf, so the cascade takes its own fallback branch. */
	noActiveLeaf?: boolean;
}

/** Everything one look at the control can see, in one round trip. */
export interface FoldProbe {
	/** `window.innerWidth`, the outermost input. */
	winInnerWidth: number;
	/** What `detectStripWidth` answers RIGHT NOW, called directly. */
	detected: number;
	/** Each branch of that cascade, separately, so a tie can be told apart. */
	branchStripParent: number | null;
	branchEditorPane: number | null;
	branchWorkspaceRoot: number | null;
	/** The label the control last WROTE - i.e. what its own `measure` saw. */
	label: string;
	/** The control's root width, which is what its ResizeObserver watches. */
	controlRootWidth: number;
	/** The preview pane: what was written on it, and what it measures. */
	paneStyleWidth: string;
	paneClientWidth: number;
	/** The list's fold-line inputs: the custom property and the no-fold class. */
	keep: string;
	isNofold: boolean;
	/** The dashed line's rendered offset from the top of the list, in px. */
	lineTop: number;
	/** The caption under the list. */
	caption: string;
	/**
	 * The buttons the PREVIEW STRIP has actually put on its second row, by the
	 * `aria-label` their own spec gave them - the strip carries no id
	 * attribute, and the label is what a user would name them by anyway.
	 */
	previewSecondRow: string[];
	/** The buttons still on the preview strip's FIRST row, same naming. */
	previewFirstRow: string[];
	/** The preview strip's own box, and the budget `layoutOverflow` computes. */
	stripOffsetWidth: number;
	stripAvailable: number;
	/** How many rows the list holds, so `keep` can be read against a total. */
	rowCount: number;
}

let control: FoldOrderControl | null = null;
let editorStrip: MobileTools | null = null;
let sideStrip: MobileTools | null = null;
let root: HTMLElement | null = null;
let saved: string[] = [];

/**
 * A page shaped like Obsidian with the settings tab open over a note.
 *
 * The workspace is FLUID (100% of the viewport) and the modal is FIXED, which
 * is the arrangement the defect was reported in: narrowing the window narrows
 * the note's pane and leaves the settings modal exactly where it was.
 */
function buildFoldOrder(opts: FoldOrderOptions): void {
	installObsidianDom();
	document.body.innerHTML = "";
	saved = normalizeFoldOrder(opts.initialOrder ?? []);
	fingerAvailable = opts.fingerAvailable === true;
	setStripFoldOrder(saved);
	// No scrollbars: a horizontal scrollbar from the fixed modal would take
	// width off the workspace and make the two measurements argue.
	document.documentElement.style.cssText = "overflow:hidden;";
	document.body.style.cssText = "margin:0;overflow:hidden;display:flex;";

	/** One note pane, shaped the way `chromeHost()` finds one. */
	const notePane = (active: boolean): HTMLElement => {
		const leaf = document.createElement("div");
		leaf.className = active ? "workspace-leaf mod-active" : "workspace-leaf";
		leaf.style.cssText = "width:100%;height:100%;";
		const pane = document.createElement("div");
		// The element `chromeHost()` hands the strip, and the element
		// `layoutOverflow` measures: `view.dom.parentElement`.
		pane.className = "markdown-source-view mod-cm6";
		pane.style.cssText = "position:relative;width:100%;height:100%;";
		const cm = document.createElement("div");
		cm.className = "cm-editor";
		cm.style.cssText = "width:100%;height:100%;";
		pane.appendChild(cm);
		leaf.appendChild(pane);
		return leaf;
	};

	if (opts.sidebar !== undefined) {
		const side = document.createElement("div");
		side.className = "workspace-split mod-horizontal mod-left-split";
		side.style.cssText = `flex:0 0 ${opts.sidebar}px;height:100vh;overflow:hidden;`;
		document.body.appendChild(side);
		if (opts.sidebarStrip === true) {
			const sideLeaf = notePane(false);
			side.appendChild(sideLeaf);
			const sidePane = sideLeaf.querySelector<HTMLElement>(".markdown-source-view");
			if (sidePane) sideStrip = new MobileTools(sidePane, fakeHost());
		}
	}
	if (opts.noWorkspace !== true) {
		const split = document.createElement("div");
		split.className = "workspace-split mod-root";
		split.style.cssText = "flex:1 1 auto;min-width:0;height:100vh;";
		const leaf = notePane(opts.noActiveLeaf !== true);
		split.appendChild(leaf);
		document.body.appendChild(split);
		const pane = leaf.querySelector<HTMLElement>(".markdown-source-view");
		if (opts.realStrip && pane) {
			editorStrip = new MobileTools(pane, fakeHost());
			if (opts.collapsed === true) editorStrip.setCollapsed(true);
		}
	}

	const modal = document.createElement("div");
	modal.className = "modal";
	modal.style.cssText =
		"position:fixed;top:0;left:0;height:100vh;overflow:auto;background:#fff;" +
		(opts.modalFluid === true
			? `width:90vw;max-width:${opts.modalWidth}px;`
			: `width:${opts.modalWidth}px;`);
	document.body.appendChild(modal);
	const holder = modal.createDiv({ cls: "setting-item handwriting-fold-order-row" });

	if (opts.realSettings) {
		const plugin = Object.create(HandwritingPlugin.prototype);
		plugin.manifest = { version: "1.4.16" };
		plugin.app = {};
		plugin.settings = { stripFoldOrder: saved, toolbarCorner: opts.corner ?? "top-right" };
		plugin.persistSettings = async () => { saved = [...plugin.settings.stripFoldOrder]; };
		const tab = Object.create(HandwritingSettingTab.prototype);
		tab.plugin = plugin;
		const groups = tab.getSettingDefinitions();
		const find = (items: any[]): any => items.flatMap(item => item.items ? find(item.items) : [item]);
		const definitions = find(groups);
		const definition = definitions.find((item: any) => item.name === "Toolbar buttons");
		holder.createDiv({ cls: "setting-item-info", text: definition.desc });
		holder.createDiv({ cls: "setting-item-control" });
		definition.render({ settingEl: holder });
		control = tab.foldOrder;
		modal.dataset.separateRecognitionToggle = String(definitions.some((item: any) => item.control?.key === "recognitionStripButtons"));
	} else control = new FoldOrderControl(holder, {
		order: () => saved,
		apply: (order) => {
			saved = normalizeFoldOrder(order);
			setStripFoldOrder(saved);
		},
		corner: () => opts.corner ?? "top-right",
		previewHost: fakeHost(),
	});
	root = document.querySelector<HTMLElement>(".handwriting-fold-order");
	if (!root) throw new Error("the control built no root");
}

/** The parent width of the first strip that is not one of the control's own. */
function stripParentWidth(): number | null {
	for (const strip of Array.from(document.querySelectorAll(".handwriting-mobile-tools"))) {
		if (strip.closest(".handwriting-fold-order")) continue;
		const parent = strip.parentElement;
		if (parent && parent.clientWidth > 0) return parent.clientWidth;
	}
	return null;
}

function foldProbe(): FoldProbe {
	if (!root) throw new Error("no control has been built");
	const list = root.querySelector<HTMLElement>(".handwriting-fold-list");
	const line = root.querySelector<HTMLElement>(".handwriting-fold-line");
	const label = root.querySelector<HTMLElement>(".handwriting-fold-preview-width");
	const cap = root.querySelector<HTMLElement>(".handwriting-fold-cap");
	const pane = root.querySelector<HTMLElement>(".handwriting-fold-preview-pane");
	if (!list || !line || !label || !cap || !pane) throw new Error("the control is missing a part");
	const editor =
		document.querySelector(".workspace-leaf.mod-active .cm-editor") ??
		document.querySelector(".cm-editor");
	const editorPane = editor?.parentElement ?? null;
	const wsRoot = document.querySelector(".workspace-split.mod-root");
	const secondRow = pane.querySelector(".handwriting-mobile-tools-more");
	const stripEl = pane.querySelector<HTMLElement>(".handwriting-mobile-tools");
	// `ownName` moves each button's `aria-label` into `data-tip-label` and a
	// screen-reader span, so the label a strip button answers to is there.
	const names = (from: Element | null): string[] =>
		from
			? Array.from(from.querySelectorAll<HTMLElement>(":scope > button")).map(
					(el) => el.dataset.tipLabel ?? el.getAttribute("aria-label") ?? "?"
				)
			: [];
	return {
		winInnerWidth: window.innerWidth,
		detected: detectStripWidth(document, window),
		branchStripParent: stripParentWidth(),
		branchEditorPane: editorPane ? editorPane.clientWidth : null,
		branchWorkspaceRoot: wsRoot ? wsRoot.clientWidth : null,
		label: label.textContent ?? "",
		controlRootWidth: root.clientWidth,
		paneStyleWidth: pane.style.width,
		paneClientWidth: pane.clientWidth,
		keep: list.style.getPropertyValue("--handwriting-fold-keep"),
		isNofold: list.classList.contains("is-nofold"),
		lineTop: line.getBoundingClientRect().top - list.getBoundingClientRect().top,
		caption: cap.textContent ?? "",
		previewSecondRow: names(secondRow),
		previewFirstRow: names(stripEl),
		stripOffsetWidth: stripEl ? stripEl.offsetWidth : 0,
		// The very number `layoutOverflow` computes, re-read here so a report
		// says what the fold was decided against rather than what it produced.
		stripAvailable: stripEl
			? pane.clientWidth - 16 - (stripEl.offsetWidth - stripEl.clientWidth)
			: 0,
		rowCount: list.querySelectorAll(".handwriting-fold-row").length,
	};
}

/**
 * HOW WIDE A ROW IS, AND HOW MUCH OF THAT IS INK.
 *
 * "why is there so much space still on the right" (alan, 2026-09-06, on the
 * five reorder rows). A row's emptiness is the gap between where its label
 * stops and where its border stops, and neither number exists outside a real
 * engine: the rows are flex boxes whose name span stretches, so `offsetWidth`
 * of the span says nothing about where the TEXT ends. A Range over the span's
 * contents is what actually measures the ink.
 *
 * The card's inner width comes back with it because the claim being tested is
 * comparative - a row sized to its content rather than to the room it is
 * offered - and a width with nothing to compare it against cannot say that.
 */
export interface RowWidthProbe {
	/** The room a row is offered: the card's content box. */
	cardInnerWidth: number;
	/** The list box - which is also what the dashed line spans. */
	listLeft: number;
	listWidth: number;
	/** The dashed line, so the line and the rows can be held against each other. */
	lineLeft: number;
	lineWidth: number;
	rows: Array<{
		label: string;
		left: number;
		right: number;
		width: number;
		/** Where the row's last piece of ink is: the label text's own right edge. */
		textRight: number;
	}>;
}

/** The right edge of the TEXT in an element, not of the box holding it. */
function inkRight(el: HTMLElement): number {
	const range = document.createRange();
	range.selectNodeContents(el);
	const box = range.getBoundingClientRect();
	return box.width > 0 ? box.right : el.getBoundingClientRect().right;
}

function rowWidths(): RowWidthProbe {
	if (!root) throw new Error("no control has been built");
	const card = root.querySelector<HTMLElement>(".handwriting-fold-card");
	const list = root.querySelector<HTMLElement>(".handwriting-fold-list");
	const line = root.querySelector<HTMLElement>(".handwriting-fold-line");
	if (!card || !list || !line) throw new Error("the control is missing a part");
	const cardBox = card.getBoundingClientRect();
	const cardStyle = getComputedStyle(card);
	const listBox = list.getBoundingClientRect();
	const lineBox = line.getBoundingClientRect();
	return {
		cardInnerWidth:
			cardBox.width -
			parseFloat(cardStyle.paddingLeft) -
			parseFloat(cardStyle.paddingRight) -
			parseFloat(cardStyle.borderLeftWidth) -
			parseFloat(cardStyle.borderRightWidth),
		listLeft: listBox.left,
		listWidth: listBox.width,
		lineLeft: lineBox.left,
		lineWidth: lineBox.width,
		rows: Array.from(list.querySelectorAll<HTMLElement>(".handwriting-fold-row")).map((row) => {
			const name = row.querySelector<HTMLElement>(".handwriting-fold-name");
			const box = row.getBoundingClientRect();
			return {
				label: name?.textContent ?? "",
				left: box.left,
				right: box.right,
				width: box.width,
				textRight: name ? inkRight(name) : box.left,
			};
		}),
	};
}

/**
 * The list's width with every row at rest, and with the first one picked up.
 *
 * A list sized to its own content is sized to its rows' BORDER boxes, and the
 * row under the finger wears a thicker border - so the two numbers are only
 * equal if the drag state was written not to change the box. They must be:
 * a list that grows two pixels the instant a grip is pressed moves the dashed
 * line, the "More" label and every row's right edge under the hand that is
 * dragging.
 *
 * EVERY row in turn, not the first: a list sized to its content takes the
 * WIDEST row's box, so picking up a short row proves nothing - only the widest
 * one can push the list out. `dragging` is the worst of them.
 *
 * The class is toggled directly rather than through a pointer gesture: what is
 * being measured is the STYLE's effect on layout, and a synthetic drag would
 * add a translate that says nothing about it.
 */
function pickUpWidth(): { idle: number; dragging: number } {
	if (!root) throw new Error("no control has been built");
	const list = root.querySelector<HTMLElement>(".handwriting-fold-list");
	const rows = Array.from(root.querySelectorAll<HTMLElement>(".handwriting-fold-row"));
	if (!list || rows.length === 0) throw new Error("the control is missing a part");
	const idle = list.getBoundingClientRect().width;
	let dragging = idle;
	for (const row of rows) {
		row.classList.add("is-dragging");
		const width = list.getBoundingClientRect().width;
		row.classList.remove("is-dragging");
		if (Math.abs(width - idle) > Math.abs(dragging - idle)) dragging = width;
	}
	return { idle, dragging };
}

/**
 * What the two `display: none` boxes measure, as they are and forced visible.
 *
 * The whole diagnosis in four numbers: `layoutOverflow` reads
 * `this.moreBtn.offsetWidth` and every button's `offsetWidth`, and both the
 * chevron (`.handwriting-tools-more`, hidden until `is-more-needed`) and the
 * folded buttons (inside `.handwriting-mobile-tools-more`, hidden until
 * `is-more-open`) can be display:none at the moment it reads them.
 */
export interface HiddenBoxProbe {
	moreNeeded: boolean;
	moreOpen: boolean;
	chevronAsIs: number;
	chevronForced: number;
	secondRowAsIs: number[];
	secondRowForced: number[];
}

function hiddenBoxes(): HiddenBoxProbe {
	if (!root) throw new Error("no control has been built");
	const strip = root.querySelector<HTMLElement>(
		".handwriting-fold-preview-pane .handwriting-mobile-tools"
	);
	const chevron = root.querySelector<HTMLElement>(
		".handwriting-fold-preview-pane .handwriting-tools-more"
	);
	const second = root.querySelector<HTMLElement>(
		".handwriting-fold-preview-pane .handwriting-mobile-tools-more"
	);
	if (!strip || !chevron || !second) throw new Error("the preview strip is missing a part");
	const kids = (): HTMLElement[] => Array.from(second.querySelectorAll<HTMLElement>(":scope > *"));
	const moreNeeded = strip.classList.contains("is-more-needed");
	const moreOpen = strip.classList.contains("is-more-open");
	const chevronAsIs = chevron.offsetWidth;
	const secondRowAsIs = kids().map((el) => el.offsetWidth);
	strip.classList.add("is-more-needed", "is-more-open");
	const chevronForced = chevron.offsetWidth;
	const secondRowForced = kids().map((el) => el.offsetWidth);
	strip.classList.toggle("is-more-needed", moreNeeded);
	strip.classList.toggle("is-more-open", moreOpen);
	return { moreNeeded, moreOpen, chevronAsIs, chevronForced, secondRowAsIs, secondRowForced };
}

/**
 * WHAT A RESIZE ACTUALLY COSTS, counted.
 *
 * "It kinda stutters, the animation is not smooth" (alan, 2026-09-05,
 * narrowing the window with the settings control open). A stutter is frames
 * missed, and frames are missed when one width change makes the page do more
 * layout work than fits in a frame - so what has to be counted is the work
 * per width change, not asserted about.
 *
 * Three numbers, and the third is the one that decides it:
 *
 *   - `callbacks`: ResizeObserver callbacks delivered. The page has several
 *     observers (the control's own on its root, and one per live strip on its
 *     pane), so more than one per width change is expected, not a defect.
 *   - `ms`: main-thread time inside them. This is what a frame budget is
 *     spent on.
 *   - `loops`: how many times the engine reported "ResizeObserver loop
 *     completed with undelivered notifications". Chrome raises that when a
 *     resize callback RESIZES SOMETHING IT IS WATCHING, so the observation
 *     cannot settle within the frame and the remainder is deferred to the
 *     next one. Each of those is a frame the user paid for and did not see a
 *     finished layout in. It is the difference between "expensive" and
 *     "stuttering", and it cannot be reasoned about from the source - only a
 *     real engine delivers it.
 *
 * INSTALLED BEFORE THE CONTROL IS BUILT, by patching the constructor the
 * control reaches for. Nothing in `src/` is touched or aware of it.
 */
export interface ReflowProbe {
	callbacks: number;
	ms: number;
	loops: number;
}

let counter: ReflowProbe = { callbacks: 0, ms: 0, loops: 0 };
let armed = false;

function armReflowCounter(): void {
	counter = { callbacks: 0, ms: 0, loops: 0 };
	if (armed) return;
	armed = true;
	const Native = window.ResizeObserver;
	class Counting extends Native {
		constructor(cb: ResizeObserverCallback) {
			super((entries, self) => {
				const t0 = performance.now();
				try {
					cb(entries, self);
				} finally {
					counter.callbacks += 1;
					counter.ms += performance.now() - t0;
				}
			});
		}
	}
	window.ResizeObserver = Counting as unknown as typeof ResizeObserver;
	// Chrome reports the undelivered-notification loop as a window error
	// rather than a rejection or a console line, so this is where it can be
	// caught. Matched on the text because the engine gives it no code.
	window.addEventListener("error", (ev) => {
		if (String(ev.message).includes("ResizeObserver loop")) counter.loops += 1;
	});
}

function readReflowCounter(): ReflowProbe {
	return { ...counter };
}

function resetReflowCounter(): void {
	counter = { callbacks: 0, ms: 0, loops: 0 };
}

/** Tear the control down, the way a closing settings tab does. */
function destroyFoldOrder(): void {
	control?.destroy();
	control = null;
	editorStrip?.destroy();
	editorStrip = null;
	sideStrip?.destroy();
	sideStrip = null;
	root = null;
}

declare global {
	interface Window {
		__fold: {
			buildFoldOrder: typeof buildFoldOrder;
			foldProbe: typeof foldProbe;
			rowWidths: typeof rowWidths;
			pickUpWidth: typeof pickUpWidth;
			hiddenBoxes: typeof hiddenBoxes;
			destroyFoldOrder: typeof destroyFoldOrder;
			armReflowCounter: typeof armReflowCounter;
			readReflowCounter: typeof readReflowCounter;
			resetReflowCounter: typeof resetReflowCounter;
			savedOrder: () => string[];
		};
	}
}

window.__fold = {
	savedOrder: () => [...saved],
	buildFoldOrder,
	foldProbe,
	rowWidths,
	pickUpWidth,
	hiddenBoxes,
	destroyFoldOrder,
	armReflowCounter,
	readReflowCounter,
	resetReflowCounter,
};
