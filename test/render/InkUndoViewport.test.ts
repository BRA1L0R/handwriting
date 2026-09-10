import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
let browser: Browser;
let page: Page;
type Picture={top:number;left:number;selection:unknown;doc:string;applied:string[];ok?:boolean};
const errors:string[]=[];
async function call(method:string,...args:unknown[]):Promise<Picture>{return page.evaluate(({method,args})=>(window as any).inkUndoPage[method](...args),{method,args});}
beforeAll(async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL("./inkUndoPage.ts",import.meta.url))],bundle:true,write:false,format:"iife",platform:"browser",target:"es2022",alias:{obsidian:fileURLToPath(new URL("../obsidian-stub.ts",import.meta.url))}});
 browser=await chromium.launch({headless:true}); page=await browser.newPage(); page.on("pageerror",e=>errors.push(e.message)); await page.setContent("<!doctype html><html><body></body></html>"); await page.addScriptTag({content:bundle.outputFiles[0]!.text});
});
afterAll(async()=>{await browser?.close();});
describe("ink undo keeps the viewport in a real editor",()=>{
 for(const scale of [1,1.5,2])for(const caret of [0,900])for(const operation of ["add","remove","move","replace"]){
  it(`${operation} undo/redo keeps both axes and current selection with caret ${caret} at ${scale}x`,async()=>{
   const before=await call("setup",caret,"ink",operation,scale);
   expect(before.top).toBeGreaterThan(1000);expect(before.left).toBeGreaterThan(100);
   const undone=await call("run","undo"); const redone=await call("run","redo");
   for(const result of [undone,redone]){expect(result.ok).toBe(true);expect(result.top).toBe(before.top);expect(result.left).toBe(before.left);expect(result.selection).toEqual(before.selection);expect(result.doc).toBe(before.doc);}
   expect(undone.applied).toHaveLength(1);expect(redone.applied).toHaveLength(2);expect(redone.applied[1]).toBe(operation);expect(errors).toEqual([]);
  });
 }
 it("the standard Ctrl+Z keymap shares the same stationary undo",async()=>{
  const before=await call("setup",0,"ink");const after=await call("run","keyboard-undo");expect(after.ok).toBe(true);expect(after.top).toBe(before.top);expect(after.left).toBe(before.left);expect(after.selection).toEqual(before.selection);expect(after.applied).toEqual(["remove"]);
 });
 it("an unrelated transaction before measurement preserves the pending snapshot",async()=>{
  const before=await call("setup",0,"ink");const after=await call("run","undo","unrelated");expect(after.top).toBe(before.top);expect(after.left).toBe(before.left);expect(after.selection).toEqual(before.selection);
 });
 it("a later explicit selection wins without clearing the pending viewport snapshot",async()=>{
  const before=await call("setup",0,"ink");const after=await call("run","undo","selection");expect(after.top).toBe(before.top);expect(after.left).toBe(before.left);expect(after.selection).toEqual({ranges:[{anchor:800,head:800}],main:0});
 });
 it("a later text caret scroll supersedes the ink snapshot",async()=>{
  await call("setup",0,"ink");const after=await call("run","undo","text-scroll");expect(after.top).toBeLessThan(100);expect(after.left).toBeLessThan(100);
 });
 for(const kind of ["text","mixed"]){it(`${kind} undo retains normal caret scrolling`,async()=>{
  await call("setup",0,kind);const after=await call("run","undo");expect(after.top).toBeLessThan(100);expect(after.left).toBeLessThan(100);expect(after.applied).toHaveLength(kind==="mixed"?1:0);
 });}
});
