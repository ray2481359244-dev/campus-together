import type {ReactNode} from 'react';
import {useLayoutEffect,useRef} from 'react';
import {useLocation} from 'react-router-dom';
import {MessageSquare,Flag,FileText,ArrowUpRight,Link2} from 'lucide-react';
import {SectionLink} from './UI';
import {useVisualPreferences} from '../lib/visual-preferences';
import {WorkbenchMotionContext} from '../lib/workbench-motion';

export function PostWorkbench({heading,body,summary,feedback,discussion,actions,commentCount,teamCount}:{heading:ReactNode;body:ReactNode;summary:ReactNode;feedback:ReactNode;discussion:ReactNode;actions:ReactNode;commentCount:number;teamCount:number}){
  const location=useLocation(),{motionEnabled}=useVisualPreferences(),ref=useRef<HTMLDivElement>(null);
  const hash=location.hash.slice(1),view=hash==='linked-recruitments'?'act':hash==='post-content'?'read':hash==='conversation'||hash==='write-comment'||new URLSearchParams(location.search).has('comment')?'talk':'read';
  const previous=useRef(view),before=useRef(new Map<HTMLElement,DOMRect>()),animations=useRef<Animation[]>([]);
  function capture(){
    before.current=new Map(Array.from(ref.current?.querySelectorAll<HTMLElement>('.wb-source,.wb-talk,.wb-act')||[]).filter(node=>node.getClientRects().length).map(node=>[node,node.getBoundingClientRect()]));
    animations.current.forEach(animation=>animation.cancel());animations.current=[];
  }
  useLayoutEffect(()=>{
    if(previous.current===view)return;previous.current=view;
    if(!motionEnabled)return;
    const after=Array.from(ref.current?.querySelectorAll<HTMLElement>('.wb-source,.wb-talk,.wb-act')||[]).filter(node=>node.getClientRects().length).map(node=>({node,rect:node.getBoundingClientRect()}));
    for(const {node,rect} of after){const old=before.current.get(node);node.style.transformOrigin='top left';const transform=old?`translate(${old.left-rect.left}px,${old.top-rect.top}px) scale(${old.width/rect.width},${old.height/rect.height})`:'translateY(8px) scale(.99)';const animation=node.animate([{opacity:old?1:.5,transform},{opacity:1,transform:'none'}],{duration:340,easing:'cubic-bezier(.2,.85,.2,1)'});animation.finished.catch(()=>{});animations.current.push(animation);}
    before.current.clear();
    return()=>{animations.current.forEach(animation=>animation.cancel());animations.current=[];};
  },[view,motionEnabled]);
  return <WorkbenchMotionContext value={capture}><div className="post-workbench post-detail" data-view={view} ref={ref}>
    <nav className="post-section-nav wb-nav" aria-label="帖子内容导航"><SectionLink target="post-content" active={view==='read'}><FileText size={16} aria-hidden="true"/>01 帖子正文</SectionLink><SectionLink target="conversation" active={view==='talk'}><MessageSquare size={16} aria-hidden="true"/>02 评论互动 <span aria-hidden="true">{commentCount}</span></SectionLink><SectionLink target="linked-recruitments" active={view==='act'}><Flag size={16} aria-hidden="true"/>03 相关招募 <span aria-hidden="true">{teamCount}</span></SectionLink></nav>
    <div className="wb-layout"><article className="wb-source paper"><div className="surface-caption"><FileText size={17} aria-hidden="true"/>想法的起点<span>原帖</span></div>{heading}<div className="wb-source-body" hidden={view!=='read'}>{body}</div><div className="wb-source-summary" hidden={view==='read'}>{summary}<SectionLink target="post-content" className="text-button">展开完整原帖<ArrowUpRight size={16} aria-hidden="true"/></SectionLink></div><div className="wb-feedback">{feedback}</div></article>
    <div className="wb-continuation" aria-hidden="true"><i/><span>由此延伸</span><i/></div><div className="wb-responses">
      <section className="wb-talk surface-talk" hidden={view==='act'}><header className="surface-heading"><MessageSquare size={23} aria-hidden="true"/><div><h2>有人接住了这个想法。</h2><p>已载入 {commentCount} 条回应，话题还在继续</p></div></header><div className="wb-preview" hidden={view!=='read'}><p>一个补充、一个问题，也能让好想法再往前走一步。</p><SectionLink target="conversation" className="text-button">展开这场讨论<ArrowUpRight size={17} aria-hidden="true"/></SectionLink></div><div hidden={view!=='talk'}><p className="surface-origin"><Link2 size={14} aria-hidden="true"/>正在回应这篇原帖</p>{discussion}</div></section>
      <section className="wb-act surface-action" hidden={view==='talk'}><header className="surface-heading"><Flag size={23} aria-hidden="true"/><div><h2>聊到这里，想一起做？</h2><p>从这个想法，迈出下一步。</p></div></header><div className="wb-preview" hidden={view!=='read'}><p>{teamCount?`${teamCount} 份相关招募，看看谁已经开始行动。`:'还没有相关招募，你可以发起第一支队伍。'}</p><SectionLink target="linked-recruitments" className="text-button">把下一步展开<ArrowUpRight size={17} aria-hidden="true"/></SectionLink></div><div hidden={view!=='act'}>{actions}</div></section>
    </div></div>
  </div></WorkbenchMotionContext>;
}
