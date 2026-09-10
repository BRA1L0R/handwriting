import { App, Modal, Notice } from "obsidian";
import {
	FORK_COPY_PLACEHOLDER as COPY,
	ForkAccount,
	ForkDecision,
	ForkHost,
	ForkRecord,
	applyForkDecision,
	describeFork,
	listForks,
} from "./ForkResolution";

/**
 * The list of notes waiting for a decision, and the three ways to answer.
 *
 * EVERY STRING HERE IS ALAN'S AND APPROVED. They live in
 * `FORK_COPY_PLACEHOLDER`, which is where to change one - not here. THE
 * AUTHORITY IS THE MAILBOX, not this comment: the ten words were approved in
 * the entry stamped 2026-09-09 10:04 CDT, and the trailing period was removed
 * from `headline` by the 17:09 CDT ruling the same day. Both are in
 * `queue.md` / `lead-engineer.md`.
 *
 * `ForkCopyApproved.test.ts` pins all ten verbatim and reds if any is
 * reworded, so a change to the wording is a decision that goes back to him
 * rather than an edit.
 *
 * The modal owns no logic. It asks `describeFork` what each side holds and
 * hands the user's choice to `applyForkDecision`; both are executed under test
 * without an app. What is here is the part that needs a screen.
 */
export class ForkResolutionModal extends Modal {
	constructor(
		app: App,
		private readonly host: ForkHost,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();

		const records = listForks();
		const accounts: ForkAccount[] = [];
		for (const r of records) {
			try {
				accounts.push(await describeFork(this.host, r));
			} catch (err) {
				// One unreadable pair must not hide the rest of the list.
				console.error("[handwriting] could not describe a preserved fork", r.pageId, err);
			}
		}
		// Only the ones with something to decide. Adoption preserves a pair on
		// every sync and most are a plain superset; listing those would make
		// this surface the noise the success-silence rule removed.
		const open = accounts.filter((a) => a.needsDecision);

		if (open.length === 0) {
			contentEl.createEl("p", { text: COPY.empty });
			return;
		}

		for (const a of open) this.renderOne(contentEl, a);
	}

	private renderOne(parent: HTMLElement, a: ForkAccount): void {
		const box = parent.createDiv({ cls: "handwriting-fork" });
		box.createEl("h3", { text: a.path });
		box.createEl("p", { text: COPY.headline });

		const side = (label: string, s: ForkAccount["mine"], only: number): void => {
			const line = s.readable
				? `${label}: ${s.strokes} strokes, ${only} not in the other, modified ${new Date(s.mtime).toLocaleString()}`
				: `${label}: ${COPY.unreadable}`;
			box.createEl("p", { text: line });
		};
		side(COPY.mine, a.mine, a.mineOnly);
		side(COPY.theirs, a.theirs, a.theirsOnly);

		const rec = listForks().find((r) => r.pageId === a.pageId);
		if (!rec) return;
		const buttons = box.createDiv({ cls: "handwriting-fork-actions" });
		this.button(buttons, COPY.keepMine, rec, "keep-mine");
		this.button(buttons, COPY.takeTheirs, rec, "take-theirs");
		this.button(buttons, COPY.keepBoth, rec, "keep-both");
	}

	private button(parent: HTMLElement, text: string, rec: ForkRecord, decision: ForkDecision): void {
		const btn = parent.createEl("button", { text });
		btn.addEventListener("click", () => {
			btn.setAttribute("disabled", "true");
			void applyForkDecision(this.host, rec, decision)
				.then((out) => {
					if (out.kind === "refused") {
						new Notice(COPY.refused);
						btn.removeAttribute("disabled");
						return;
					}
					// Re-render from the register rather than mutating the DOM
					// in place: the decision may have left the fork listed
					// (keep both) or removed it, and the list is the truth.
					void this.onOpen();
				})
				.catch((err) => {
					console.error("[handwriting] fork decision failed", rec.pageId, err);
					btn.removeAttribute("disabled");
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
