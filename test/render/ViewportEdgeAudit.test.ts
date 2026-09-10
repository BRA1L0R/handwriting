import { beforeAll, afterAll, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import css from "../../styles.css?raw";
let browser:Browser,script:string;
beforeAll(async()=>{const b=await build({entryPoints:[fileURLToPath(new URL("./noteViewportCameraPage.ts",import.meta.url))],bundle:true,write:false,format:"iife",platform:"browser",alias:{obsidian:fileURLToPath(new URL("./iphoneObsidianStub.ts",import.meta.url))}});script=b.outputFiles[0]!.text;browser=await chromium.launch({headless:true});});
afterAll(async()=>{await browser?.close();});
async function mounted(){const p=await browser.newPage({viewport:{width:1400,height:1100}});await p.setContent("<!doctype html><body></body>");await p.addStyleTag({content:css+readFileSync(fileURLToPath(new URL("./noteViewportCamera.css",import.meta.url)),"utf8")});await p.addScriptTag({content:script});return p;}
const call=(p:Page,method:string,...args:unknown[])=>p.evaluate(([method,args])=>(window as any).viewportFixture[method](...args),[method,args] as const);
const edge=(p:Page,method:string,...args:unknown[])=>p.evaluate(([method,args])=>(window as any).edgeAudit[method](...args),[method,args] as const);
function framed(s:any){for(const b of s.ink){expect(b.x).toBeGreaterThanOrEqual(s.viewport.x-.5);expect(b.y).toBeGreaterThanOrEqual(s.viewport.y-.5);expect(b.right).toBeLessThanOrEqual(s.viewport.x+s.viewport.width+.5);expect(b.bottom).toBeLessThanOrEqual(s.viewport.y+s.viewport.height+.5);}}
it("edge audit: tiny Fit resize and upper/lower zoom rejection preserve ink and recover",async()=>{const p=await mounted();try{
 const original=await call(p,"setup","edge");const fitted=await call(p,"fit","edge");expect(fitted.state.zoom).toBeLessThan(.05);
 const resized=await call(p,"resize","edge");expect(resized.viewport.width).toBeCloseTo(580,0);expect(resized.state.zoom).toBe(fitted.state.zoom);
 const refit=await call(p,"fit","edge");framed(refit);expect(refit.state.zoom).toBeLessThan(fitted.state.zoom);
 for(let i=0;i<3;i++){const smaller=await edge(p,"zoom","edge",.5);expect(smaller.accepted).toBe(true);}const beforeRefusal=await call(p,"snap","edge");for(let i=0;i<2;i++){const rejected=await edge(p,"zoom","edge",1e-9);expect(rejected.accepted).toBe(false);expect(rejected.state.zoom).toBe(beforeRefusal.state.zoom);}const upper=await edge(p,"zoom","edge",1e9);expect(upper.state.zoom).toBe(4);expect((await edge(p,"zoom","edge",2)).state.zoom).toBe(4);
 for(let i=0;i<3;i++){await p.getByRole("button",{name:"Reset note zoom to 100%",exact:true}).click();await call(p,"settle");framed(await call(p,"fit","edge"));}
 const end=await call(p,"snap","edge");expect(end.strokes).toEqual(original.strokes);expect(end.writes).toBe(original.writes);expect(end.history).toBe(original.history);
}finally{await p.close();}},20000);
it("edge audit: erase distant outlier then undo/redo changes live Fit bounds",async()=>{const p=await mounted();try{
 const original=await call(p,"setup","history");const fitted=await call(p,"fit","history");const erased=await edge(p,"eraseOutlier","history");expect(erased.strokes).toHaveLength(1);
 const near=await call(p,"fit","history");framed(near);expect(near.state.zoom).toBeGreaterThan(fitted.state.zoom*10);
 const undone=await edge(p,"history","history","undo");expect(undone.accepted).toBe(true);expect(undone.strokes).toEqual(original.strokes);const restored=await call(p,"fit","history");expect(restored.state.zoom).toBe(fitted.state.zoom);framed(restored);
 const redone=await edge(p,"history","history","redo");expect(redone.accepted).toBe(true);expect(redone.strokes).toEqual(erased.strokes);expect((await call(p,"fit","history")).state.zoom).toBe(near.state.zoom);
}finally{await p.close();}});
it.each(["erase","lasso"])("edge audit: held %s refuses Fit until release",async kind=>{const p=await mounted();try{await call(p,"setup","tool");await call(p,"fit","tool");const r=await edge(p,"heldTool","tool",kind);expect(r.before.state.busy).toBe(true);expect(r.result).toBe("busy");expect(r.after.state.zoom).toBe(r.before.state.zoom);expect((await call(p,"fit","tool")).result).toBe("fit");}finally{await p.close();}});
it("edge audit: tiny Fit touch pan stops and pinch retains saved geometry",async()=>{const p=await mounted();try{const original=await call(p,"setup","touch");await call(p,"fit","touch");const r=await edge(p,"tinyTouch","touch");expect(r.before.state.zoom).toBeLessThan(.05);expect(r.panned.scroll.top).toBeGreaterThan(r.before.scroll.top);expect(r.fling).toBe(false);expect(r.pinched.state.zoom).toBeGreaterThan(r.before.state.zoom);expect(r.after.strokes).toEqual(original.strokes);expect(r.after.writes).toBe(original.writes);framed(await call(p,"fit","touch"));}finally{await p.close();}});
it.each(["thick-dot","negative"])("edge audit: supported stored %s geometry",async kind=>{const p=await mounted();try{const original=await call(p,"setup","geometry",kind);expect(original.strokes).toHaveLength(1);expect(original.strokes[0].points).toHaveLength(1);const fitted=await call(p,"fit","geometry");expect(fitted.strokes).toEqual(original.strokes);expect(fitted.writes).toBe(original.writes);if(kind==="thick-dot"){expect(fitted.result).toBe("fit");framed(fitted);}else{expect(fitted.result).toBe("unrepresentable");expect(fitted.state.zoom).toBe(original.state.zoom);expect(fitted.scroll).toEqual(original.scroll);}}finally{await p.close();}});
