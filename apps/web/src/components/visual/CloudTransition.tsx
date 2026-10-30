import {forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {useSystemReducedMotion} from './useSystemReducedMotion';
import {categories} from './categories';
import type {InterestCategory} from './categories';

export interface CloudTransitionHandle {
  reveal:(category:InterestCategory,source:HTMLElement,commit:()=>void|Promise<void>)=>Promise<void>;
  cancel:()=>void;
}
export const CloudTransition=forwardRef<CloudTransitionHandle,{motionEnabled?:boolean}>(function CloudTransition({motionEnabled=true},ref){
  const layer=useRef<HTMLDivElement>(null),generation=useRef(0),animations=useRef<Animation[]>([]),enabled=useRef(true);
  const reduce=useSystemReducedMotion(); enabled.current=motionEnabled&&!reduce;
  function cancel(){generation.current++;animations.current.forEach(animation=>animation.cancel());animations.current=[];layer.current?.replaceChildren();}
  useEffect(()=>cancel,[]);
  useEffect(()=>{if(!enabled.current)animations.current.forEach(animation=>animation.cancel());},[motionEnabled,reduce]);
  useImperativeHandle(ref,()=>({cancel,async reveal(category,source,commit){
    cancel(); const version=generation.current,host=layer.current;
    if(!host)return;
    if(!enabled.current){await commit();return;}
    const shape=source.querySelector('svg.ct-cloud-shape');
    if(!shape){await commit();return;}
    const from=shape.getBoundingClientRect(),bounds=host.getBoundingClientRect();
    if(!from.width||!from.height){await commit();return;}
    const node=document.createElement('span'),svg=shape.cloneNode(true) as SVGSVGElement;
    node.className='ct-expanding-cloud';svg.classList.remove('ct-cloud-shape');
    svg.style.fill=`color-mix(in srgb,${categories[category].color} 56%,#fff9ef)`;
    Object.assign(node.style,{left:from.left-bounds.left+'px',top:from.top-bounds.top+'px',width:from.width+'px',height:from.height+'px'});
    node.append(svg);host.append(node);
    const dx=bounds.width/2-(from.left-bounds.left+from.width/2),dy=bounds.height/2-(from.top-bounds.top+from.height/2);
    const scale=Math.max(bounds.width/(from.width*.58),bounds.height/(from.height*.42))*1.25;
    try{
      const expansion=node.animate([{transform:'translate(0,0) scale(1)'},{transform:'translate('+dx*.045+'px,'+dy*.045+'px) scale(.94,1.04)',offset:.12},{transform:'translate('+dx+'px,'+dy+'px) scale('+scale+')'}],{duration:420,easing:'cubic-bezier(.64,0,.18,1)',fill:'forwards'});
      animations.current.push(expansion);await expansion.finished.catch(()=>{});
      if(version!==generation.current)return;
      await commit();
      if(version!==generation.current)return;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(version!==generation.current)return;
      if(enabled.current){const fade=node.animate([{opacity:1},{opacity:0}],{duration:140,fill:'forwards'});animations.current.push(fade);await fade.finished.catch(()=>{});}
    }finally{if(version===generation.current)cancel();}
  }}),[]);
  return <div className="ct-cloud-transition" ref={layer} aria-hidden="true"/>;
});
