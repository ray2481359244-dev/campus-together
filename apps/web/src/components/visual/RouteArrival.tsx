import {useLayoutEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {useVisualPreferences} from '../../lib/visual-preferences';
export function RouteArrival({path,skip,children}:{path:string;skip:boolean;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null),{motionEnabled}=useVisualPreferences();
  useLayoutEffect(()=>{
    if(!motionEnabled||skip)return;
    const animation=ref.current?.animate([{opacity:.55,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:190,easing:'cubic-bezier(.2,.8,.2,1)'});
    return()=>animation?.cancel();
  },[path,skip,motionEnabled]);
  return <div className="route-arrival" ref={ref}>{children}</div>;
}
