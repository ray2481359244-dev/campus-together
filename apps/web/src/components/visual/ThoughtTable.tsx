import {useState} from 'react';
import type {CSSProperties,MouseEvent} from 'react';
import {MeetingScene} from './MeetingScene';
import {categories,categoryOrder} from './categories';
import type {InterestCategory} from './categories';
import './thought-table.css';

export interface ThoughtTableProps {
  onChoose?:(category:InterestCategory,source:HTMLAnchorElement)=>void;
  hrefFor?:(category:InterestCategory)=>string;
  motionEnabled?:boolean;
}
export function ThoughtTable({onChoose,hrefFor=category=>'/discover?category='+category+'&panel=discussion',motionEnabled=true}:ThoughtTableProps){
  const [active,setActive]=useState<InterestCategory|null>(null);
  function select(event:MouseEvent<HTMLAnchorElement>,category:InterestCategory){
    if(!onChoose||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();onChoose(category,event.currentTarget);
  }
  return <div className="ct-thought-table-shell" data-motion={motionEnabled?'on':'off'}><div className="ct-thought-table">
    <div className="ct-scene"><MeetingScene activeCategory={active} motionEnabled={motionEnabled}/></div>
    {categoryOrder.map(category=>{const item=categories[category];return <a key={category} className={'ct-cloud ct-cloud-'+category.toLowerCase()}
      href={hrefFor(category)} style={{'--ct-cloud':item.color} as CSSProperties} aria-label={'展开'+item.name+'想法云，进入'+item.name+'讨论'}
      onClick={event=>select(event,category)} onPointerEnter={event=>{if(event.pointerType==='mouse')setActive(category)}} onPointerLeave={()=>setActive(null)}
      onFocus={()=>setActive(category)} onBlur={()=>setActive(null)}>
      <svg className="ct-cloud-shape" viewBox="0 0 260 170" aria-hidden="true"><path d={item.path}/></svg>
      <span className="ct-cloud-copy"><small>{item.note}</small><strong>{item.name}</strong></span>
      <svg className="ct-cloud-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 19 5H5m14 0v14"/></svg>
      <span className="ct-thought-dots" aria-hidden="true"><i/><i/><i/></span>
    </a>})}
    <p className="ct-table-note" aria-hidden="true">脑洞开个小会。</p>
  </div></div>;
}
