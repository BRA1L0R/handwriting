import { describe, expect, it } from "vitest";
import { EditorState, StateEffect, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { history, invertedEffects, isolateHistory, redo, undo } from "@codemirror/commands";
import { inkApplied, inkEffect, inkHistorySupport } from "./InkHistory";

const snapshot = StateEffect.define<number>();
const other = StateEffect.define<number>();
function editor() {
 let snapshots = 0;
 const transactions: Transaction[] = [];
 const view = {
  state: EditorState.create({doc:"hello",extensions:[history(),inkHistorySupport(),invertedEffects.of(tr=>tr.effects.filter(e=>e.is(other)).map(e=>other.of(-e.value)))]}),
  scrollSnapshot: () => snapshot.of(++snapshots),
  dispatch(spec: TransactionSpec | Transaction) {
   const tr = spec instanceof Transaction ? spec : this.state.update(spec);
   const startState=this.state;this.state=tr.state;transactions.push(tr);
   const update={view:this,startState,state:this.state,transactions:[tr]} as unknown as ViewUpdate;
   for(const listener of this.state.facet(EditorView.updateListener))listener(update);
  },
 };
 const gesture=()=>view.dispatch({effects:inkEffect.of({type:"move",path:"n.md",strokeIds:["s"],dx:1,dy:2}),annotations:[inkApplied.of(true),isolateHistory.of("full")]});
 const run=(command:typeof undo)=>command({state:view.state,dispatch:tr=>view.dispatch(tr)});
 return {view,gesture,run,transactions,snapshots:()=>snapshots};
}
describe("ink viewport restoration through real history",()=>{
 it("restores the current selection for undo and redo without adding history",()=>{
  const h=editor();h.gesture();h.view.dispatch({selection:{anchor:2,head:4}});
  expect(h.run(undo)).toBe(true);expect(h.view.state.selection.main.anchor).toBe(2);expect(h.view.state.selection.main.head).toBe(4);
  expect(h.snapshots()).toBe(1);expect(h.transactions.at(-1)?.annotation(Transaction.addToHistory)).toBe(false);
  expect(h.run(redo)).toBe(true);expect(h.snapshots()).toBe(2);expect(h.view.state.selection.main.head).toBe(4);
  expect(h.run(redo)).toBe(false);
 });
 it("keeps text and ink chronological with no extra undo step",()=>{
  const h=editor();h.view.dispatch({changes:{from:5,insert:"!"},annotations:isolateHistory.of("full")});h.gesture();
  expect(h.run(undo)).toBe(true);expect(h.view.state.doc.toString()).toBe("hello!");expect(h.snapshots()).toBe(1);
  expect(h.run(undo)).toBe(true);expect(h.view.state.doc.toString()).toBe("hello");expect(h.snapshots()).toBe(1);
  expect(h.run(undo)).toBe(false);expect(h.run(redo)).toBe(true);expect(h.view.state.doc.toString()).toBe("hello!");expect(h.run(redo)).toBe(true);expect(h.snapshots()).toBe(2);
 });
 it("leaves mixed text/ink and foreign effect history alone",()=>{
  const h=editor();h.view.dispatch({changes:{from:5,insert:"!"},effects:inkEffect.of({type:"move",path:"n.md",strokeIds:["s"],dx:1,dy:2}),annotations:isolateHistory.of("full")});
  h.run(undo);expect(h.snapshots()).toBe(0);expect(h.view.state.doc.toString()).toBe("hello");
  h.view.dispatch({effects:other.of(1),annotations:isolateHistory.of("full")});h.run(undo);expect(h.snapshots()).toBe(0);
 });
 it("does not take over an ink gesture or a plain selection history event",()=>{
  const h=editor();h.gesture();expect(h.snapshots()).toBe(0);h.view.dispatch({selection:{anchor:3},userEvent:"select.pointer",scrollIntoView:true});expect(h.snapshots()).toBe(0);
 });
});
