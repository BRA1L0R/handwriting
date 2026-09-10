import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, historyKeymap, undoDepth, redoDepth, isolateHistory } from "@codemirror/commands";
import { inlineInk, inkOverlayExtension, overlayForPath } from "../../src/inline/InkOverlay";
import { inkEffect } from "../../src/inline/InkHistory";
import { setDiagnosticsEnabled } from "../../src/diag/DiagSwitch";
import { captureUndoTrace, clearUndoTrace, resetUndoTrace } from "../../src/diag/UndoHistoryTrace";
import { captureInlinePenTrace } from "../../src/inline/InlinePenRouter";
import { setMouseInk } from "../../src/inline/MouseInk";
import { setPenInk } from "../../src/inline/PenInk";
import { installObsidianDom } from "./obsidianDom";
import { editorInfoField } from "./iphoneObsidianStub";
installObsidianDom();
inlineInk.attachHost({readPageId:()=>"existing-page",claimId:async()=>({pageId:"existing-page"}),loadSidecar:async()=>null,scheduleSidecar:()=>{},scheduleSidecarNow:async()=>{},notify:()=>{}});
const settle=async()=>{for(let i=0;i<6;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
let view:EditorView,path:string;
const trace:unknown[]=[];
const snap=()=>({top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft,selection:view.state.selection.toJSON(),focused:view.hasFocus,active:document.activeElement?.className,strokes:inlineInk.strokes(path).length,undo:undoDepth(view.state),redo:redoDepth(view.state),docLength:view.state.doc.length});
async function setup(scale:number,blur=false){
	setDiagnosticsEnabled(true);clearUndoTrace();resetUndoTrace();
	path=`mouse-undo-${scale}.md`;
	const host=document.body.appendChild(document.createElement("div"));host.className="markdown-source-view";host.style.cssText="width:640px;height:480px;overflow:hidden;position:relative";
	const doc=Array.from({length:300},(_,i)=>`${i} ${"some text ".repeat(12)}`).join("\n");
	view=new EditorView({parent:host,state:EditorState.create({doc,selection:{anchor:doc.length},extensions:[history(),keymap.of(historyKeymap),editorInfoField.init(()=>({app:{commands:{executeCommandById:()=>false}},file:{path},editor:{}})),inkOverlayExtension(),EditorView.updateListener.of(u=>{trace.push({kind:"update",transactions:u.transactions.map(t=>({event:t.annotation(Transaction.userEvent),doc:t.docChanged,scroll:t.scrollIntoView,ink:t.effects.map(e=>e.is(inkEffect)?e.value.type:"other")})),...snap()});}),EditorView.theme({"&":{width:"640px",height:"480px"},".cm-scroller":{overflow:"auto"},".cm-content":{fontFamily:"monospace",fontSize:"16px",lineHeight:"24px"}})]})});
	await settle();view.focus();await settle();
	const overlay=overlayForPath(path)!;if(!overlay)throw Error("missing real overlay");
	if(scale!==1){(overlay as any).pinch("start",1,{x:200,y:200});(overlay as any).pinch("move",scale,{x:200,y:200});(overlay as any).pinch("end",scale,{x:200,y:200});await settle();}
	view.scrollDOM.scrollTop=700;view.scrollDOM.scrollLeft=0;await settle();
	setPenInk(true);setMouseInk(true);if(blur)view.contentDOM.blur();trace.length=0;
	return snap();
}
async function textControl(){view.dispatch({changes:{from:view.state.doc.length,insert:"!"},annotations:isolateHistory.of("full")});await settle();view.scrollDOM.scrollTop=700;await settle();return snap();}
(window as any).mouseInkUndo={setup,snap,settle,trace,undoTrace:()=>captureUndoTrace(),capture:()=>captureInlinePenTrace({}),textControl};
