import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undoDepth, undo, redo } from "@codemirror/commands";
import * as overlayModule from "../../src/inline/InkOverlay";
import { surfaceExtents } from "../../src/inline/SurfaceExtent";
import { installObsidianDom } from "./obsidianDom";
import { editorInfoField, setBrowserEditorInfo } from "./iphoneObsidianStub";
import { setPenInk } from "../../src/inline/PenInk";
import { parsePage, serializePage, type PageData } from "../../src/model/PageData";
import { inkToSvg } from "../../src/ink/SvgExport";

installObsidianDom();
const { inlineInk, inkOverlayExtension, overlayForPath } = overlayModule;
const setEnabled = (on: boolean) => (overlayModule as unknown as {setScrollExpansionEnabled?: (value:boolean)=>void}).setScrollExpansionEnabled?.(on);
let writes = 0, loads = 0;
const ids = new Map<string, string>();
const sidecars = new Map<string, string>();
const save = (id: string, page: PageData) => { writes++; sidecars.set(id, serializePage(page)); };
inlineInk.attachHost({readPageId:path=>ids.get(path) ?? null,claimId:async (path,id)=>{writes++;ids.set(path,id);return{pageId:id};},loadSidecar:async id=>{loads++;return sidecars.has(id) ? parsePage(sidecars.get(id)!,id) : null;},scheduleSidecar:save,scheduleSidecarNow:async(id,page)=>save(id,page),notify:()=>{}});
async function settle(count = 3) { for(let i=0;i<count;i++) await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())); }

