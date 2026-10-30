import {useLayoutEffect,useRef} from 'react';
import {useVisualPreferences} from './visual-preferences';

// Baseline history stays still; only unseen saved IDs arrive. Edits, read-state
// updates, polling and pagination of older records must not replay the list.
export function useCloudArrival<T extends HTMLElement=HTMLDivElement>(scope:string,items:readonly {id:string;createdAt:string}[],ready:boolean){
  const ids=items.map(item=>item.id);
  const ref=useRef<T>(null),known=useRef({scope,ready:false,latest:0,ids:new Set<string>()}),running=useRef(new Map<HTMLElement,Animation>()),{motionEnabled}=useVisualPreferences();
  const signature=ids.join('|');
  useLayoutEffect(()=>{
    if(known.current.scope!==scope){running.current.forEach(a=>a.cancel());known.current={scope,ready:false,latest:0,ids:new Set()};}
    if(!ready)return;
    const initial=!known.current.ready,fresh=new Set(items.filter(item=>!known.current.ids.has(item.id)&&Date.parse(item.createdAt)>=known.current.latest).map(item=>item.id));
    known.current.latest=Math.max(known.current.latest,...items.map(item=>Date.parse(item.createdAt)||0));
    known.current.ready=true;ids.forEach(id=>known.current.ids.add(id));
    if(!motionEnabled){running.current.forEach(a=>a.cancel());return;}
    if(initial||!fresh.size)return;
    let index=0;
    const root=ref.current,nodes=root?[...(root.matches('[data-cloud-id]')?[root]:[]),...root.querySelectorAll<HTMLElement>('[data-cloud-id]')]:[];
    for(const node of nodes){
      if(!fresh.has(node.dataset.cloudId!)||node.dataset.cloudSilent==='true'||!node.getClientRects().length)continue;
      running.current.get(node)?.cancel();
      node.dataset.cloudArriving='true';
      const animation=node.animate([{opacity:0,transform:'translateY(26px) scale(.94,.82)'},{opacity:1,transform:'translateY(-4px) scale(1.018,1.045)',offset:.57},{opacity:1,transform:'translateY(1px) scale(.997,.99)',offset:.8},{opacity:1,transform:'none'}],{duration:540,delay:Math.min(index++,4)*60,easing:'cubic-bezier(.2,.75,.3,1)',fill:'backwards'});
      running.current.set(node,animation);
      animation.finished.catch(()=>{}).finally(()=>{if(running.current.get(node)===animation){running.current.delete(node);delete node.dataset.cloudArriving;}});
    }
  },[scope,signature,ready,motionEnabled]);
  useLayoutEffect(()=>()=>{running.current.forEach(a=>a.cancel());running.current.clear();},[]);
  return ref;
}
