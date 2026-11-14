import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Discover } from './pages/Discover';
import { lazy, Suspense } from 'react';
import { EmptyState, Loading } from './components/UI';
import { Link } from 'react-router-dom';
import { ScrollRestoration } from './lib/scroll';
import {PublicLayout} from './components/PublicLayout';
import {AmbientField} from './components/visual/AmbientField';
import {useAuth} from './lib/auth';
import {ErrorState} from './components/UI';
import type {ReactNode} from 'react';
import {InteractionLayer} from './components/visual/InteractionLayer';
import {RouteArrival} from './components/visual/RouteArrival';
import { messageLink } from './lib/messaging';
import { activePostLocation } from './lib/profile-link';
const Landing=lazy(()=>import('./pages/Landing').then(module=>({default:module.Landing})));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const TopicRequests = lazy(() => import('./pages/TopicRequests').then(m => ({ default: m.TopicRequests })));
const Saved = lazy(() => import('./pages/Saved').then(m => ({ default: m.Saved })));
const Matching = lazy(() => import('./pages/Matching').then(m => ({ default: m.Matching })));
const AuthPage = lazy(() => import('./pages/Auth').then(m => ({ default: m.AuthPage })));
const Publish = lazy(() => import('./pages/Publish').then(m => ({ default: m.Publish })));
const PostDetail = lazy(() => import('./pages/PostDetail').then(m => ({ default: m.PostDetail })));
const Profile = lazy(() => import('./pages/Profile').then(m => ({ default: m.Profile })));
const VisitorProfile = lazy(() => import('./pages/Profile').then(m => ({ default: m.VisitorProfile })));
const Messages = lazy(() => import('./pages/Messages').then(m => ({ default: m.Messages })));
const Recruitments = lazy(() => import('./pages/Recruitments').then(m => ({ default: m.Recruitments })));
const RecruitmentEditor = lazy(() => import('./pages/RecruitmentEditor').then(m => ({ default: m.RecruitmentEditor })));
const RecruitmentDetail = lazy(() => import('./pages/RecruitmentDetail').then(m => ({ default: m.RecruitmentDetail })));

function LegacyTeamLink({ details = false }: { details?: boolean }) {
  const { id } = useParams(), location = useLocation();
  return <Navigate replace state={location.state} to={id
    ? messageLink({ kind: 'TEAM', id }, details ? 'details' : undefined, new URLSearchParams({ filter: 'team' }))
    : '/messages?filter=team'} />;
}

function CommunityRoutes() {
  const location = useLocation(), profileOrigin = activePostLocation(location), postLocation = profileOrigin || location;
  const background = postLocation.state?.backgroundLocation as Location | undefined;
  const overlay = !!background && /^\/posts\/[^/]+$/.test(postLocation.pathname);
  return <Suspense fallback={<Loading label="正在展开页面……" />}><RouteArrival path={postLocation.pathname} skip={overlay||postLocation.pathname.startsWith('/posts/')}><div className={'route-stage' + (overlay || profileOrigin ? ' with-overlay' : '')}><ScrollRestoration /><div className="route-base" inert={overlay || !!profileOrigin} aria-hidden={overlay || !!profileOrigin || undefined}>
    <Routes location={overlay ? background : postLocation}>
      <Route index element={<Navigate to="/discover" replace />} />
      <Route path="discover" element={<Discover />} />
      <Route path="login" element={<AuthPage key="login" />} />
      <Route path="register" element={<AuthPage key="register" registerMode />} />
      <Route path="publish" element={<Publish key="new" />} />
      <Route path="posts/:id" element={<PostDetail />} />
      <Route path="posts/:id/edit" element={<Publish key="edit" edit />} />
      <Route path="admin" element={<Admin />} />
      <Route path="topic-requests" element={<TopicRequests />} />
      <Route path="saved" element={<Saved />} />
      <Route path="me" element={<Profile />} />
      <Route path="profiles/:userId" element={<VisitorProfile />} />
      <Route path="recruitments" element={<Recruitments />} />
      <Route path="matching" element={<Matching />} />
      <Route path="recruitments/new" element={<RecruitmentEditor key="new" />} />
      <Route path="recruitments/:id/edit" element={<RecruitmentEditor />} />
      <Route path="recruitments/:id" element={<RecruitmentDetail />} />
      <Route path="teams" element={<LegacyTeamLink />} />
      <Route path="teams/:id" element={<LegacyTeamLink details />} />
      <Route path="teams/:id/chat" element={<LegacyTeamLink />} />
      <Route path="messages" element={<Messages />} />
      <Route path="*" element={<EmptyState title="这条路还没铺好"><Link className="button" to="/discover">回到首页</Link></EmptyState>} />
    </Routes>
  </div>{overlay && <div className="route-overlay" inert={!!profileOrigin} aria-hidden={!!profileOrigin || undefined}><Routes location={postLocation}><Route path="posts/:id" element={<PostDetail key={postLocation.pathname} />} /></Routes></div>}
  {profileOrigin && <div className="route-overlay profile-overlay"><Routes location={location}>
    <Route path="profiles/:userId" element={<VisitorProfile />} /><Route path="me" element={<Profile />} />
  </Routes></div>}</div></RouteArrival></Suspense>;
}
function RequireSession({children}:{children:ReactNode}){
  const auth=useAuth(),location=useLocation();
  if(auth.loading)return <div className="entry-state"><Loading label="正在确认登录状态……"/></div>;
  if(auth.error)return <div className="entry-state"><ErrorState message={auth.error.message} retry={()=>void auth.reload()}/></div>;
  if(!auth.user)return <Navigate to={'/login?next='+encodeURIComponent(location.pathname+location.search+location.hash)} replace/>;
  return children;
}
export function App() { return <><AmbientField/><InteractionLayer/><Suspense fallback={<div className="entry-state"><Loading label="正在展开页面……"/></div>}><Routes><Route element={<PublicLayout/>}><Route index element={<Landing/>}/><Route path="login" element={<AuthPage key="login"/>}/><Route path="register" element={<AuthPage key="register" registerMode/>}/></Route><Route element={<RequireSession><Layout/></RequireSession>}><Route path="*" element={<CommunityRoutes/>}/></Route></Routes></Suspense></>; }
