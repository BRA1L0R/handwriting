import { NotePaper, NOTE_PAPER_KEY } from "../../src/inline/NotePaper";
import { TFile } from "obsidian";
import { installObsidianDom } from "./obsidianDom";

function openPicker(current = "lines", global = "dots") {
	installObsidianDom();
	document.body.innerHTML = "";
	document.body.className = `handwriting-paper-${global}`;
	const opener = document.createElement("button");
	opener.id = "picker-opener";
	opener.textContent = "Paper background";
	document.body.append(opener);
	opener.focus();
	const file = Object.assign(new TFile(), { path: "Notes/Sketch.md", extension: "md" });
	const frontmatter: Record<string, unknown> = { title: "Sketch", "handwriting-page-id": "preserved" };
	if(current !== "default") frontmatter[NOTE_PAPER_KEY] = current;
	let writes = 0;
	const events = new Map<string, (...args: any[]) => void>();
	const paper = new NotePaper({
		workspace: { on: (name: string, cb: (...args: any[]) => void) => events.set(name, cb), onLayoutReady: () => {}, getLeavesOfType: () => [] },
		metadataCache: { on: () => {}, getFileCache: () => ({ frontmatter }) },
		vault: { getAbstractFileByPath: () => file },
		fileManager: { processFrontMatter: async (_file: unknown, edit: (fm: Record<string, unknown>) => void) => { writes++; edit(frontmatter); } },
	} as never, () => {});
	paper.start({ registerEvent: () => {}, register: () => {} } as never);
	let show = () => {};
	const item = { setIcon: () => item, setTitle: () => item, onClick: (fn: () => void) => { show = fn; return item; } };
	events.get("file-menu")!({ addItem: (fn: (item: unknown) => void) => fn(item) }, file);
	show();
	return { read: () => ({ writes, frontmatter: { ...frontmatter }, focus: document.activeElement?.id }) };
}
declare global { interface Window { __paperPicker: ReturnType<typeof openPicker>; openPaperPicker: typeof openPicker; } }
window.openPaperPicker = openPicker;
