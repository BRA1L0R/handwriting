declare module "node:path" {
	function isAbsolute(path: string): boolean;
	function join(...paths: string[]): string;
	function resolve(...paths: string[]): string;
}

declare module "node:fs" {
	function writeFileSync(path: string, data: string | Uint8Array, options: { flag: "wx" }): void;
}
