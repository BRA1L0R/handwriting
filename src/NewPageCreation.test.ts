/**
 * `newPage` (the "new handwriting page" command) STILL BYPASSES THE TURN.
 *
 * `concurrent-export-preservation` (14d772f) and `route the three direct
 * create sites` (a7fc15a) closed the naming race for every export path and
 * for `snipNote`/`snipPdf`/`DiagnosticTextModal.saveToVault`. `newPage` was
 * never touched: it still calls `firstFreePath` and then `vault.create` as
 * two separate awaits with a gap between them, so two "new page" invocations
 * close together can choose the SAME free name and the second create replaces
 * the first - the exact shape the other sites were fixed for.
 *
 * WHAT IS REAL HERE. The `newPage`, `firstFreePath` and `pathFor` bodies are
 * lifted out of `main.ts` source and transpiled, so the code under test is the
 * shipped code rather than a restatement of it. The helper is the REAL
 * `createFreshFile` - reached through a transparent wrapper that only records
 * entry - so nothing about queue ordering is re-implemented here.
 *
 * THE HOST FIXTURE IS DELIBERATELY NOT ATOMIC. It awaits an existence check
 * and then awaits an overwrite-capable write, which is what Obsidian was
 * measured doing. Making create an exclusive insertion would manufacture a
 * rejection the real host never produces and would prove the opposite of what
 * is claimed here: nothing was ever rejected, which is why a bounded retry
 * could not have caught this.
 *
 * WHAT THIS DOES NOT COVER: another process, another device, a sync client,
 * or a second copy of the plugin. The guarantee is between in-process callers
 * sharing this module instance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const notices = vi.hoisted(() => ({ messages: [] as string[] }));
vi.mock("obsidian", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		Notice: class {
			constructor(message: string) {
				notices.messages.push(message);
			}
		},
	};
});

import { transformSync } from "esbuild";
import { Notice, normalizePath } from "obsidian";
import mainSource from "./main.ts?raw";
import { createFreshFile } from "./export/CreateFreshFile";
import { newPageMarkdown } from "./model/MarkdownPage";
import { HANDWRITING_PAGE_VIEW_TYPE } from "./view/HandwritingPageView";

const source = mainSource.replace(/\r\n/g, "\n");

/** A source slice, with both ends proven present and unique. */
function slice(startMarker: string, endMarker: string): string {
	expect(source.split(startMarker), `start marker not unique: ${startMarker}`).toHaveLength(2);
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	expect(end, `end marker missing after: ${startMarker}`).toBeGreaterThan(start);
	return source.slice(start, end + endMarker.length);
}

const FIRST_FREE_PATH_BLOCK = slice(
	"\tprivate async firstFreePath(candidate: (n: number) => string): Promise<string> {",
	"\n\t}"
);
const PATH_FOR_BLOCK = slice(
	"\tprivate pathFor(folder: string, name: string): string {",
	"\n\t}"
);
const NEW_PAGE_BLOCK = slice("\tprivate async newPage(): Promise<void> {", "\n\t}");

// Fail closed if the shapes these tests assume ever move. These hold both
// before and after the routing fix, unlike the routing itself.
expect(FIRST_FREE_PATH_BLOCK).toContain("adapter.exists");
expect(NEW_PAGE_BLOCK).toContain('"Handwriting page"');
expect(NEW_PAGE_BLOCK).toContain("newPageMarkdown(pageId)");
expect(NEW_PAGE_BLOCK).toContain("firstFreePath(");

const js = (code: string): string => transformSync(code, { loader: "ts", target: "es2022" }).code;

type Deps = Record<string, unknown>;
const build = (code: string, deps: Deps): unknown => {
	const names = Object.keys(deps);
	return new Function(...names, js(code))(...names.map((n) => deps[n]));
};

type PageHost = {
	firstFreePath(candidate: (n: number) => string): Promise<string>;
	pathFor(folder: string, name: string): string;
	newPage(): Promise<void>;
};

/** The three real method bodies on one prototype, so `this.firstFreePath`/`this.pathFor` are the real ones. */
const holderFor = (deps: Deps): { prototype: PageHost } =>
	build(`return class { ${FIRST_FREE_PATH_BLOCK}\n${PATH_FOR_BLOCK}\n${NEW_PAGE_BLOCK} }`, deps) as {
		prototype: PageHost;
	};

