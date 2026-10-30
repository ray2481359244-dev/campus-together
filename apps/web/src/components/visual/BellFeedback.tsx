import {useLayoutEffect,useRef} from 'react';
import {Bell} from 'lucide-react';
import {useVisualPreferences} from '../../lib/visual-preferences';

// pulse changes only after a confirmed mutation; polling and mounting stay still.
export function BellFeedback({muted,pulse=0,size=17}:{muted:boolean;pulse?:number;size?:number}){
  const ref=useRef<HTMLSpanElement>(null),played=useRef(pulse),{motionEnabled}=useVisualPreferences();
  useLayoutEffect(()=>{
    if(pulse===played.current)return;played.current=pulse;
    if(!pulse||!motionEnabled||!ref.current)return;
    const bell=ref.current.querySelector('.bell-body'),slash=ref.current.querySelector('.bell-slash path'),puff=ref.current.querySelector('.bell-puff');
    const animations:Animation[]=[];
    if(bell)animations.push(bell.animate([{rotate:'0deg'},{rotate:'-20deg',offset:.16},{rotate:'17deg',offset:.34},{rotate:'-11deg',offset:.52},{rotate:'7deg',offset:.7},{rotate:'0deg'}],{duration:580,easing:'ease-out'}));
    if(slash)animations.push(slash.animate(muted?[{strokeDashoffset:'25',opacity:0},{strokeDashoffset:'0',opacity:1}]:[{strokeDashoffset:'0',opacity:1},{strokeDashoffset:'25',opacity:0}],{duration:260,delay:muted?160:0,fill:'backwards',easing:'ease-out'}));
    if(puff)animations.push(puff.animate([{opacity:0,scale:'.5'},{opacity:.4,scale:'1.15',offset:.3},{opacity:0,scale:'1.6'}],{duration:580,easing:'ease-out'}));
    animations.forEach(a=>a.finished.catch(()=>{}));
    return()=>animations.forEach(a=>a.cancel());
  },[pulse,motionEnabled]);
  return <span ref={ref} className={'bell-feedback'+(muted?' is-muted':'')} data-bell-pulse={pulse} style={{width:size,height:size}} aria-hidden="true"><Bell className="bell-body" size={size}/><svg className="bell-slash" viewBox="0 0 24 24"><path d="M4 4 20 20"/></svg><i className="bell-puff"/></span>;
}
