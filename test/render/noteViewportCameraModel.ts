/** Independent screen-space oracle; never mutates editor geometry. */
export function fitScale(bounds:{width:number;height:number},width=640,height=480,font=1,external=1):number {
 return Math.min(1,(width-48)/(Math.max(1,bounds.width)*font*external),(height-48)/(Math.max(1,bounds.height)*font*external));
}
