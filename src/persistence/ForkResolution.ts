import { PageData, parsePage } from "../model/PageData";
import { recoverExactPage } from "./PageStore";

/**
 * WHAT THE USER DOES ABOUT A FORK, once the store has preserved both sides.
 *
 * Adoption already keeps both revisions - `prepareExternalAdoption` writes the
 * outgoing and incoming artifacts before the incoming becomes the live page,
 * and `adoptExternal` hands their paths back on its result. Nothing then tells
 * the user, and nothing can: both artifacts live in the ink folder, which
 * Obsidian will not browse. Preservation without resolution is a safe dead
 * end, and this module is the resolution half.
 *
 * IT IS NOT A MERGE. Ruled at 14:15 that an honest user-facing
 * fork-resolution decision satisfies convergence and that automatic union is
 * not required; the union design was rejected at 16:35. Nothing here unions,
 * compares geometry, or decides anything on the user's behalf. It reports what
 * each side holds and applies the choice the user makes.
 *
 * NO NEW WRITE PATH, which is the constraint that shapes everything below.
 * Only one of the three decisions writes at all, and it writes through
 * `saveNow` - the same entry point every other save uses. The other two are
 * already true on disk the moment the fork exists, so honouring them means
 * writing nothing. That is stated rather than hidden: see `applyForkDecision`.
 */

/** One preserved fork, as `adoptExternal` reported it. */
export interface ForkRecord {
	readonly pageId: string;
	/** The note this page belongs to, for showing a person something they know. */
	readonly path: string;
	/** This device's revision at the moment the other one arrived. */
	readonly outgoingPath: string;
	/** The revision that arrived and became the live page. */
	readonly incomingPath: string;
	readonly at: number;
}

/** What one side of a fork holds, or why it cannot be read. */
export interface ForkSide {
	readonly path: string;
	readonly strokes: number;
	readonly mtime: number;
	/**
	 * False when the artifact is gone, unreadable, or does not parse. The count
	 * is then meaningless and must not be shown as if it were a fact.
	 */
	readonly readable: boolean;
}

/** Enough to choose between two revisions, and nothing more. */
export interface ForkAccount {
	readonly pageId: string;
	readonly path: string;
	readonly at: number;
	/** This device's revision - the one that was displaced. */
	readonly mine: ForkSide;
	/** The other device's revision - the one now on screen. */
	readonly theirs: ForkSide;
	/** Stroke ids this device had that the arriving revision does not. */
	readonly mineOnly: number;
	/** Stroke ids the arriving revision brought that this device did not have. */
	readonly theirsOnly: number;
	/**
	 * Whether there is anything to decide.
	 *
	 * ADOPTION PRESERVES A PAIR EVERY TIME, including the ordinary case where
	 * the other device simply drew more and this one drew nothing - and there
	 * the incoming is a superset, adopting is plainly right, and a question
	 * would be noise on every sync. That is the case the success-silence rule
	 * (`d50534a`) exists for and this must not undo it. Only a revision holding
	 * something the other does not is a fork a person needs to answer.
	 *
	 * False when either side is unreadable: nothing can be claimed about a
	 * count that could not be taken.
	 */
	readonly needsDecision: boolean;
}

export type ForkDecision = "keep-mine" | "take-theirs" | "keep-both";

export interface ForkOutcome {
	readonly kind: "applied" | "refused";
	/** True only when the decision actually wrote the live page. */
	readonly wrote: boolean;
	/** True when the fork stays listed afterwards, so it can be reached again. */
	readonly stillListed: boolean;
	readonly why?: string;
}

/**
 * The I/O this module needs, injected rather than imported, so the decision
 * logic can be executed in a test without a vault.
 */
export interface ForkHost {
	read(path: string): Promise<string | null>;
	stat(path: string): Promise<{ mtime: number } | null>;
	saveNow(pageId: string, data: PageData): Promise<void>;
	/** Filenames in the ink folder. Absent hosts simply cannot scan. */
	list?(folder: string): Promise<string[]>;
}

/**
 * `<pageId>.conflict-external-<token>-outgoing.json`, and the incoming twin.
 * The shape `writeAdoptionPair` produces (`PageStore.ts`), and the only thing
 * on disk that identifies a preserved pair - there is no index, no manifest
 * and no persisted register anywhere in the plugin.
 */
const ARTIFACT = /^(.+)\.conflict-external-(.+)-(outgoing|incoming)\.json$/;

