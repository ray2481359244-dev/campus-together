import {useRef} from 'react';
import {Link,Outlet,useLocation} from 'react-router-dom';
import {ArrowLeft,ArrowUpRight,X} from 'lucide-react';
import {MotionToggle} from '../lib/visual-preferences';
import {useAuth} from '../lib/auth';

export function PublicLayout(){
  const {pathname}=useLocation(),{user}=useAuth(),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
  return <div className="public-layout"><a className="skip-link" href="#public-main" onClick={event=>{event.preventDefault();document.getElementById('public-main')?.focus();}}>跳到主要内容</a>
    <header className="public-header"><Link className="brand" to="/" aria-label="碰个头封面"><span className="brand-mark">碰</span><span>碰个头<small>Campus Together</small></span></Link>
      {pathname==='/'?<nav aria-label="封面导航"><button className="text-button" ref={trigger} onClick={()=>dialog.current?.showModal()}>关于这里</button><Link className="button secondary public-login" to={user?'/discover':'/login'}>{user?'进入平台':'登录'}<ArrowUpRight size={18} aria-hidden="true"/></Link></nav>:<Link className="text-button" to="/"><ArrowLeft size={16} aria-hidden="true"/>返回封面</Link>}
    </header><main id="public-main" className="public-main" tabIndex={-1}><Outlet/></main>
    <footer className="public-footer"><span>从兴趣出发，向行动靠近。</span><MotionToggle/></footer>
    <dialog className="about-dialog" ref={dialog} onClose={()=>trigger.current?.focus()}><button className="icon-button dialog-close" aria-label="关闭关于这里" onClick={()=>dialog.current?.close()}><X aria-hidden="true"/></button><h2>好点子，总要碰一下。</h2><p>碰个头是一个校园兴趣协作社区。找到一起做项目、学习、开黑或去户外的同学，把一句「一起吗」变成一次行动。</p><p>学校与技能由本人填写；认真沟通，再决定一起出发。</p><button className="button" onClick={()=>dialog.current?.close()}>知道了，去碰个头<ArrowUpRight size={18} aria-hidden="true"/></button></dialog>
  </div>;
}
