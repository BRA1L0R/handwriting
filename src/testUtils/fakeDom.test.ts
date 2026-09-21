import { describe, expect, it } from "vitest";
import { FakeDoc, FakeEl } from "./fakeDom";

describe("FakeEl: unknown-member throws", () => {
	it("names the member on first access, rather than reading undefined silently", () => {
		const doc = new FakeDoc();
		const el = new FakeEl("div", doc) as unknown as Record<string, unknown>;
		expect(() => el.scrollIntoView).toThrowError("FakeEl: unsupported member scrollIntoView");
	});

	it("does not throw for an implemented member", () => {
		const doc = new FakeDoc();
		const el = new FakeEl("div", doc);
		expect(() => el.addClass("x")).not.toThrow();
		expect(el.classList.contains("x")).toBe(true);
	});

	it("a failing object comparison on a FakeEl reports the mismatch, not an unsupported member", () => {
		const doc = new FakeDoc();
		const a = new FakeEl("div", doc);
		const b = new FakeEl("div", doc);
		a.textContent = "a";
		b.textContent = "b";
		let message = "";
		try {
			expect(a).toEqual(b);
		} catch (e) {
			message = (e as Error).message;
		}
		expect(message, "the comparison must actually fail, or this cell tests nothing").not.toBe("");
		expect(message).toContain("to deeply equal");
		expect(message).not.toContain("FakeEl: unsupported member");
	});
});

describe("FakeEl: querySelector", () => {
	it("answers a tag or .class selector from children, recursively", () => {
		const doc = new FakeDoc();
		const root = new FakeEl("div", doc);
		const mid = root.createDiv({ cls: "mid" });
		const svg = mid.createEl("svg");
		expect(root.querySelector("svg")).toBe(svg);
		expect(root.querySelector(".mid")).toBe(mid);
		expect(root.querySelector(".missing")).toBeNull();
	});

	it("throws on an unsupported selector rather than answering null", () => {
		const doc = new FakeDoc();
		const root = new FakeEl("div", doc);
		root.createDiv({ attr: { id: "x" } });
		expect(() => root.querySelector("#id")).toThrowError("FakeEl: unsupported selector #id");
	});
});
