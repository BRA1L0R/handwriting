import { beforeAll,afterAll,it,expect } from "vitest";
import { build } from "esbuild";
import { chromium,type Browser } from "playwright";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync } from "node:fs";
import css from "../../styles.css?raw";
declare module "node:fs" { export function writeFileSync(path:string,data:string):void; }
declare const process:{env:Record<string,string|undefined>};
let browser:Browser,script:string;
const evidence:unknown[]=[];
const omission=process.env.HW_MOUSE_UNDO_DISABLE_GUARD==="1";
const sensitivity=omission && process.env.HW_MOUSE_UNDO_EXPECT_STABLE!=="1";
beforeAll(async()=>{const b=await build({entryPoints:[fileURLToPath(new URL("./mouseInkUndoPage.ts",import.meta.url))],bundle:true,write:false,format:"iife",platform:"browser",alias:{obsidian:fileURLToPath(new URL("./mouseUndoObsidianStub.ts",import.meta.url))},plugins:process.env.HW_MOUSE_UNDO_DISABLE_GUARD==="1"?[{name:"undo-scroll-sensitivity",setup(b){b.onLoad({filter:/src[\\/]inline[\\/]InkHistory\.ts$/},args=>{let source=readFileSync(args.path,"utf8");const marker="const [tr] = update.transactions;";if(source.split(marker).length!==2)throw Error("guard marker changed");source=source.replace(marker,"return; "+marker);return{contents:source,loader:"ts"};});}}]:[]});script=b.outputFiles[0]!.text;browser=await chromium.launch({headless:true});});
afterAll(async()=>{await browser?.close();if(process.env.HW_MOUSE_UNDO_EVIDENCE)writeFileSync(process.env.HW_MOUSE_UNDO_EVIDENCE,JSON.stringify(evidence,null,2));});
it.each([[1,false],[2,false],[1,true],[2,true]] as const)("real mouse then immediate keyboard undo at%s blur%s",async(scale,blur)=>{
	const page=await browser.newPage({viewport:{width:700,height:540}});
	try{
		await page.setContent("<!doctype html><body style='margin:0'></body>");await page.addStyleTag({content:css});await page.addScriptTag({content:script});
		const before=await page.evaluate(([s,b])=>(window as any).mouseInkUndo.setup(s,b),[scale,blur]);
		await page.mouse.move(120,200);await page.mouse.down();await page.mouse.move(160,220,{steps:4});await page.mouse.up();
		await page.keyboard.press("Control+z");
		await page.evaluate(()=>(window as any).mouseInkUndo.settle());
		const undone=await page.evaluate(()=>(window as any).mouseInkUndo.snap());
		await page.keyboard.press("Control+y");await page.evaluate(()=>(window as any).mouseInkUndo.settle());
		const redone=await page.evaluate(()=>(window as any).mouseInkUndo.snap());
		const trace=await page.evaluate(()=>(window as any).mouseInkUndo.trace);
		const undoTrace=await page.evaluate(()=>(window as any).mouseInkUndo.undoTrace());
		const capture=await page.evaluate(()=>(window as any).mouseInkUndo.capture());
		const drawn=trace.find((s:any)=>s.transactions.some((t:any)=>t.ink.includes("add")));
		evidence.push({scale,blur,before,drawn,undone,redone,trace});
		expect(drawn.strokes).toBe(1);expect(undone.strokes).toBe(0);expect(redone.strokes).toBe(1);
		if(!sensitivity){for(const s of [drawn,undone,redone]){expect(s.top).toBe(before.top);expect(s.left).toBe(before.left);expect(s.selection).toEqual(before.selection);expect(s.focused).toBe(true);expect(s.docLength).toBe(before.docLength);}}
		else expect(undone.top).toBeGreaterThan(6000);
		expect(undoTrace.status).toBe("captured");
		expect(capture.env.undoHistory?.v).toBe(1);
		expect(capture.env.undoHistory?.records.length).toBe(undoTrace.records.length);
		expect(undoTrace.gestures).toBe(2);
		expect(undoTrace.records.some((r:any)=>r.phase==="pre"&&r.kind==="undo")).toBe(true);
		if(!sensitivity){
			expect(undoTrace.records.some((r:any)=>r.phase==="transaction"&&r.transaction?.userEvent==="undo")).toBe(true);
			expect(undoTrace.records.some((r:any)=>r.phase==="transaction"&&r.transaction?.userEvent==="redo")).toBe(true);
		}else expect(undoTrace.records.some((r:any)=>r.phase==="transaction")).toBe(false);
	}finally{await page.close();}
});
it("ordinary text undo still reveals its offscreen caret",async()=>{
	const page=await browser.newPage();try{
		await page.setContent("<!doctype html><body style='margin:0'></body>");await page.addStyleTag({content:css});await page.addScriptTag({content:script});
		const initial=await page.evaluate(()=>(window as any).mouseInkUndo.setup(1));
		const edited=await page.evaluate(()=>(window as any).mouseInkUndo.textControl());
		await page.keyboard.press("Control+z");await page.evaluate(()=>(window as any).mouseInkUndo.settle());
		const undone=await page.evaluate(()=>(window as any).mouseInkUndo.snap());
		const undoTrace=await page.evaluate(()=>(window as any).mouseInkUndo.undoTrace());
		evidence.push({control:"ordinary-text",initial,edited,undone});
		expect(edited.docLength).toBe(initial.docLength+1);expect(undone.docLength).toBe(initial.docLength);expect(undone.top).toBeGreaterThan(6000);
		if(!sensitivity){
			expect(undoTrace.records.some((r:any)=>r.transaction?.docChanged===true)).toBe(true);
			expect(undoTrace.records.some((r:any)=>r.guard?.reason==="document-change")).toBe(true);
		}
	}finally{await page.close();}
});
