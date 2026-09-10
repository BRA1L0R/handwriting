import { describe, expect, it } from "vitest";
import { createFreshFile } from "./CreateFreshFile";

describe("createFreshFile", () => {
	it("creates on the first try", async () => {
		const choices = ["a.svg"];
		let created: string | null = null;
		const { path, result } = await createFreshFile(
			async () => choices.shift()!,
			async (p) => {
				created = p;
				return 42;
			}
		);
		expect(path).toBe("a.svg");
		expect(result).toBe(42);
		expect(created).toBe("a.svg");
	});

	it("retries once when the first create throws and lands on the next chosen name", async () => {
		const choices = ["a.svg", "a-2.svg"];
		const attempts: string[] = [];
		const { path, result } = await createFreshFile(
			async () => choices.shift()!,
			async (p) => {
				attempts.push(p);
				if (p === "a.svg") throw new Error("File already exists.");
				return `made:${p}`;
			}
		);
		expect(attempts).toEqual(["a.svg", "a-2.svg"]);
		expect(path).toBe("a-2.svg");
		expect(result).toBe("made:a-2.svg");
	});

	it("gives up after the bound and rethrows", async () => {
		let n = 0;
		const chosen: string[] = [];
		const failure = new Error("File already exists.");
		await expect(
			createFreshFile(
				async () => {
					n++;
					const p = `f-${n}.svg`;
					chosen.push(p);
					return p;
				},
				async () => {
					throw failure;
				},
				3
			)
		).rejects.toBe(failure);
		// Exactly `attempts` creates were tried, no more, no fewer.
		expect(chosen).toEqual(["f-1.svg", "f-2.svg", "f-3.svg"]);
	});

	it("re-chooses on every attempt rather than reusing the first name", async () => {
		const choices = ["one", "two", "three"];
		const seen: string[] = [];
		await expect(
			createFreshFile(
				async () => choices.shift()!,
				async (p) => {
					seen.push(p);
					throw new Error("nope");
				},
				3
			)
		).rejects.toThrow("nope");
		expect(seen).toEqual(["one", "two", "three"]);
	});

	it("retries on any create failure, not only an already-exists message", async () => {
		const choices = ["x", "y"];
		const { result } = await createFreshFile(
			async () => choices.shift()!,
			async (p) => {
				if (p === "x") throw new Error("EBUSY: resource locked");
				return p;
			}
		);
		expect(result).toBe("y");
	});
});

/**
 * ONE EXPORT AT A TIME, from before it picks a name until it has the file.
 *
 * Two overlapping exports used to choose the SAME free name and both get a
 * successful create, because the host's create is an awaited existence check
 * followed by an awaited overwrite-capable write - not an atomic reservation.
 * The second write replaced the first snapshot and both notices named the same
 * destination. A bounded retry cannot repair that: nothing was rejected.
 *
 * So the turn has to cover the CHOICE, not just the create. Everything below
 * is about that boundary, and every deferred operation is settled in cleanup
 * so a failing assertion cannot leave the module queue pending for the rest
 * of the file.
 */
