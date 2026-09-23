/**
 * Build Handwriting and install its runtime files into an Obsidian vault.
 *
 * Usage:
 *   npm run install:vault -- "/absolute/path/to/My Vault"
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "handwriting";
const ASSETS = ["main.js", "manifest.json", "styles.css"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
	console.error(`Install aborted: ${message}`);
	process.exit(1);
}

function directoryExists(directory) {
	try {
		return statSync(directory).isDirectory();
	} catch {
		return false;
	}
}

function readManifest(file, description) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		fail(`${description} is not valid JSON (${error instanceof Error ? error.message : String(error)}).`);
	}
}

const args = process.argv.slice(2);
if (args.length !== 1) {
	fail('pass exactly one absolute vault path.\nUsage: npm run install:vault -- "/absolute/path/to/My Vault"');
}

const vault = args[0];
if (!path.isAbsolute(vault)) fail(`the vault path must be absolute: ${vault}`);
if (!directoryExists(vault)) fail(`the vault directory does not exist: ${vault}`);

const obsidian = path.join(vault, ".obsidian");
if (!directoryExists(obsidian)) fail(`no .obsidian directory was found in: ${vault}`);

const destination = path.join(obsidian, "plugins", PLUGIN_ID);
const installedManifest = path.join(destination, "manifest.json");
if (existsSync(installedManifest)) {
	const installed = readManifest(installedManifest, `the existing manifest at ${installedManifest}`);
	if (installed.id !== PLUGIN_ID) {
		fail(`the destination contains a different plugin (${JSON.stringify(installed.id)}): ${destination}`);
	}
}

console.log("Handwriting vault install");
console.log(`  Vault:       ${vault}`);
console.log(`  Destination: ${destination}`);
console.log(`  Files:       ${ASSETS.join(", ")}`);
if (directoryExists(destination)) console.log("  Existing installation will be updated; data.json and other files will be preserved.");

const prompt = createInterface({ input: process.stdin, output: process.stdout });
let answer;
try {
	answer = await prompt.question("Build and install Handwriting here? [y/N] ");
} finally {
	prompt.close();
}

if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
	console.log("Install cancelled.");
	process.exit(0);
}

console.log("\nBuilding Handwriting…");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
try {
	execFileSync(npm, ["run", "build"], { cwd: ROOT, stdio: "inherit" });
} catch {
	fail("the build failed; no plugin files were copied.");
}

for (const asset of ASSETS) {
	const source = path.join(ROOT, asset);
	if (!existsSync(source)) fail(`the build did not produce ${source}; no plugin files were copied.`);
}

const builtManifest = readManifest(path.join(ROOT, "manifest.json"), "the built manifest");
if (builtManifest.id !== PLUGIN_ID) {
	fail(`the built manifest id is ${JSON.stringify(builtManifest.id)}, expected ${JSON.stringify(PLUGIN_ID)}.`);
}

mkdirSync(destination, { recursive: true });
for (const asset of ASSETS) copyFileSync(path.join(ROOT, asset), path.join(destination, asset));

console.log(`\nInstalled Handwriting ${builtManifest.version ?? ""} into:`);
console.log(`  ${destination}`);
console.log("Restart Obsidian, or reload and re-enable the plugin if Obsidian is already open.");
