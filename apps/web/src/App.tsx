import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Discover } from './pages/Discover';
import { AuthPage } from './pages/Auth';
import { Publish } from './pages/Publish';
import { PostDetail } from './pages/PostDetail';
import { Profile } from './pages/Profile';
import { NextStage } from './pages/NextStage';
import { EmptyState } from './components/UI';
import { Link } from 'react-router-dom';

function CommunityRoutes() {
  const location = useLocation(), background = location.state?.backgroundLocation as Location | undefined;
  const overlay = !!background && /^\/posts\/[^/]+$/.test(location.pathname);
  return <div className={'route-stage' + (overlay ? ' with-overlay' : '')}><div className="route-base" inert={overlay} aria-hidden={overlay || undefined}>
    <Routes location={overlay ? background : location}><Route index element={<Navigate to="/discover" replace />} /><Route path="discover" element={<Discover />} /><Route path="login" element={<AuthPage key="login" />} /><Route path="register" element={<AuthPage key="register" registerMode />} /><Route path="publish" element={<Publish />} /><Route path="posts/:id" element={<PostDetail />} /><Route path="posts/:id/edit" element={<Publish edit />} /><Route path="me" element={<Profile />} /><Route path="recruitments" element={<NextStage kind="recruitments" />} /><Route path="messages" element={<NextStage kind="messages" />} /><Route path="*" element={<EmptyState title="这条路还没铺好"><Link className="button" to="/discover">回到首页</Link></EmptyState>} /></Routes>
  </div>{overlay && <div className="route-overlay"><PostDetail key={location.pathname} /></div>}</div>;
}
export function App() { return <Routes><Route element={<Layout />}><Route path="*" element={<CommunityRoutes />} /></Route></Routes>; }
