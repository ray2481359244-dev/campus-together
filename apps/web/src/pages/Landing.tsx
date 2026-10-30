import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {motion} from 'motion/react';
import {ArrowUpRight,RotateCcw,Sparkles} from 'lucide-react';
import {StudentArtwork} from '../components/visual/StudentArtwork';
import {useVisualPreferences} from '../lib/visual-preferences';
import {useAuth} from '../lib/auth';

function Toy({kind,label}:{kind:'book'|'plane'|'game'|'mountain';label:string}){
  const {motionEnabled}=useVisualPreferences(),lastDrag=useRef(0),ref=useRef<HTMLButtonElement>(null),animation=useRef<Animation|null>(null);
  useEffect(()=>()=>animation.current?.cancel(),[]);
  return <motion.button ref={ref} className={'cover-toy toy-'+kind} type="button" aria-label={label+'，可拖动或按 Enter 弹一下'} drag={motionEnabled} dragConstraints={{left:-55,right:55,top:-40,bottom:40}} dragElastic={.15} dragSnapToOrigin dragTransition={{bounceStiffness:440,bounceDamping:30}} onDragStart={()=>lastDrag.current=Infinity} onDragEnd={()=>lastDrag.current=performance.now()} onClick={()=>{if(!motionEnabled||performance.now()-lastDrag.current<300)return;animation.current?.cancel();animation.current=ref.current?.animate([{rotate:'0deg',scale:1},{rotate:'-13deg',scale:1.12,offset:.3},{rotate:'7deg',scale:.98,offset:.65},{rotate:'0deg',scale:1}],{duration:650,easing:'cubic-bezier(.2,.8,.2,1)'})||null;}}>
    <svg viewBox="0 0 110 95" fill="none" stroke="#57484a" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind==='book'?<><path d="M54 21Q30 4 12 17l9 56q20-10 39 5 18-16 39-11L86 12Q66 8 54 21Z" fill="#b8dfec"/><path d="m54 21 6 57M24 26l18 4m-16 8 18 4m22-15 13-8m-11 20 14-8M14 77l45 8 45-13-6-5"/></>:kind==='plane'?<><path d="m7 23 96-15-40 76-14-35Z" fill="#fffaf1"/><path d="m103 8-54 41 16 14" fill="#cbb5f3"/><path d="M41 59c-20 30-39 0-20-5 19-4 20 31-2 34" strokeDasharray="3 6"/></>:kind==='game'?<><path d="M26 30h60c13 1 29 49 14 54-8 3-17-13-25-13H38C17 95 7 85 12 69Z" fill="#f3ff74"/><path d="M43 41H33v10H23v10h10v10h10V61h10V51H43Z" fill="#cbb5f3"/><circle cx="80" cy="49" r="5" fill="#f3afc4"/><circle cx="90" cy="62" r="4" fill="#c2dfae"/><path d="M56 29V18q0-9 14-8"/></>:<><path d="m5 81 31-45 24 36 19-27 29 36Z" fill="#c6e5b2"/><path d="m30 45 6-9 10 16-8-3Zm31 36 18-36 29 36Z" fill="#b6dfe9"/><path d="m73 58 6-13 9 14-9-4Z" fill="#fffaf1"/><circle cx="27" cy="17" r="10" fill="#f5ff72"/></>}
    </svg><span>{label}</span>
  </motion.button>;
}
function CoverTitle(){
  const stage=useRef<HTMLDivElement>(null),{motionEnabled}=useVisualPreferences(),[replay,setReplay]=useState(0);
  useEffect(()=>{
    const root=stage.current;if(!root)return;
    const animations:Animation[]=[];let frame=0;
    const animate=(element:Element|null,frames:Keyframe[],options:KeyframeAnimationOptions)=>{if(element&&motionEnabled)animations.push(element.animate(frames,options));};
    const width=root.clientWidth,far=Number.parseFloat(getComputedStyle(root).getPropertyValue('--far'));
    if(motionEnabled){
      root.querySelectorAll<HTMLElement>('.cover-mascot').forEach((mascot,side)=>{
        const direction=side===0?-1:1,w=mascot.offsetWidth,start=direction*(width/2+w)-w/2,contact=side===0?-w*1.01:w*.01,end=direction*far-w/2;
        const frames:Keyframe[]=Array.from({length:181},(_,i)=>{const t=2260*i/180;let x:number,y=0,angle:number,sx=1,sy=1;if(t<850){const p=Math.max(0,Math.min(1,(t-80)/770))**2.15;x=start+(contact-start)*p;y=-Math.sin(p*Math.PI)*12;angle=direction*-12*p;}else if(t<1000){const p=Math.sin((t-850)/150*Math.PI);x=contact-direction*p*4;sx=1-p*.16;sy=1+p*.1;angle=direction*-12;}else{const elapsed=(t-1000)/1000,spring=1-Math.exp(-7.8*elapsed)*(Math.cos(12*elapsed)+7.8/12*Math.sin(12*elapsed));x=contact+(end-contact)*spring;y=-Math.sin(Math.min(elapsed,1)*Math.PI)*14;angle=direction*(-12+20*spring);}return{transform:`translate(${x}px,${y}px) rotate(${angle}deg) scale(${sx},${sy})`,opacity:Math.min(t/100,1),offset:i/180};});
        frames[180]={transform:`translate(${end}px,0) rotate(${direction*8}deg)`,opacity:1,offset:1};animate(mascot,frames,{duration:2260,easing:'linear',fill:'backwards'});
      });
      animate(root.querySelector('.cover-brand-title'),[{opacity:0,transform:'scale(.78) rotate(-2deg)'},{opacity:1,transform:'scale(1.045) rotate(.8deg)',offset:.46},{opacity:1,transform:'scale(.98) rotate(-.4deg)',offset:.73},{opacity:1,transform:'scale(1) rotate(0)'}],{delay:1000,duration:1010,fill:'backwards',easing:'cubic-bezier(.2,.75,.2,1)'});
      root.querySelectorAll('.cover-title-half').forEach((element,side)=>{const d=side?-1:1;animate(element,[{translate:`${d*-104}px 0`,opacity:0,scale:.93},{translate:`${d*10}px 0`,opacity:1,scale:1.05,offset:.44},{translate:`${d*-3}px 0`,opacity:1,scale:.99,offset:.72},{translate:'0 0',opacity:1,scale:1}],{delay:1020,duration:930,fill:'backwards',easing:'cubic-bezier(.22,.75,.25,1)'});});
      animate(root.querySelector('.cover-english'),[{opacity:0,translate:'0 10px'},{opacity:1,translate:'0 0'}],{delay:1430,duration:590,fill:'backwards'});
      animate(root.querySelector('.cover-collision-star'),[{opacity:0,scale:.3},{opacity:1,scale:1,offset:.25},{opacity:0,scale:1.8}],{delay:815,duration:550,fill:'backwards'});
    }
    function pointer(event:PointerEvent){if(!motionEnabled)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!root)return;const x=event.clientX/innerWidth-.5,y=event.clientY/innerHeight-.5;root.style.setProperty('--look-x',x*11+'px');root.style.setProperty('--look-y',y*8+'px');root.style.setProperty('--eye-x',x*3+'px');root.style.setProperty('--eye-y',y*2+'px');});}
    window.addEventListener('pointermove',pointer,{passive:true});
    return()=>{animations.forEach(animation=>animation.cancel());cancelAnimationFrame(frame);window.removeEventListener('pointermove',pointer);for(const name of ['--look-x','--look-y','--eye-x','--eye-y'])root.style.removeProperty(name);};
  },[motionEnabled,replay]);
  return <div className="cover-stage" ref={stage}>
    <svg className="cover-routes" viewBox="0 0 1100 330" preserveAspectRatio="none" aria-hidden="true"><path d="M115 175c80-140 160-60 135 15s-100-35 0-95M965 170c-80-130-160-60-135 15s100-35 0-95"/></svg>
    <Toy kind="book" label="一起进步"/><Toy kind="plane" label="让想法飞一会儿"/><Toy kind="game" label="快乐开局"/><Toy kind="mountain" label="一起去吹风"/>
    <span className="cover-handnote note-left">你的奇思妙想</span><span className="cover-handnote note-right">我的跃跃欲试</span>
    <div className="cover-mascot mascot-left"><StudentArtwork kind="pink"/></div><div className="cover-mascot mascot-right"><StudentArtwork kind="violet"/></div>
    <Sparkles className="cover-collision-star" size={62} aria-hidden="true"/>
    <div className="cover-parallax"><h1 className="cover-brand-title"><button type="button" aria-label="碰个头，点击重播标题动画" onClick={()=>setReplay(value=>value+1)}><span className="cover-title-half title-tile" aria-hidden="true">碰</span><span className="cover-title-half title-word" aria-hidden="true">个头</span></button><span className="sr-only">碰个头</span></h1><p className="cover-english">Campus Together<svg viewBox="0 0 300 16" aria-hidden="true"><path d="M3 7q140-12 294 1M68 14l170-4"/></svg></p></div>
    <p className="cover-meet-note">刚好，碰到你。</p><button type="button" className="cover-replay text-button" onClick={()=>setReplay(value=>value+1)}><RotateCcw size={15} aria-hidden="true"/>再碰一次</button>
  </div>;
}
export function Landing(){
  const {user}=useAuth();
  return <section className="landing-cover" aria-label="碰个头品牌首页"><p className="cover-intro">奇思妙想，在这里碰头。</p><CoverTitle/><div className="cover-story"><h2>把喜欢的事，和同频的人一起做。</h2><p>一个项目，一场自习，一局游戏，或一阵周末的风。</p><div className="cover-actions"><Link className="button cover-primary" to={user?'/discover':'/login'}>{user?'继续碰个头':'开始碰个头'}<ArrowUpRight size={22} aria-hidden="true"/></Link><Link className="text-button" to={user?'/discover?panel=interests':'/register'}>{user?'去圆桌聊聊':'第一次来？认识一下'}<ArrowUpRight size={17} aria-hidden="true"/></Link></div><p className="cover-pointer-hint">挪挪鼠标，小家伙们在看你。插画也可以拖着玩。</p></div></section>;
}