/**
 * Find preserved pairs by looking, because nothing else can find them.
 *
 * THE REGISTER ABOVE IS PER-SESSION and a fork outlives the session that made
 * it. There is no enumeration path anywhere in the plugin to fall back on:
 * `preservedAdoptions` is a private in-memory map for pair reuse, and every
 * existing folder sweep skips these files on purpose - `isLiveSidecarName`
 * excludes anything containing `.conflict-`. So without this scan the surface
 * would only ever show a fork to the one session that happened to be running
 * when it occurred, which for a sync that lands overnight is nobody.
 *
 * Read-only: it lists and pairs, and writes nothing. Pairs missing a leg are
 * skipped - one artifact alone is not a decision anyone can be offered.
 */
export async function scanForForks(host: ForkHost, folder: string): Promise<ForkRecord[]> {
	if (!host.list) return [];
	let names: string[];
	try {
		names = await host.list(folder);
	} catch {
		return [];
	}
	const pairs = new Map<string, { pageId: string; outgoing?: string; incoming?: string }>();
	for (const name of names) {
		const base = name.slice(name.lastIndexOf("/") + 1);
		const m = ARTIFACT.exec(base);
		if (!m) continue;
		const [, pageId, token, leg] = m;
		const key = `${pageId}::${token}`;
		const entry = pairs.get(key) ?? { pageId: pageId! };
		if (leg === "outgoing") entry.outgoing = `${folder}/${base}`;
		else entry.incoming = `${folder}/${base}`;
		pairs.set(key, entry);
	}
	const out: ForkRecord[] = [];
	for (const e of pairs.values()) {
		if (!e.outgoing || !e.incoming) continue;
		const st = await host.stat(e.outgoing).catch(() => null);
		out.push({
			pageId: e.pageId,
			// THE NOTE PATH IS NOT RECOVERABLE FROM THE FILENAME - the artifact
			// is named for the page id and nothing else. A fork registered live
			// this session carries the real path; a scanned one falls back to
			// the id, which is at least stable and searchable. Turning an id
			// back into a note is the store's job and is not this slice's.
			path: e.pageId,
			outgoingPath: e.outgoing,
			incomingPath: e.incoming,
			at: st?.mtime ?? 0,
		});
	}
	return out;
}

/**
 * Merge scanned pairs into the register, without displacing a live record.
 *
 * A record made this session knows the note path; a scanned one only knows the
 * id. Where both exist the live one wins.
 */
export async function refreshForks(host: ForkHost, folder: string): Promise<void> {
	for (const found of await scanForForks(host, folder)) {
		if (!forks.has(found.pageId)) forks.set(found.pageId, found);
	}
}

// ---- the register -----------------------------------------------------------

/**
 * Forks this session has seen, newest wins per page.
 *
 * In memory on purpose. A fork is only actionable while the artifacts it names
 * are still on disk, and persisting the list would mean a second thing to keep
 * true about files this module does not own. A restart loses the list, not the
 * ink: both artifacts survive, and the next adoption on that page re-registers.
 */
const forks = new Map<string, ForkRecord>();

/** Record a fork the store just preserved. Newest per page replaces older. */
export function recordFork(rec: ForkRecord): void {
	forks.set(rec.pageId, rec);
}

/** Every unresolved fork, newest first. */
export function listForks(): ForkRecord[] {
	return [...forks.values()].sort((a, b) => b.at - a.at);
}

/** Drop one, once the user has decided about it. */
export function forgetFork(pageId: string): void {
	forks.delete(pageId);
}

/** Test seam, and the teardown path. */
export function resetForks(): void {
	forks.clear();
}

// ---- describing -------------------------------------------------------------

/**
 * The fork an adoption produced, or null when it produced none.
 *
 * Pure, and separated from the poll wiring so the boundary can be executed:
 * an adoption that was held, was unavailable, or came back without both
 * artifacts registers nothing at all.
 */
export function forkFromAdoption(
	pageId: string | null,
	path: string,
	result: { outcome: string; outgoingPath?: string; incomingPath?: string },
	at: number
): ForkRecord | null {
	if (!pageId) return null;
	if (result.outcome !== "adopted") return null;
	if (!result.outgoingPath || !result.incomingPath) return null;
	return { pageId, path, outgoingPath: result.outgoingPath, incomingPath: result.incomingPath, at };
}

async function idsOf(host: ForkHost, pageId: string, path: string): Promise<Set<string> | null> {
	let text: string | null = null;
	try {
		text = await host.read(path);
	} catch {
		return null;
	}
	if (text === null) return null;
	const parsed = parsePage(text, pageId);
	if (parsed.damaged) return null;
	return new Set(parsed.data.strokes.map((s) => s.id));
}

