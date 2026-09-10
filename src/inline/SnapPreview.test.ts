import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SnapPreview } from "./SnapPreview";
import { StrokeBuilder } from "../ink/StrokeBuilder";
import { snapStroke } from "../ink/ShapeSnap";

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
function rig(noFit=false) {
 const builder=new StrokeBuilder("pen","#112233",2);
 builder.start(0);
 for(let i=0;i<16;i++) builder.add(i*8,i%2,0.5,i*8);
 let valid=true;
 const snapshot=vi.fn(()=>builder.snapshotReleaseFiltered());
 const fit=vi.fn((...args:Parameters<typeof snapStroke>)=>noFit?null:snapStroke(...args));
 const show=vi.fn(()=>true), hide=vi.fn();
 const p=new SnapPreview({clock:{setTimeout:(fn:TimerHandler,ms?:number)=>setTimeout(fn as ()=>void,ms) as unknown as number,clearTimeout:(id:number)=>clearTimeout(id)},valid:()=>valid,snapshot,show,hide},fit);
 p.start(120,1);
 return {p,builder,fit,show,hide,snapshot,invalidate:()=>{valid=false;}};
}
it("ordinary motion fits nothing; one pause fits once despite stationary pressure updates",()=>{
 const r=rig();
 for(let i=0;i<100;i++){vi.advanceTimersByTime(10);r.p.move(130+i*8,1);}
 expect(r.fit).not.toHaveBeenCalled();expect(r.snapshot).not.toHaveBeenCalled();
 vi.advanceTimersByTime(350);expect(r.fit).toHaveBeenCalledTimes(1);expect(r.show).toHaveBeenCalledTimes(1);
 for(let i=0;i<20;i++){r.builder.add(120,1,0.8,130);r.p.move(923,1);vi.advanceTimersByTime(100);}
 expect(r.fit).toHaveBeenCalledTimes(1);
});
it("meaningful movement clears a ready candidate and rearms exactly once",()=>{
 const r=rig();vi.advanceTimersByTime(350);r.p.move(126,1);
 expect(r.p.take(r.builder.finishReleaseFiltered(),true)).toBeNull();
 r.p.start(126,1);vi.advanceTimersByTime(350);expect(r.fit).toHaveBeenCalledTimes(2);
});
it("no-fit is memoized until meaningful movement",()=>{
 const r=rig(true);vi.advanceTimersByTime(2000);r.p.move(122,1);vi.advanceTimersByTime(2000);
 expect(r.fit).toHaveBeenCalledTimes(1);r.p.move(130,1);vi.advanceTimersByTime(350);expect(r.fit).toHaveBeenCalledTimes(2);
});
it.each(["waiting","ready"])("invalid contact/setting/note/style clears %s state", state=>{
 const r=rig();if(state==="ready")vi.advanceTimersByTime(350);r.invalidate();r.p.check();
 expect(r.p.take(r.builder.finishReleaseFiltered(),true)).toBeNull();vi.advanceTimersByTime(1000);expect(r.fit).toHaveBeenCalledTimes(state==="ready"?1:0);
});
it("a removed snapshot body cannot be accepted",()=>{
 const r=rig();vi.advanceTimersByTime(350);const final=r.builder.finishReleaseFiltered();final[0]!.points.shift();
 expect(r.p.take(final,true)).toBeNull();
});
it("a retained point pressure update cannot change the displayed candidate",()=>{
 const r=rig();vi.advanceTimersByTime(350);
 const shown=r.fit.mock.results[0]!.value;const points=structuredClone(shown.points);
 r.builder.add(120,1,0.9,600);expect(r.p.take(r.builder.finishReleaseFiltered(),true)?.points).toEqual(points);
});
it("an already queued callback is inert after clear or a new gesture",()=>{
 const callbacks:Array<()=>void>=[];
 const snapshot=vi.fn(()=>[]);
 const p=new SnapPreview({clock:{setTimeout:fn=>{callbacks.push(fn as ()=>void);return callbacks.length;},clearTimeout(){}},valid:()=>true,snapshot,show:()=>true,hide(){} });
 p.start(0,0);p.clear();p.start(20,0);callbacks[0]!();expect(snapshot).not.toHaveBeenCalled();callbacks[1]!();expect(snapshot).toHaveBeenCalledTimes(1);
});
it("a candidate that never painted cannot be accepted",()=>{
 const r=rig();r.show.mockReturnValue(false);vi.advanceTimersByTime(350);expect(r.p.take(r.builder.finishReleaseFiltered(),true)).toBeNull();
});