const deferred = <T,>() => {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	promise.catch(() => {});
	return { promise, resolve, reject };
};

const settleMicrotasks = async (rounds = 30): Promise<void> => {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
};

const errors: string[] = [];
const quietConsole = {
	error: (...args: unknown[]) => void errors.push(args.map(String).join(" ")),
	warn: () => {},
	log: () => {},
};

/** Two distinct, independently known page ids, so two snapshots can never be confused. */
const PAGE_ID_A = "page-id-AAAA";
const PAGE_ID_B = "page-id-BBBB";

/**
 * An overwrite-capable vault, faithful to the observed host contract: an
 * awaited existence check, then an awaited write that will happily replace.
 * Every view is tagged, so which caller reached a name scan or a create is
 * recorded from the HOST side too - the unrouted baseline never enters the
 * helper at all, and a test that waited for its helper admission would wait
 * forever and prove nothing.
 */
function makeHost(seed: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(seed));
	const writes: string[] = [];
	const createEntries: string[] = [];
	const holds = new Map<string, Promise<unknown>>();
	const failures = new Map<string, string>();

	const view = (tag: string, log: string[], opts: { existsThrows?: boolean } = {}) => {
		const create = async (path: string, data: unknown): Promise<{ path: string }> => {
			log.push(`${tag}:create`);
			createEntries.push(`${tag}:${path}`);
			// exists first...
			await Promise.resolve();
			files.has(path);
			// ...then the write, which is where a held turn is observed.
			const held = holds.get(tag);
			if (held) {
				holds.delete(tag);
				await held;
			}
			const failure = failures.get(tag);
			if (failure) throw new Error(failure);
			writes.push(path);
			files.set(path, data as string);
			return { path };
		};
		return {
			adapter: {
				exists: async (path: string): Promise<boolean> => {
					log.push(`${tag}:exists`);
					await Promise.resolve();
					if (opts.existsThrows) throw new Error("the vault could not be read");
					return files.has(path);
				},
			},
			create,
		};
	};

	return {
		files,
		writes,
		createEntries,
		view,
		holdFor(tag: string, p: Promise<unknown>) {
			holds.set(tag, p);
		},
		failFor(tag: string, message: string) {
			failures.set(tag, message);
		},
	};
}

/**
 * A transparent forwarding wrapper: it records entry into choose and create
 * and then delegates to the ONE real helper, so every caller here still
 * shares a single module-wide queue. It never decides anything, and nothing
 * in these tests is unlocked by it.
 */
function watchedHelper(tag: string, log: string[]) {
	return <T,>(
		choose: () => Promise<string>,
		create: (path: string) => Promise<T>,
		attempts?: number
	): Promise<{ path: string; result: T }> =>
		createFreshFile(
			async () => {
				log.push(`${tag}:choose`);
				return choose();
			},
			async (p) => {
				log.push(`${tag}:callback`);
				return create(p);
			},
			attempts
		);
}

type PageOpts = {
	tag: string;
	log: string[];
	host: ReturnType<typeof makeHost>;
	pageId: string;
	existsThrows?: boolean;
	viewStates?: Map<string, { type: string; state: { file: string }; active: boolean }>;
};

function pageInstance(o: PageOpts): PageHost {
	const inst = Object.create(
		holderFor({
			Notice,
			normalizePath,
			console: quietConsole,
			createFreshFile: watchedHelper(o.tag, o.log),
			newPageId: () => o.pageId,
			newPageMarkdown,
			HANDWRITING_PAGE_VIEW_TYPE,
		}).prototype
	) as PageHost;
	(inst as unknown as { app: unknown }).app = {
		workspace: {
			// No active file: newPage falls back to the vault root, which is
			// where the "Handwriting page[.md| N.md]" names this file asserts
			// against are rooted.
			getActiveFile: () => null,
			getLeaf: (_open: boolean) => ({
				setViewState: async (state: { type: string; state: { file: string }; active: boolean }) => {
					o.log.push(`${o.tag}:setViewState`);
					o.viewStates?.set(o.tag, state);
				},
			}),
			revealLeaf: async () => void o.log.push(`${o.tag}:revealLeaf`),
		},
		vault: o.host.view(o.tag, o.log, { existsThrows: o.existsThrows }),
	};
	return inst;
}