describe("createFreshFile serializes a whole turn, choice included", () => {
	const deferred = <T,>() => {
		let resolve!: (v: T) => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		// Nothing here is allowed to become an unhandled rejection just because
		// a test asserted before awaiting it.
		promise.catch(() => {});
		return { promise, resolve, reject };
	};

	/** Let every already-queued microtask run, without pretending a sleep proves anything. */
	const settleMicrotasks = async (rounds = 20): Promise<void> => {
		for (let i = 0; i < rounds; i++) await Promise.resolve();
	};

	it("B does not choose a name while A's create is still in flight", async () => {
		const held = deferred<string>();
		const chose: string[] = [];
		const names = ["a.svg", "a-2.svg"];

		const a = createFreshFile(
			async () => {
				chose.push("A");
				return names.shift()!;
			},
			async () => held.promise
		);
		a.catch(() => {});
		await settleMicrotasks();
		expect(chose).toEqual(["A"]);

		const b = createFreshFile(
			async () => {
				chose.push("B");
				return names.shift()!;
			},
			async (p) => `made:${p}`
		);
		b.catch(() => {});

		try {
			await settleMicrotasks();
			// THE WHOLE DEFECT: if B has chosen by now it chose the same free
			// name A is about to occupy, and the host will let both writes win.
			expect(chose, "B chose a name while A's create was still in flight").toEqual(["A"]);
		} finally {
			// Released unconditionally, never as a reward for B behaving.
			held.resolve("A-done");
		}

		const [ra, rb] = await Promise.all([a, b]);
		expect(ra.path).toBe("a.svg");
		expect(rb.path).toBe("a-2.svg");
		expect(chose).toEqual(["A", "B"]);
	});

	it("three callers keep their admission order and each keeps its own result", async () => {
		const held = deferred<string>();
		const order: string[] = [];
		const call = (tag: string, first: boolean) =>
			createFreshFile(
				async () => {
					order.push(tag);
					return `${tag}.svg`;
				},
				async (p) => {
					if (first) await held.promise;
					return `payload-of-${p}`;
				}
			);

		const a = call("A", true);
		const b = call("B", false);
		const c = call("C", false);
		for (const p of [a, b, c]) p.catch(() => {});
		try {
			await settleMicrotasks();
			expect(order, "a later caller ran ahead of the one holding the turn").toEqual(["A"]);
		} finally {
			held.resolve("go");
		}

		const [ra, rb, rc] = await Promise.all([a, b, c]);
		expect(order).toEqual(["A", "B", "C"]);
		// Each keeps its OWN payload and path - the queue must not swap them.
		expect(ra.result).toBe("payload-of-A.svg");
		expect(rb.result).toBe("payload-of-B.svg");
		expect(rc.result).toBe("payload-of-C.svg");
	});

	it("a retry belongs to the turn that started it: B waits through A's second attempt", async () => {
		const held = deferred<string>();
		const chose: string[] = [];
		let attempt = 0;

		const a = createFreshFile(
			async () => {
				chose.push(`A${++attempt}`);
				return `a-${attempt}.svg`;
			},
			async (p) => {
				if (p === "a-1.svg") throw new Error("File already exists.");
				return held.promise;
			}
		);
		a.catch(() => {});
		const b = createFreshFile(
			async () => {
				chose.push("B");
				return "b.svg";
			},
			async (p) => `made:${p}`
		);
		b.catch(() => {});

		try {
			await settleMicrotasks();
			// A has retried; B still must not have chosen.
			expect(chose, "B entered the turn during A's retry").toEqual(["A1", "A2"]);
		} finally {
			held.resolve("A-done");
		}

		await Promise.all([a, b]);
		expect(chose).toEqual(["A1", "A2", "B"]);
	});

	it("a final create rejection reaches its own caller, and the next one still runs", async () => {
		const boom = new Error("File already exists.");
		const a = createFreshFile(
			async () => "a.svg",
			async () => {
				throw boom;
			},
			2
		);
		a.catch(() => {});
		const b = createFreshFile(async () => "b.svg", async (p) => `made:${p}`);
		b.catch(() => {});

		// The original error identity, not a wrapper.
		await expect(a).rejects.toBe(boom);
		// And one rejected export does not poison the queue behind it.
		await expect(b).resolves.toEqual({ path: "b.svg", result: "made:b.svg" });
	});

	it("a choose that rejects releases the turn, whether it throws sync or async", async () => {
		const asyncBoom = new Error("choose failed");
		const a = createFreshFile(async () => {
			throw asyncBoom;
		}, async (p) => p);
		a.catch(() => {});

		const syncBoom = new Error("choose threw synchronously");
		const b = createFreshFile((() => {
			throw syncBoom;
		}) as unknown as () => Promise<string>, async (p) => p);
		b.catch(() => {});

		const c = createFreshFile(async () => "c.svg", async (p) => `made:${p}`);
		c.catch(() => {});

		await expect(a).rejects.toBe(asyncBoom);
		await expect(b).rejects.toBe(syncBoom);
		// The queue is still usable after two failed turns.
		await expect(c).resolves.toEqual({ path: "c.svg", result: "made:c.svg" });
	});
});
