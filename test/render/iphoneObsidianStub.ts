/**
 * Browser-runtime Obsidian seam for the iPhone inline-ink acceptance page.
 *
 * The ordinary render shim models the Windows machine that runs the suite.
 * This one changes only the platform answer and supplies the real CodeMirror
 * StateField that Obsidian installs for file-backed Markdown editors. Keeping
 * the field real is what lets the fixture reuse one mounted EditorView across
 * note A -> note B instead of calling InkOverlayPlugin methods by hand.
 */
export * from "../obsidian-stub";

import { StateEffect, StateField } from "@codemirror/state";

export const Platform = {
	isMobile: true,
	isDesktop: false,
	isIosApp: true,
	isAndroidApp: false,
	isDesktopApp: false,
	isMobileApp: true,
	isPhone: true,
	isTablet: false,
	isMacOS: false,
	isLinux: false,
	isWin: false,
};

export interface BrowserEditorInfo {
	app: { commands: { executeCommandById(id: string): unknown } };
	file: { path: string };
	editor: object;
}

export const setBrowserEditorInfo = StateEffect.define<BrowserEditorInfo>();

export const editorInfoField = StateField.define<BrowserEditorInfo | undefined>({
	create: () => undefined,
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setBrowserEditorInfo)) return effect.value;
		}
		return value;
	},
});