async function sideOf(host: ForkHost, pageId: string, path: string): Promise<ForkSide> {
	const st = await host.stat(path).catch(() => null);
	let text: string | null = null;
	try {
		text = await host.read(path);
	} catch {
		text = null;
	}
	if (text === null) return { path, strokes: 0, mtime: st?.mtime ?? 0, readable: false };
	const parsed = parsePage(text, pageId);
	// `damaged` means the bytes did not come back whole, so the stroke count is
	// whatever survived rather than what the file holds. Reporting it as a
	// count would be the lie this whole surface exists to stop telling.
	if (parsed.damaged) return { path, strokes: 0, mtime: st?.mtime ?? 0, readable: false };
	return { path, strokes: parsed.data.strokes.length, mtime: st?.mtime ?? 0, readable: true };
}

/**
 * What each side of a fork holds. Reads both artifacts; changes nothing.
 */
export async function describeFork(host: ForkHost, rec: ForkRecord): Promise<ForkAccount> {
	const [mine, theirs, mineIds, theirsIds] = await Promise.all([
		sideOf(host, rec.pageId, rec.outgoingPath),
		sideOf(host, rec.pageId, rec.incomingPath),
		idsOf(host, rec.pageId, rec.outgoingPath),
		idsOf(host, rec.pageId, rec.incomingPath),
	]);
	const both = mineIds !== null && theirsIds !== null;
	const mineOnly = both ? [...mineIds].filter((id) => !theirsIds.has(id)).length : 0;
	const theirsOnly = both ? [...theirsIds].filter((id) => !mineIds.has(id)).length : 0;
	return {
		pageId: rec.pageId,
		path: rec.path,
		at: rec.at,
		mine,
		theirs,
		mineOnly,
		theirsOnly,
		needsDecision: both && mineOnly > 0,
	};
}

// ---- deciding ---------------------------------------------------------------

/**
 * Apply the user's decision.
 *
 * ONLY `keep-mine` WRITES, and it writes through `saveNow` like every other
 * save in the plugin. The other two are already the state of the disk:
 * `take-theirs` is what adoption did, and `keep-both` is what adoption left
 * behind. Honouring them by writing nothing is not a shortcut - a write there
 * would be a change the user did not ask for.
 *
 * NOTHING IS EVER DELETED. Both artifacts stay where they are under every
 * decision, so "take the other" cannot destroy this device's revision and a
 * decision made in error is recoverable by making the other one.
 *
 * The difference between `take-theirs` and `keep-both` is therefore not on
 * disk - it is whether the fork stays reachable afterwards. `keep-both` keeps
 * it listed so the person can come back to it; `take-theirs` is them saying
 * they are finished with it. That is a real difference in the surface and NOT
 * a difference in the files, and the handback says so rather than implying the
 * three decisions are three outcomes.
 */
export async function applyForkDecision(
	host: ForkHost,
	rec: ForkRecord,
	decision: ForkDecision
): Promise<ForkOutcome> {
	if (decision === "keep-both") {
		return { kind: "applied", wrote: false, stillListed: true };
	}
	if (decision === "take-theirs") {
		forgetFork(rec.pageId);
		return { kind: "applied", wrote: false, stillListed: false };
	}

	// keep-mine: put this device's preserved revision back as the live page.
	let text: string | null = null;
	try {
		text = await host.read(rec.outgoingPath);
	} catch {
		text = null;
	}
	if (text === null) {
		// The artifact is gone. Refuse rather than write something else, and
		// keep the fork listed: the other side is still there and still a
		// choice the user can make.
		return { kind: "refused", wrote: false, stillListed: true, why: "unreadable" };
	}
	const parsed = parsePage(text, rec.pageId);
	if (parsed.damaged) {
		// Fail closed, the store's own rule: a damaged parse hands back a
		// placeholder, and writing it would overwrite the live page with less
		// than either side actually holds.
		return { kind: "refused", wrote: false, stillListed: true, why: "damaged" };
	}
	// THE TWO ARTIFACTS ARE NOT THE SAME KIND OF OBJECT, so restoring is not a
	// symmetric action. The incoming leg is the other device's bytes verbatim;
	// the OUTGOING leg is a valid sidecar that additionally nests a whole
	// second copy of the page under `EXACT_OUTGOING_KEY`, so a recovery tool
	// can read back the unrounded capture. Unknown top-level keys ride through
	// `parsePage` by design, so writing `parsed.data` straight back would put
	// that nested copy into the user's live sidecar permanently - roughly
	// doubling it, for ever, silently. `recoverExactPage` is the reader the
	// store wrote for exactly this: it returns the nested capture when there is
	// one and the ordinary page otherwise, and the capture does not carry the
	// key itself.
	await host.saveNow(rec.pageId, recoverExactPage(parsed.data));
	forgetFork(rec.pageId);
	return { kind: "applied", wrote: true, stillListed: false };
}

// ---- copy -------------------------------------------------------------------

