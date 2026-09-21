export * from "./paperPickerObsidian";
/** Existing dialog shell; only the leaf constructor is needed by this UI test. */
export class TextFileView {
	app: any;
	leaf: any;
	constructor(leaf: any) { this.leaf = leaf; this.app = leaf.app; }
}