async function run(on: boolean, seeded: boolean, scale = 1.5) {
	const path = `scroll/${on}-${seeded}.md`;
	surfaceExtents.handleDelete(path);
	if (seeded) surfaceExtents.grow(path, {x:1000,y:1600});
	setEnabled(on);
	const wrapper = document.body.appendChild(document.createElement("div"));
	wrapper.className="markdown-source-view";
	wrapper.style.cssText="position:relative;width:430px;height:720px;overflow:hidden";
	const view = new EditorView({parent:wrapper,state:EditorState.create({doc:"",extensions:[history(),editorInfoField.init(()=>({app:{commands:{executeCommandById:()=>false}},file:{path},editor:{}})),inkOverlayExtension(),EditorView.theme({"&":{height:"700px",width:"420px"},".cm-scroller":{overflow:"auto"},".cm-content":{fontFamily:"sans-serif",fontSize:"16px",lineHeight:"24px",minHeight:"100%"}})]})});
	await settle(5);
	const overlay = overlayForPath(path)!;
	if (!overlay) throw Error("real overlay missing");
	const scroller = view.scrollDOM;
	let extentWrites=0;
	const watcher = new MutationObserver(records=>{extentWrites+=records.filter(record=>(record.target as Element).classList.contains("handwriting-surface-extent")).length;});
	watcher.observe(scroller,{subtree:true,attributes:true,attributeFilter:["style"]});
	const snap = () => ({left:scroller.scrollLeft,top:scroller.scrollTop,width:scroller.scrollWidth,height:scroller.scrollHeight,clientWidth:scroller.clientWidth,clientHeight:scroller.clientHeight,grant:{...surfaceExtents.get(path)},camera:{...(overlay as any).camera.snapshot},backings:[...wrapper.querySelectorAll("canvas")].map(c=>({width:c.width,height:c.height})),extentWrites,history:undoDepth(view.state),writes,strokes:inlineInk.strokes(path).length});
	const initial=snap();
	const steps=[];
	for(const axis of ["y","y","y","x","x","x"] as const) {
		if(axis==="y") scroller.scrollTop=Math.max(0,scroller.scrollHeight-scroller.clientHeight*1.25-20);
		else scroller.scrollLeft=Math.max(0,scroller.scrollWidth-scroller.clientWidth*1.25-20);
		await settle();
		const before=snap(); const start=performance.now();
		if(axis==="y") scroller.scrollTop+=40; else scroller.scrollLeft+=40;
		await settle();
		steps.push({axis,before,after:snap(),elapsed:performance.now()-start});
	}
	const beforeStill=snap(); await settle(12); const afterStill=snap();
	setEnabled(false); await settle(); const disabled=snap();
	let controls = null;
	if (on) {
		setEnabled(true);
		await settle();
		const pointer = (type: string, x: number, y: number, buttons: number) => {
			view.contentDOM.dispatchEvent(new PointerEvent(type, {bubbles:true,cancelable:true,pointerType:"pen",pointerId:71,isPrimary:true,clientX:x,clientY:y,buttons,pressure:buttons ? 0.5 : 0}));
		};
		setPenInk(true);
		const rect = scroller.getBoundingClientRect();
		const x = rect.left + 100, y = rect.top + 200;
		pointer("pointerdown", x, y, 1);
		pointer("pointermove", x + 40, y + 30, 1);
		pointer("pointerup", x + 40, y + 30, 0);
		await settle();
		const drawn = snap();
		const stroke = JSON.parse(JSON.stringify(inlineInk.strokes(path)[0] ?? null));
		const projected = stroke ? (overlay as any).camera.worldToScreen(stroke.points[0].x, stroke.points[0].y) : null;
		const alignment = projected ? {
			x: (overlay as any).lastSyncRectLeft + projected.x * (overlay as any).cssScale - x,
			y: (overlay as any).lastSyncRectTop + projected.y * (overlay as any).cssScale - y,
		} : null;
		const undoOk = undo(view); await settle(); const undone = snap();
		const redoOk = redo(view); await settle(); const redone = snap();
		const restored = JSON.parse(JSON.stringify(inlineInk.strokes(path)[0] ?? null));
		const exportBeforeTravel = inkToSvg(inlineInk.strokes(path));
		overlayModule.setInlinePanMode(true);
		scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight * 1.25 - 10;
		await settle(); const beforePan = snap();
		pointer("pointerdown", x, y, 1);
		pointer("pointermove", x, y - 100, 1);
		pointer("pointerup", x, y - 100, 0);
		await settle(); const afterPan = snap();
		overlayModule.setInlinePanMode(false);
		view.dom.style.height = "600px";
		await settle(8); const resized = snap(); await settle(8); const resizeStill = snap();
		(overlay as any).pinch("start", 1, {x, y});
		(overlay as any).pinch("move", scale, {x, y});
		(overlay as any).pinch("end", scale, {x, y});
		await settle(8); const zoomed = snap(); await settle(8); const zoomStill = snap();
		// Pinch scroll suppression lasts beyond the first few animation frames.
		await new Promise(resolve => setTimeout(resolve, 600));
		const zoomTravel = {scale:(overlay as any).pinchScaleNow,transform:view.dom.style.transform,steps:[] as {axis:string;before:ReturnType<typeof snap>;after:ReturnType<typeof snap>}[]};
		for (const axis of ["y","y","y","x","x","x"]) {
			const before = snap();
			if (axis === "y") scroller.scrollTop = scroller.scrollHeight;
			else scroller.scrollLeft = scroller.scrollWidth;
			await settle(5);
			zoomTravel.steps.push({axis,before,after:snap()});
		}
		const savedGrant = {...surfaceExtents.get(path)};
		const other = path + ".other";
		view.dispatch({effects:setBrowserEditorInfo.of({app:{commands:{executeCommandById:()=>false}},file:{path:other},editor:{}})});
		await settle(8);
		const otherGrant = {...surfaceExtents.get(other)};
		scroller.scrollTop = scroller.scrollHeight; await settle(8);
		const oldGrantAfterSwitch = {...surfaceExtents.get(path)};
		const exportAfterTravel = inkToSvg(inlineInk.strokes(path));
		view.destroy();
		const loadsBefore = loads;
        const reloaded = await inlineInk.reloadExternal(path);
        const reloadReads = loads - loadsBefore;
		surfaceExtents.handleDelete(path);
		setEnabled(false);
		const reopened = new EditorView({parent:wrapper,state:EditorState.create({doc:"",extensions:[history(),editorInfoField.init(()=>({app:{commands:{executeCommandById:()=>false}},file:{path},editor:{}})),inkOverlayExtension(),EditorView.theme({"&":{height:"700px",width:"420px"},".cm-scroller":{overflow:"auto"}})]})});
		await inlineInk.ensureLoaded(path); await settle(8);
		const reopenedStroke = JSON.parse(JSON.stringify(inlineInk.strokes(path)[0] ?? null));
		const exportReopened = inkToSvg(inlineInk.strokes(path));
		const reopenedOverlay = overlayForPath(path) !== null;
		reopened.destroy();
		controls = {drawn,stroke,alignment,undoOk,undone,redoOk,redone,restored,beforePan,afterPan,resized,resizeStill,zoomed,zoomStill,zoomTravel,savedGrant,otherGrant,oldGrantAfterSwitch,exportBeforeTravel,exportAfterTravel,reloaded,reloadReads,reopenedStroke,exportReopened,reopenedOverlay};
	}
	watcher.disconnect(); view.destroy(); wrapper.remove();
	return{on,seeded,initial,steps,beforeStill,afterStill,disabled,controls};
}
(window as any).scrollExpansionRun=run;