const fireNewPage = (o: PageOpts): Promise<void> => pageInstance(o).newPage();

afterEach(() => {
	notices.messages.length = 0;
	errors.length = 0;
});

describe("two overlapping new-page invocations keep both pages", () => {
	it("B cannot choose a name or create while A is held, and both pages land at distinct paths with their own content", async () => {
		const log: string[] = [];
		const host = makeHost({ "Untouched.md": "keep me" });
		const before = new Map(host.files);
		const viewStates = new Map<string, { type: string; state: { file: string }; active: boolean }>();

		const held = deferred<void>();
		host.holdFor("A", held.promise);

		const a = fireNewPage({ tag: "A", log, host, pageId: PAGE_ID_A, viewStates });
		a.catch(() => {});
		await settleMicrotasks();
		expect(log.filter((l) => l.startsWith("A:")).length, "A never reached the host at all").toBeGreaterThan(0);

		const b = fireNewPage({ tag: "B", log, host, pageId: PAGE_ID_B, viewStates });
		b.catch(() => {});
		try {
			// THE DEFECT: B choosing or creating here means it was handed the
			// name A is about to occupy, and the overwrite-capable write lets
			// both think they won.
			await settleMicrotasks();
			expect(
				log.filter((l) => l.startsWith("B:")),
				`B chose a name or created while A was held: ${JSON.stringify(log)}`
			).toEqual([]);
		} finally {
			// Released unconditionally, never as a reward for B behaving.
			held.resolve();
		}

		await Promise.all([a, b]);
		await settleMicrotasks();

		expect(new Set(host.writes).size, `both pages wrote to: ${JSON.stringify(host.writes)}`).toBe(2);
		expect(new Set(host.writes)).toEqual(new Set(["Handwriting page.md", "Handwriting page 2.md"]));
		// A was admitted first (its turn was already running when B fired), so
		// the assignment is deterministic, not just "two of the two".
		expect(host.files.get("Handwriting page.md")).toBe(newPageMarkdown(PAGE_ID_A));
		expect(host.files.get("Handwriting page 2.md")).toBe(newPageMarkdown(PAGE_ID_B));
		for (const [path, bytes] of before) {
			expect(host.files.get(path), `pre-existing ${path} was overwritten`).toBe(bytes);
		}
		expect(viewStates.get("A")?.state.file).toBe("Handwriting page.md");
		expect(viewStates.get("B")?.state.file).toBe("Handwriting page 2.md");
	});
});

describe("serial control: what already worked keeps working", () => {
	it("two sequential calls count up and keep both pages with their own content", async () => {
		const log: string[] = [];
		const host = makeHost();
		await fireNewPage({ tag: "A", log, host, pageId: PAGE_ID_A });
		await fireNewPage({ tag: "B", log, host, pageId: PAGE_ID_B });
		expect(host.writes).toEqual(["Handwriting page.md", "Handwriting page 2.md"]);
		expect(host.files.get("Handwriting page.md")).toBe(newPageMarkdown(PAGE_ID_A));
		expect(host.files.get("Handwriting page 2.md")).toBe(newPageMarkdown(PAGE_ID_B));
	});
});

describe("a failed create is reported honestly and does not block the next caller", () => {
	it("the create for A rejects exactly once, is reported through the existing catch, and B still keeps its own output", async () => {
		const log: string[] = [];
		const host = makeHost();
		host.failFor("A", "the disk is full");

		const a = fireNewPage({ tag: "A", log, host, pageId: PAGE_ID_A });
		const b = fireNewPage({ tag: "B", log, host, pageId: PAGE_ID_B });
		await Promise.all([a, b]);
		await settleMicrotasks();

		// One create attempt, not eight: this caller always made exactly one
		// attempt, and routing it through the shared turn must not quietly
		// turn that into a retry loop.
		expect(host.createEntries.filter((e) => e.startsWith("A:"))).toHaveLength(1);
		expect(notices.messages).toContain("Handwriting: could not create the page. See the developer console.");
		expect(errors.some((e) => e.includes("[handwriting] could not create page"))).toBe(true);
		// A failed without occupying the name, so B is entitled to it and gets it.
		expect(host.writes).toEqual(["Handwriting page.md"]);
		expect(host.files.get("Handwriting page.md")).toBe(newPageMarkdown(PAGE_ID_B));
	});
});
