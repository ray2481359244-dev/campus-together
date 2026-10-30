import {useEffect,useLayoutEffect,useRef} from 'react';
import {useVisualPreferences} from '../../lib/visual-preferences';
import {preloadRoute} from '../../lib/route-preload';

// One delegated controller covers controls introduced by lazy routes or dialogs.
// Individual CSS scale leaves existing drag/rotation/route transforms intact.
export function InteractionLayer(){
  const ring=useRef<HTMLDivElement>(null),sparks=useRef<HTMLDivElement>(null);
  const {motionEnabled}=useVisualPreferences();
  useEffect(()=>{
    const warm=(event:Event)=>{const anchor=event.target instanceof Element?event.target.closest<HTMLAnchorElement>('a[href]'):null;if(anchor&&anchor.origin===location.origin)preloadRoute(anchor.pathname);};
    document.addEventListener('pointerover',warm,{passive:true});document.addEventListener('focusin',warm);
    return()=>{document.removeEventListener('pointerover',warm);document.removeEventListener('focusin',warm);};
  },[]);
  useLayoutEffect(()=>{
    if(!motionEnabled)return;
    const fine=matchMedia('(hover:hover) and (pointer:fine)');
    const animations=new Map<HTMLElement,Animation>(),pressed=new Set<HTMLElement>();
    let frame=0,visible=false,hot=false,x=0,y=0,tx=0,ty=0,last=0;
    const control=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('button,a[href],summary,[role="button"],input[type="checkbox"],input[type="radio"]'):null;
    const allowed=(node:HTMLElement|null)=>node&&!node.matches(':disabled,[aria-disabled="true"]')&&!node.closest('[inert],[data-motion-own]');
    function spring(node:HTMLElement,down=false){
      if(!allowed(node)){animations.get(node)?.cancel();animations.delete(node);return;}
      const scale=getComputedStyle(node).scale,from=scale==='none'?'1':scale;
      animations.get(node)?.cancel();
      const animation=node.animate(down?[{scale:from},{scale:'.975'}]:[{scale:from},{scale:'1.025',offset:.43},{scale:'.996',offset:.73},{scale:'1'}],{duration:down?80:380,easing:down?'ease-out':'cubic-bezier(.2,.8,.2,1)',fill:down?'forwards':'none'});
      animations.set(node,animation);
      // A held press uses forwards fill: retain it until release so it can be
      // cancelled. Dropping this reference left a permanent .955 scale below rebound.
      animation.finished.catch(()=>{}).finally(()=>{if(!down&&animations.get(node)===animation)animations.delete(node);});
    }
    function tick(now:number){
      frame=0;if(document.hidden||!visible||!fine.matches)return;
      const dt=Math.min(2,(now-last)/16.67||1);last=now;
      const dx=tx-x,dy=ty-y;x+=dx*(1-Math.pow(.7,dt));y+=dy*(1-Math.pow(.7,dt));
      const stretch=Math.min(Math.hypot(dx,dy)/150,.3),angle=Math.atan2(dy,dx)*180/Math.PI;
      if(ring.current){ring.current.style.transform=`translate3d(${x-17}px,${y-17}px,0) rotate(${angle}deg) scale(${1+stretch},${1-stretch*.55})`;ring.current.dataset.hot=String(hot);ring.current.dataset.visible='true';}
      if(Math.abs(dx)+Math.abs(dy)>.15)frame=requestAnimationFrame(tick);
      if(ring.current)ring.current.dataset.running=String(!!frame);
    }
    function move(event:globalThis.PointerEvent){
      if(event.pointerType!=='mouse'||!fine.matches)return;
      tx=event.clientX;ty=event.clientY;hot=!!control(event.target);
      if(!visible){x=tx;y=ty;visible=true;}if(!frame)frame=requestAnimationFrame(tick);
    }
    function hide(){visible=false;if(frame)cancelAnimationFrame(frame);frame=0;for(const node of pressed){animations.get(node)?.cancel();animations.delete(node);}pressed.clear();if(ring.current){ring.current.dataset.visible='false';ring.current.dataset.running='false';}}
    function down(event:globalThis.PointerEvent){const node=control(event.target);if(!allowed(node))return;pressed.add(node!);spring(node!,true);}
    function up(){for(const node of pressed)spring(node);pressed.clear();}
    function click(event:MouseEvent){
      const node=control(event.target);if(!allowed(node))return;
      if(event.detail===0)spring(node!);
      // Feedback marks input, never implies that a server mutation succeeded.
      if(event.detail&&fine.matches&&sparks.current){
        const dot=document.createElement('i');dot.className='interaction-tap';dot.style.left=event.clientX+'px';dot.style.top=event.clientY+'px';sparks.current.append(dot);
        const a=dot.animate([{opacity:.6,transform:'translate(-50%,-50%) scale(.5)'},{opacity:0,transform:'translate(-50%,-50%) scale(1.7)'}],{duration:380,easing:'ease-out'});
        a.finished.catch(()=>{}).finally(()=>dot.remove());
        while(sparks.current.childElementCount>5)sparks.current.firstElementChild?.remove();
      }
    }
    document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerdown',down,true);
    document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);document.addEventListener('click',click,true);
    document.documentElement.addEventListener('pointerleave',hide);window.addEventListener('blur',hide);document.addEventListener('visibilitychange',hide);fine.addEventListener('change',hide);
    return()=>{hide();animations.forEach(a=>a.cancel());pressed.clear();sparks.current?.replaceChildren();document.removeEventListener('pointermove',move);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);document.removeEventListener('click',click,true);document.documentElement.removeEventListener('pointerleave',hide);window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',hide);fine.removeEventListener('change',hide);};
  },[motionEnabled]);
  return <div className="interaction-layer" aria-hidden="true"><div className="pointer-companion" ref={ring} data-visible="false"><i/><b/></div><div ref={sparks}/></div>;
}
