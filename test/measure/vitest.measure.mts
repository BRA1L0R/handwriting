import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The pixel-measurement suite, kept OUT of every other run on purpose.
 *
 * `vitest.config.mts` (the gate, `npx vitest run`) includes only
 * `src/**` + '/' + `*.test.ts`, and `vitest.render.mts` only
 * `test/render/**` + '/' + `*.test.ts`. Everything here lives under
 * `test/measure/`, so neither sweeps it up: the gate's counts and timing are
 * untouched and no browser is launched by either.
 *
 * Invoked explicitly:  npx vitest run --config test/measure/vitest.measure.mts
 */
export default defineConfig({
	resolve: {
		// Same reason as both other configs: the `obsidian` package ships
		// types and no runtime entry, so anything importing it dies at
		// resolution.
		alias: {
			obsidian: fileURLToPath(new URL("../obsidian-stub.ts", import.meta.url)),
		},
	},
	test: {
		// Rooted at THIS directory, not the cwd vitest would otherwise use:
		// left to default, `**` + '/' + `*.test.ts` reaches the whole repo and
		// this config runs the gate suite and the render suite as well.
		root: fileURLToPath(new URL(".", import.meta.url)),
		include: ["**/*.test.ts"],
		// Launching a browser, bundling the page, and 128 whole-canvas
		// readbacks all happen inside the first test.
		testTimeout: 600_000,
		hookTimeout: 600_000,
	},
});
