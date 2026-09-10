import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, openPaperPicker, type Browser } from "./harness";

let browser: Browser;
beforeAll(async () => { browser = await launch(); });
afterAll(async () => { await browser?.close(); });
const qaDirectory = (globalThis as { process?: { env: Record<string,string|undefined> } }).process?.env.TOOLBAR_QA_DIR;

it.each([350,1000])("shows compact real pattern tiles at %ipx", async width => {
	const page=await openPaperPicker(browser,width,"lines","dots",width===1000);
	try {
		expect(await page.locator("input").count()).toBe(0);
		expect(await page.locator(".handwriting-paper-picker-note").innerText()).toBe("Notes/Sketch.md");
		expect(await page.locator(".handwriting-paper-tile").count()).toBe(5);
		expect(await page.locator('[data-choice="default"]').innerText()).toContain("Global");
		expect(await page.locator('[data-choice="default"]').innerText()).toContain("Uses global setting · Dots");
		expect(await page.locator('[aria-pressed="true"]').getAttribute("data-choice")).toBe("lines");
		expect(await page.locator(".handwriting-paper-check").count()).toBe(1);
		const geometry=await page.evaluate(()=>{
			const modal=document.querySelector<HTMLElement>(".handwriting-paper-picker")!;
			const r=modal.getBoundingClientRect();
			return {width:r.width,right:r.right,height:r.height,tiles:Array.from(document.querySelectorAll<HTMLElement>(".handwriting-paper-tile")).map(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height,right:b.right};}),patterns:Array.from(document.querySelectorAll<HTMLElement>(".handwriting-paper-swatch")).map(el=>getComputedStyle(el).backgroundImage)};
		});
		expect(geometry.width).toBeLessThanOrEqual(420);
		expect(geometry.right).toBeLessThanOrEqual(width);
		expect(geometry.height).toBeLessThan(440);
		for(const tile of geometry.tiles) { expect(tile.width).toBeGreaterThanOrEqual(44); expect(tile.height).toBeGreaterThanOrEqual(44); expect(tile.right).toBeLessThanOrEqual(geometry.right); }
		expect(geometry.patterns[0]).toContain("radial-gradient");
		expect(geometry.patterns[1]).toBe("none");
		expect(geometry.patterns[2]).toContain("linear-gradient");
		expect(geometry.patterns[3]?.match(/linear-gradient/g)).toHaveLength(2);
		expect(geometry.patterns[4]).toContain("radial-gradient");
		if(qaDirectory) await page.screenshot({path:`${qaDirectory}/paper-picker-${width}.png`});
	} finally { await page.close(); }
});

it("arrows only focus; Enter saves once to the bound note and restores focus", async () => {
	const page=await openPaperPicker(browser,600);
	try {
		expect(await page.locator(":focus").getAttribute("data-choice")).toBe("lines");
		await page.keyboard.press("ArrowRight");
		expect(await page.locator(":focus").getAttribute("data-choice")).toBe("grid");
		expect((await page.evaluate(()=>window.__paperPicker.read())).writes).toBe(0);
		await page.keyboard.press("Enter");
		const state=await page.evaluate(()=>window.__paperPicker.read());
		expect(state.writes).toBe(1);
		expect(state.frontmatter).toEqual({title:"Sketch","handwriting-page-id":"preserved","handwriting-paper":"grid"});
		expect(state.focus).toBe("picker-opener");
		expect(await page.locator(".handwriting-paper-picker").count()).toBe(0);
	} finally { await page.close(); }
});

it.each(["Escape","Close"])("%s cancels after focus movement without changing metadata", async action => {
	const page=await openPaperPicker(browser,600);
	try {
		await page.keyboard.press("End");
		if(action==="Escape") await page.keyboard.press("Escape"); else await page.getByRole("button",{name:"Close",exact:true}).click();
		const state=await page.evaluate(()=>window.__paperPicker.read());
		expect(state.writes).toBe(0);
		expect(state.frontmatter["handwriting-paper"]).toBe("lines");
		expect(state.focus).toBe("picker-opener");
	} finally { await page.close(); }
});

it("Global removes only the override and detached double clicks cannot save twice", async () => {
	const page=await openPaperPicker(browser,600);
	try {
		await page.evaluate(()=>{const button=document.querySelector<HTMLButtonElement>('[data-choice="default"]')!;button.click();button.click();});
		const state=await page.evaluate(()=>window.__paperPicker.read());
		expect(state.writes).toBe(1);
		expect(state.frontmatter).toEqual({title:"Sketch","handwriting-page-id":"preserved"});
	} finally { await page.close(); }
});

it("keeps choices reachable in a short viewport", async () => {
	const page=await openPaperPicker(browser,350);
	try {
		await page.setViewportSize({width:350,height:320});
		const box=await page.locator(".handwriting-paper-picker").boundingBox();
		expect(box!.height).toBeLessThanOrEqual(296);
		await page.getByRole("button",{name:"Dots",exact:true}).click();
		expect((await page.evaluate(()=>window.__paperPicker.read())).frontmatter["handwriting-paper"]).toBe("dots");
	} finally { await page.close(); }
});
