export * from "../obsidian-stub";

/** Only the host dialog shell is simulated; the picker and save path are real. */
export class Modal {
	modalEl = document.createElement("div");
	contentEl = document.createElement("div");
	private titleEl = document.createElement("h2");
	constructor(_app: unknown) {
		this.modalEl.className = "modal";
		this.modalEl.setAttribute("role", "dialog");
		this.contentEl.className = "modal-content";
		this.titleEl.className = "modal-title";
		const close = document.createElement("button");
		close.className = "modal-close-button";
		close.textContent = "×";
		close.setAttribute("aria-label", "Close");
		close.addEventListener("click", () => this.close());
		this.modalEl.append(close, this.titleEl, this.contentEl);
	}
	setTitle(title: string) { this.titleEl.textContent = title; }
	open() { document.body.append(this.modalEl); this.onOpen(); }
	close() { this.modalEl.remove(); this.onClose(); }
	onOpen() {}
	onClose() {}
}
