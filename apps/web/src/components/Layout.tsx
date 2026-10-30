import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { Grid2X2, Users, Plus, MessageSquare, UserRound, ArrowUpRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {useSchool} from '../lib/school';
export {useSchool} from '../lib/school';
import { useNotificationSummary } from '../lib/notifications';
import { NotificationToast } from './NotificationToast';

export function Layout() {
  const { user } = useAuth(), reduce = useReducedMotion(), location = useLocation();
  const {schoolId,setSchoolId,schools:schoolList,schoolsLoading,schoolsError,reloadSchools}=useSchool();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ appMode: string }>('/health') });
  const summary=useNotificationSummary(user?.id),unread=summary.data?.data.unreadCount||0;
  const reading=/^\/posts\/[^/]+$/.test(location.pathname),composing=location.pathname==='/publish'||/^\/posts\/[^/]+\/edit$/.test(location.pathname);
  const selected=(to:string,isActive:boolean)=>isActive||(to==='/discover'&&reading)||(to==='/publish'&&composing);
  const badge=unread>0?<span className="unread-badge" aria-label={unread+' 条未读消息'}>{unread>99?'99+':unread}</span>:null;
  const nav = [{ to: '/discover', title: '发现', icon: Grid2X2 }, { to: '/recruitments', title: '招募', icon: Users }, { to: '/publish', title: '发布', icon: Plus }, { to: '/messages', title: '消息', icon: MessageSquare }, { to: '/me', title: '我的', icon: UserRound }];
  return <><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); const main = document.getElementById('main-content'); main?.focus({ preventScroll: true }); main?.scrollIntoView({ block: 'start', behavior: 'instant' }); }}>跳到主要内容</a><div className="app-shell cloud-platform">
    <aside className="sidebar"><Link className="brand" to="/discover" aria-label="碰个头首页"><span className="brand-mark">碰</span><span>碰个头<small>CAMPUS TOGETHER</small></span></Link><div className="sidebar-line" /><p className="sidebar-note">把喜欢的事，<br />一起做。</p><nav className="desktop-nav" aria-label="桌面主导航">{nav.map(({ to, title, icon: Icon }) => <NavLink to={to} key={to} className={({ isActive }) => 'nav-item' + (selected(to,isActive) ? ' selected' : '')}><Icon size={21} /><span>{title}</span>{to==='/messages'&&badge}<ArrowUpRight size={15} className="nav-arrow" /></NavLink>)}</nav><div className="sidebar-bottom"><span className="serial">INTERESTS → ACTION</span><p>学校与技能均为自述<br />以真实协作，连接彼此。</p></div></aside>
    <div className="workspace"><header className="topbar"><Link className="mobile-brand" to="/discover"><span className="brand-mark">碰</span><strong>碰个头</strong></Link><div className="school-control"><label htmlFor="browse-school">浏览学校</label><select id="browse-school" value={schoolId} onChange={e => setSchoolId(e.target.value)} disabled={schoolsLoading}>{schoolsLoading && <option>正在加载学校……</option>}{schoolList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="topbar-account">{user ? <Link className="account-link" to="/me"><span className="avatar">{user.nickname.slice(0, 1)}</span><span>{user.nickname}</span></Link> : <Link className="button compact" to={'/login?next=' + encodeURIComponent(location.pathname + location.search)}>登录 / 注册<ArrowUpRight size={16} /></Link>}</div></header>
    {health.data?.data.appMode === 'DEMO' && <div className="demo-banner"><span>DEMO</span>本地演示环境 · 学校与示例人物均为虚构，新增内容会真实保存。</div>}
    {schoolsError && <div className="inline-error" role="alert">学校加载失败。<button onClick={reloadSchools}>重试</button></div>}
    <main id="main-content" className={'main-content'+(reading?' reading-mode':composing?' composing-mode':'')} tabIndex={-1}><Outlet /></main><footer className="page-footer">CAMPUS TOGETHER / 从兴趣出发，向行动靠近。</footer></div>
    <NotificationToast summary={summary.data?.data} userId={user?.id} />
    <nav className="mobile-nav" aria-label="手机主导航">{nav.map(({ to, title, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => 'mobile-nav-item' + (selected(to,isActive) ? ' selected' : '')}>{({ isActive }) => <>{selected(to,isActive) && <motion.span className="mobile-nav-indicator" layoutId="mobile-nav" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 440, damping: 34 }} />}<Icon size={21} /><span>{title}</span>{to==='/messages'&&badge}</>}</NavLink>)}</nav>
  </div></>;
}
