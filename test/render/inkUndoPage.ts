import { EditorSelection, EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, historyKeymap, isolateHistory, redo, undo } from "@codemirror/commands";
import { inkApplied, inkEffect, inkHistorySupport, type InkOp } from "../../src/inline/InkHistory";

// Real CM state/view/commands. Only requestAnimationFrame is controlled, so
// deferred measurement can be delivered explicitly without timing sleeps.
let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
window.cancelAnimationFrame = id => { frames.delete(id); };
function measure(): void {
 for (let pass = 0; frames.size; pass++) {
  if (pass > 30) throw new Error("measurement did not settle");
  const ready = [...frames.values()]; frames.clear();
  for (const callback of ready) callback(performance.now());
 }
}
let view: EditorView;
let applied: string[];
const unrelated = StateEffect.define<number>();
const stroke = { id: "s", color: "#000", width: 2, tool: "pen" as const, points: [], bbox: {x:20,y:2000,width:1,height:1}, createdAt: 1 };
function snapshot() {
 return {top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft,selection:view.state.selection.toJSON(),doc:view.state.doc.toString(),applied:[...applied]};
}
function setup(caret: number, kind: "ink" | "text" | "mixed", operation: InkOp["type"] = "add") {
 view?.destroy(); frames.clear(); document.body.replaceChildren(); applied=[];
 const doc = Array.from({length:200},(_,i)=>`${i}: ` + "long text ".repeat(30)).join("\n");
 view = new EditorView({parent:document.body,state:EditorState.create({doc,selection:{anchor:caret},extensions:[
  history(),inkHistorySupport(),keymap.of(historyKeymap),EditorView.theme({"&":{height:"260px",width:"420px"},".cm-scroller":{overflow:"auto"},".cm-content":{fontFamily:"monospace",fontSize:"16px"},".cm-line":{lineHeight:"24px"}}),
  EditorView.updateListener.of(update=>{for(const tr of update.transactions) if(!tr.annotation(inkApplied))for(const e of tr.effects)if(e.is(inkEffect))applied.push(e.value.type);})
 ]})});
 measure(); view.focus(); measure();
 const op: InkOp = operation === "add" ? {type:"add",path:"n.md",strokes:[stroke]} : operation === "remove" ? {type:"remove",path:"n.md",strokes:[stroke],indices:[0]} : operation === "move" ? {type:"move",path:"n.md",strokeIds:["s"],dx:2,dy:4} : {type:"replace",path:"n.md",removed:[stroke],removedAt:[0],inserted:[],insertedAt:[]};
 view.dispatch({changes:kind==="ink"?undefined:{from:0,insert:"X"},effects:kind==="text"?undefined:inkEffect.of(op),annotations:[inkApplied.of(true),isolateHistory.of("full")]});
 measure();
 // A real later selection must survive ink history too.
 if(kind==="ink")view.dispatch({selection:EditorSelection.range(caret+1,caret+3)});
 view.scrollDOM.scrollTop=1700; view.scrollDOM.scrollLeft=190;
 view.scrollDOM.dispatchEvent(new Event("scroll")); measure();
 return snapshot();
}
function run(command: "undo" | "redo" | "keyboard-undo", next: "none" | "unrelated" | "selection" | "text-scroll" = "none") {
 const ok=command==="keyboard-undo" ? !view.contentDOM.dispatchEvent(new KeyboardEvent("keydown",{key:"z",code:"KeyZ",ctrlKey:true,bubbles:true,cancelable:true})) : (command==="undo"?undo:redo)(view);
 if(next==="unrelated")view.dispatch({effects:unrelated.of(1)});
 if(next==="selection")view.dispatch({selection:{anchor:800}});
 if(next==="text-scroll")view.dispatch({selection:{anchor:0},scrollIntoView:true});
 measure(); return {ok,...snapshot()};
}
(window as unknown as {inkUndoPage:unknown}).inkUndoPage={setup,run};
