import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, RefreshCw, AlertTriangle, LockKeyhole } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useReducedMotion, animate } from 'motion/react';
import { useRef } from 'react';
import type { PointerEvent } from 'react';
import {StudentArtwork} from './visual/StudentArtwork';

export function Loading({ label = '正在加载……' }: { label?: string }) { return <div className="state" role="status"><span className="loading-mark" aria-hidden="true" /><p>{label}</p></div>; }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div className="state state-error" role="alert"><AlertTriangle size={28} aria-hidden="true" /><h2>这次没能加载成功</h2><p>{message}</p>{retry && <button className="button secondary" onClick={retry}><RefreshCw size={17} />重新加载</button>}</div>; }
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) { return <div className="state"><StudentArtwork className="empty-student" kind="blue" pose="think"/><h2>{title}</h2>{children}</div>; }
export function LoginGate({ next = '/publish' }: { next?: string }) { return <div className="state"><LockKeyhole size={30} /><h2>先碰个头，再开始</h2><p>登录后可以发布讨论、完善资料。</p><Link className="button" to={'/login?next=' + encodeURIComponent(next)}>去登录<ArrowUpRight size={18} /></Link></div>; }
export function PageTitle({ title, eyebrow, back }: { title: string; eyebrow?: string; back?: () => void }) {
  const {pathname}=useLocation();
  const companion=pathname.startsWith('/recruitments')?'green':pathname==='/publish'?'violet':pathname==='/messages'?'blue':pathname==='/me'?'pink':null;
  return <div className="page-title">{back && <button className="icon-button" onClick={back} aria-label="返回上一页"><ArrowLeft aria-hidden="true" /></button>}<div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1></div>{companion&&<StudentArtwork className="page-companion" kind={companion} pose={companion==='violet'?'think':'wave'}/>}</div>;
}
export function FormError({ children }: { children?: ReactNode }) { return children ? <p className="form-error" role="alert">{children}</p> : null; }
export function SectionLink({target,children,className}:{target:string;children:ReactNode;className?:string}) {
  const location=useLocation(),navigate=useNavigate(),reduce=useReducedMotion();
  return <a className={className} href={'#'+target} onClick={event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    // Replace only the fragment so Back still returns to the original discussion card.
    navigate({pathname:location.pathname,search:location.search,hash:'#'+target},{replace:true,state:location.state});
    document.getElementById(target)?.scrollIntoView({block:'start',behavior:reduce?'instant':'smooth'});
  }}>{children}</a>;
}
export function SwipePanel({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  const x = useMotionValue(0), reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null), gesture = useRef<{ id: number; startX: number; startY: number; active: boolean } | null>(null), animation = useRef<ReturnType<typeof animate> | null>(null);
  function start(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.clientX - e.currentTarget.getBoundingClientRect().left > 25 || (e.target as HTMLElement).closest('button,a,input,textarea,select')) return;
    animation.current?.stop(); gesture.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, active: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current; if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    if (!g.active && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesture.current = null; return; }
    if (dx > 5) g.active = true;
    if (g.active) x.set(Math.max(0, dx));
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancelled = false) {
    const g = gesture.current; if (!g || g.id !== e.pointerId) return;
    if (!cancelled) move(e);
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancelled && g.active && x.get() > (ref.current?.clientWidth || 320) * .24) {
      if (reduce) onBack(); else animation.current = animate(x, (ref.current?.clientWidth || 400) + 25, { duration: .2, ease: [.2, .8, .2, 1], onComplete: onBack });
    } else if (reduce) x.set(0); else animation.current = animate(x, 0, { type: 'spring', stiffness: 440, damping: 34 });
  }
  return <motion.div ref={ref} className="swipe-panel" data-testid="swipe-panel" style={{ x }} initial={reduce ? false : { opacity: .4, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .26 }} onPointerDown={start} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => { if (gesture.current?.id === e.pointerId && e.target === e.currentTarget) finish(e, true); }}>{children}</motion.div>;
}
