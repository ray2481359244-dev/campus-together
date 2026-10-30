import {useEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {useVisualPreferences} from '../lib/visual-preferences';

export function SoftDisclosure({title,children}:{title:ReactNode;children:ReactNode}){
  const ref=useRef<HTMLDetailsElement>(null),desired=useRef(false),animations=useRef<Animation[]>([]),{motionEnabled}=useVisualPreferences();
  function settle(){const node=ref.current;if(!node)return;animations.current.forEach(a=>a.cancel());animations.current=[];node.open=desired.current;node.style.removeProperty('height');node.style.removeProperty('overflow');}
  useEffect(()=>{if(!motionEnabled)settle();},[motionEnabled]);
  useEffect(()=>()=>{animations.current.forEach(a=>a.cancel());},[]);
  function toggle(){
    const node=ref.current;if(!node)return;
    const from=node.getBoundingClientRect().height;desired.current=!desired.current;
    animations.current.forEach(a=>a.cancel());animations.current=[];
    if(!motionEnabled){settle();return;}
    node.open=true;node.style.height='auto';
    const target=desired.current?node.getBoundingClientRect().height:node.querySelector('summary')!.offsetHeight;
    node.style.height=from+'px';node.style.overflow='hidden';
    const height=node.animate([{height:from+'px'},{height:target+'px'}],{duration:280,easing:'cubic-bezier(.22,.8,.25,1)'});
    animations.current.push(height);
    height.finished.then(()=>{if(animations.current.includes(height))settle();}).catch(()=>{});
  }
  return <details className="soft-disclosure" ref={ref}><summary onClick={event=>{event.preventDefault();toggle();}}>{title}</summary><div className="soft-disclosure-content">{children}</div></details>;
}
