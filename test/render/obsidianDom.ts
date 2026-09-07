/**
 * Obsidian's element helpers, for a browser page that has none.
 *
 * Obsidian installs these on `HTMLElement.prototype` at runtime; they are not
 * part of any DOM a browser ships, so a page without them cannot construct
 * `MobileTools` or `FoldOrderControl` at all. `cls` is a space-separated class
 * list, `text` is textContent, `attr` is setAttribute per key, and every
 * creator appends to the receiver and returns the element.
 *
 * Lives in its own file because two harness pages need it - the strip page and
 * the fold-order page - and a second copy is a second thing to keep faithful.
 * None of these decides a width; `setText` is the only one whose output any
 * measurement reads.
 */

export interface ElOpts {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
}

export function installObsidianDom(): void {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	const make = (parent: HTMLElement, tag: string, o: ElOpts = {}): HTMLElement => {
		const el = document.createElement(tag);
		if (o.cls) for (const c of o.cls.split(/\s+/).filter(Boolean)) el.classList.add(c);
		if (o.text !== undefined) el.textContent = o.text;
		if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
		parent.appendChild(el);
		return el;
	};
	proto.createEl = function (this: HTMLElement, tag: string, o?: ElOpts): HTMLElement {
		return make(this, tag, o);
	};
	proto.createDiv = function (this: HTMLElement, o?: ElOpts | string): HTMLElement {
		return make(this, "div", typeof o === "string" ? { cls: o } : o);
	};
	proto.createSpan = function (this: HTMLElement, o?: ElOpts | string): HTMLElement {
		return make(this, "span", typeof o === "string" ? { cls: o } : o);
	};
	proto.setText = function (this: HTMLElement, t: string): void {
		this.textContent = t;
	};
	proto.empty = function (this: HTMLElement): void {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	proto.detach = function (this: HTMLElement): void {
		this.remove();
	};
	proto.addClass = function (this: HTMLElement, ...c: string[]): void {
		this.classList.add(...c);
	};
	proto.removeClass = function (this: HTMLElement, ...c: string[]): void {
		this.classList.remove(...c);
	};
	proto.toggleClass = function (this: HTMLElement, c: string | string[], on: boolean): void {
		for (const one of Array.isArray(c) ? c : [c]) this.classList.toggle(one, on);
	};
	proto.setCssStyles = function (this: HTMLElement, styles: Record<string, string>): void {
		Object.assign(this.style, styles);
	};
}
