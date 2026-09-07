/**
 * Repaint every ink surface when the app comes back to the foreground.
 *
 * The report this exists for (1.4.12-design.md §14, an iPad): ink beside
 * text, photos or a pdf "periodically disappears" while scrolling or
 * zooming, and the only fix the reporter found is to open another note and
 * come back. Opening another note remounts the overlay, which reallocates
 * and repaints every canvas - so the pixels were gone and nothing was
 * asking for them again.
 *
 * WebKit reclaims a canvas's backing store under memory pressure and tells
 * the page nothing. A backgrounded or screen-locked app is the single most
 * likely moment for that to happen, and it is also the one moment we get a
 * reliable event for. Until now the three foreground events did nothing for
 * the pixels: `visibilitychange` only flushed persistence (main.ts, the
 * background/freeze flush), and `pageshow` and `focus` were not listened for
 * at all. So a purge that happened while the app was away survived the
 * return, and the band had to move before anything redrew.
 *
 * Why all three, and why coalesced. iOS does not fire any one of them
 * reliably - the same reason the freeze flush already listens for both
 * `visibilitychange` and `pagehide` - so the safe thing is to listen for
 * every event that can mean "we are back" and make the SET idempotent
 * rather than pick a winner. A return commonly delivers two or three of
 * them in the same tick; a repaint of every surface is a full
 * re-rasterisation of every visible stroke on five canvases per editor, and
 * doing that three times for one return is exactly the cost this coalescing
 * removes. The 0 ms timer is the coalescing window: everything that arrives
 * before the task runs folds into the one repaint it performs.
 *
 * A hidden `visibilitychange` is not a foreground event and must not repaint:
 * it is the freeze edge, where the webview may already be suspended.
 *
 * Written against a host seam rather than the globals so the behaviour is
 * testable. `src/main.ts` is imported by no test file (see
 * DeferredUnloadGuard.test.ts), so anything left inline there could only ever
 * be pinned by a source scan; the decision and the teardown live here where a
 * test can drive them for real, and main.ts keeps only the wiring.
 *
 * MOBILE ONLY. The defect above is a WebKit fact, not a desktop one, and this
 * was registered unconditionally until an auditor caught it (2026-09-05):
 * every desktop alt-tab back into Obsidian was re-rasterising every visible
 * stroke on every open pane, for a purge desktop Chromium never does. See
 * `ForegroundHost.isMobileApp`.
 */

/** The document half of the seam: visibility, and its event. */
export interface ForegroundDoc {
	readonly visibilityState: string;
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

/** The window half: the other two events, and the coalescing timer. */
export interface ForegroundWin {
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
	setTimeout(handler: () => void, ms: number): number;
	clearTimeout(id: number): void;
}

export interface ForegroundHost {
	doc: ForegroundDoc;
	win: ForegroundWin;
	/**
	 * Is this device a WebKit mobile app? Gates whether this file registers
	 * anything at all.
	 *
	 * The purge this file exists for (design §14) is a WebKit-reclaims-the-
	 * canvas defect, observed on an iPad - not a desktop fact. Registered
	 * unconditionally, this made every desktop's alt-tab back into Obsidian
	 * re-rasterise every visible stroke on every open pane's canvases, for a
	 * purge that desktop Chromium does not do (auditor, 2026-09-05). Read
	 * once, at `armForegroundRepaint`'s call: this is a device fact like the
	 * ones `MobileTools.ts`'s `ButtonSpec.shownOn` reads, not a live state
	 * that could need a listener of its own.
	 */
	isMobileApp: boolean;
}

/**
 * The three events that can mean "this app is in front of a user again".
 *
 * Exported so a source scan can assert the wiring names the same set the
 * behaviour is written against, instead of the two lists drifting apart.
 */
export const FOREGROUND_EVENTS = ["visibilitychange", "pageshow", "focus"] as const;

/**
 * Listen on all three, repaint once per foreground, and hand back the
 * teardown.
 *
 * The returned function removes every listener and drops a coalescing timer
 * that has not fired yet. Obsidian's `Component.register` takes it as-is, so
 * a disabled or reloaded plugin leaves nothing on the document or the window
 * - the failure `disarmPrintSwaps` exists for, by the same door.
 */
export function armForegroundRepaint(
	host: ForegroundHost,
	repaint: () => void
): () => void {
	// Desktop has no reclaimed canvas to repaint and no purge to chase - see
	// `ForegroundHost.isMobileApp`. Nothing is registered at all, so the
	// teardown below has nothing to remove either.
	if (!host.isMobileApp) return () => {};

	let timer: number | null = null;
	let torndown = false;

	const run = () => {
		timer = null;
		if (torndown) return;
		repaint();
	};

	const wake = () => {
		if (torndown) return;
		// Already scheduled: this is the second or third event of the same
		// return, and it has nothing to add.
		if (timer !== null) return;
		timer = host.win.setTimeout(run, 0);
	};

	const onVisibility = () => {
		// The hidden edge belongs to the persistence flush, not here.
		if (host.doc.visibilityState !== "visible") return;
		wake();
	};

	host.doc.addEventListener("visibilitychange", onVisibility);
	host.win.addEventListener("pageshow", wake);
	host.win.addEventListener("focus", wake);

	return () => {
		torndown = true;
		host.doc.removeEventListener("visibilitychange", onVisibility);
		host.win.removeEventListener("pageshow", wake);
		host.win.removeEventListener("focus", wake);
		if (timer !== null) {
			host.win.clearTimeout(timer);
			timer = null;
		}
	};
}
