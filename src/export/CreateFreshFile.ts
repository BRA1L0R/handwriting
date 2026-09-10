/**
 * Choose a free name and create it, one caller at a time.
 *
 * THE OLD HEADER HERE SAID "racing nobody" AND THAT WAS WRONG, which is
 * why exports lost each other's output. `Vault.create`/`createBinary` is
 * documented as throwing when the path exists (obsidian.d.ts: "@throws
 * Error if file already exists"), and a bounded retry was built on that.
 * But a documented rejection is NOT an atomic reservation: the host checks
 * existence and then writes, two awaits with a gap between them, and the
 * write is overwrite-capable. So two exports starting close together both
 * saw the same name free, both were told their create SUCCEEDED, and the
 * second replaced the first snapshot - measured on the published tag and
 * two later refs, with both notices naming the same destination. Nothing
 * was rejected, so no amount of retrying could have caught it. That is the
 * same shape as the pre-1.4.6 `firstFreePath` then `adapter.write*`
 * pattern this helper was written to end - it moved the gap rather than
 * closing it.
 *
 * The gap is closed by holding a turn instead: one caller runs from BEFORE
 * it chooses a name until it has created the file or finally failed, so no
 * second caller can be handed a name the first is about to occupy. The
 * choice has to be inside the turn - locking only the create would leave
 * two callers holding the same name and take the defect nowhere.
 *
 * WHAT THIS DOES NOT COVER, and it is worth being exact because the old
 * header's over-claim is what let this run: the guarantee is between
 * callers sharing THIS module instance in THIS process. Another process,
 * another device, a sync client, or a second copy of the plugin can still
 * take a destination between the host's existence check and its write.
 * Callers that create files without coming through here are not covered at
 * all.
 *
 * `choose` is asked again on every attempt (not just once, memoized) because
 * the reason for the retry - somebody else just took the name `choose` is
 * about to hand back - is precisely what makes re-asking necessary.
 *
 * On the "already exists" detection: `create` was left free to throw ANY
 * error rather than being matched against Obsidian's message text. The real
 * Vault's error is documented only as "Error if file already exists" with no
 * message contract, and the vitest stub (test/obsidian-stub.ts) does not
 * model `vault.create` at all, so there is nothing here to pattern-match
 * against with any confidence. Retrying on any create failure (short of the
 * last attempt, where it rethrows) costs nothing extra in the common case -
 * a non-existence error is not expected to become creatable by choosing a
 * different name, so it will keep failing until the bound is spent and then
 * surface exactly as it would have on the first try.
 *
 * The price of that is real and was weighed (1.4.6-design.md §5k/e): a
 * read-only vault, a full disk, a sync provider holding the folder - none of
 * those are collisions, and each spends all eight `choose`/`create` rounds
 * before the user is told anything. Eight rounds of two awaits is not a wait
 * anybody notices, and the alternative is matching error text that has no
 * contract, so the cost stays.
 */
/**
 * The tail of the turn queue: module-wide, because the point is that every
 * caller of this helper in this process shares one. It is deliberately kept
 * settled-and-never-rejected - each turn's outcome is delivered to its own
 * caller, and the tail only carries "the previous turn is over", so one
 * failed export cannot poison or bypass the ones queued behind it.
 */
let turn: Promise<void> = Promise.resolve();

export async function createFreshFile<T>(
	choose: () => Promise<string>,
	create: (path: string) => Promise<T>,
	attempts = 8
): Promise<{ path: string; result: T }> {
	// The whole turn: choose, create, and every retry between them. `choose`
	// is still asked again on each attempt - the reason for a retry is that
	// somebody took the name, and now that somebody can only be outside this
	// process.
	const run = async (): Promise<{ path: string; result: T }> => {
		for (let attempt = 1; ; attempt++) {
			const path = await choose();
			try {
				const result = await create(path);
				return { path, result };
			} catch (error) {
				if (attempt >= attempts) throw error;
			}
		}
	};
	// Admission order is fixed HERE, synchronously, before this function ever
	// awaits - so callers are served in the order they arrived rather than in
	// whatever order their first await happens to resolve.
	const mine = turn.then(run, run);
	// The tail advances on success OR failure, and swallows both: the caller
	// below still gets the original error from `mine`.
	turn = mine.then(
		() => undefined,
		() => undefined
	);
	return mine;
}