/**
 * EVERY USER-FACING STRING THIS SURFACE SHOWS, IN ONE PLACE. ALL TEN ARE NOW
 * ALAN'S OWN WORDS, APPROVED 2026-09-09.
 *
 * He wrote them live from a rendered presentation of the screen; nothing here
 * is not this comment's to change. THE AUTHORITY IS THE RECORDED DECISION,
 * "2026-09-09 10:04 CDT ... ALL TEN FORK-SCREEN STRINGS ARE APPROVED". Read it
 * there before changing any string below.
 *
 * NEW: `commandName`, `empty`, `keepMine`, `refused`. KEPT AS DRAFTED:
 * `headline`, `unreadable`, `takeTheirs`, `keepBoth`.
 *
 * `headline` HAS A TRAILING PERIOD AND THE WHOLE ARC MATTERS, because two
 * entries on the record say the opposite of the state below.
 *
 * It shipped with one, and that period was NEVER ALAN'S: he typed the sentence
 * bare and it was punctuated when this constant was formed. When the two forms
 * were put to him one character apart, the perioded one was labelled as his -
 * *"you werent clear which one was mine"* - and he then ruled *"get the periods
 * OUT"* / *"GET EM OUT"* (2026-09-09 17:09 CDT). It came off.
 *
 * THEN HE PUT IT BACK THE SAME DAY, and that is the state below. Verbatim:
 * *"ehhhhhhhhhhhhhhhh we hsould be consistent, put a period back at end"*
 * (2026-09-09 17:14 CDT). The reason bounds it: other messages on the same
 * delete-all command always carried trailing periods and had never been shown
 * to him, so he chose consistency in the direction of RESTORING rather than
 * stripping more. The authority is that 17:14 decision, not this comment.
 *
 * DO NOT STRIP IT AGAIN ON THE STRENGTH OF THE 17:09 ENTRY. It is still on the
 * record, it still says the opposite, and it was correctly executed at the
 * time - this paragraph is the only thing standing between a later reader and
 * a third round trip.
 *
 * AND ONE RULED SENTENCE GOES THE OTHER WAY, deliberately: the ink-trash
 * restore line stays BARE, because it ends in a file path where a trailing
 * period reads as part of the path (2026-09-09 17:21 CDT, *"leave that last
 * one bare"*). Not every approved string ends in a period, and a sweep that
 * assumed so would be wrong. `ForkCopyApproved.test.ts` pins the punctuated
 * set and that bare one separately, by name.
 *
 * `commandName` CARRIES NO "Handwriting:" PREFIX ON PURPOSE. He wrote one, and
 * it comes out because Obsidian prefixes the plugin name itself - it would
 * have read "Handwriting: Handwriting: ..." - and no other command in this
 * plugin carries one. He also removed the word "note" himself on learning the
 * screen covers PDFs too: preservation runs on the pdf surface, `scanForForks`
 * matches on filename and never opens the file, so a PDF fork lists beside a
 * note fork. Slides has no preservation route and produces none.
 *
 * `mine` AND `theirs` ARE CORRECT AND WERE NEVER CHANGED. It was observed that
 * the revision labelled "The other device" is the one currently on screen, and
 * relayed as "the labels read backwards". They do not. Alan settled it in one
 * line - "PALADIN IS THE OTHER DEVICE" - he reads this on Orion, and the other
 * device is the other device. Do not swap them.
 *
 * THE MARKER IS NOW GONE FROM EVERY STRING, AND IT IS ENFORCED RATHER THAN
 * PROMISED. The version of this docstring that shipped before said the marker
 * existed "so an unapproved string cannot reach a release build unnoticed" -
 * which was not true of anything that existed: no test asserted it, and the
 * build did not scan for it. `ForkCopyApproved.test.ts` is that gate now, over
 * this object and over every shipped source file.
 */
export const FORK_COPY_PLACEHOLDER = {
	/** Command palette entry that opens the list. */
	commandName: "fix ink de-sync",
	/** Shown when the list is empty. */
	empty: "no ink de-sync to fix",
	/**
	 * One line naming what happened, per fork.
	 *
	 * TRAILING PERIOD, RESTORED BY ALAN - see the header. It is the only string
	 * in this object that has one, and the only one that ever did.
	 */
	headline: "This note was edited on two devices and both versions were kept.",
	/** Label for this device's preserved revision. */
	mine: "This device",
	/** Label for the revision that arrived. */
	theirs: "The other device",
	/** Shown against a side whose artifact cannot be read. */
	unreadable: "cannot be read",
	/** The three decisions. */
	keepMine: "Keep this device's ink",
	takeTheirs: "Take the other",
	keepBoth: "Keep both",
	/** After a refused keep-mine. */
	refused: "Could not keep this device's ink",
} as const;
