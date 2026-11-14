import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { categoryInfo, NicknameSchema, ProfileDetailsSchema } from '@campus/contracts';
import type { MeDTO, ProfileActivityDTO, PublicProfileDTO } from '@campus/contracts';
import { ArrowLeft, ArrowUpRight, Bookmark, Camera, Check, LogOut, Pencil, Settings, Users } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { StudentAvatar } from '../components/visual/StudentArtwork';
import { ContactAction } from '../components/ContactAction';
import { ContactPreferences } from '../components/ContactPreferences';
import { ProfileAlbum } from '../components/ProfileAlbum';
import { AvatarEditor } from '../components/AvatarEditor';
import { SoftDisclosure } from '../components/SoftDisclosure';
import { ErrorState, FormError, Loading, LoginGate } from '../components/UI';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSchool } from '../lib/school';
import { postProfileSource } from '../lib/profile-link';
import '../profile.css';

export function Profile() {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (auth.error) return <ErrorState message={auth.error.message} retry={() => void auth.reload()} />;
  if (!auth.user) return <LoginGate next="/me" />;
  return <OwnProfile key={auth.user.id} user={auth.user} />;
}

function OwnProfile({ user }: { user: MeDTO }) {
  const [renaming, setRenaming] = useState(false);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const location = useLocation(), navigate = useNavigate();
  const [editing, setEditing] = useState(() => new URLSearchParams(location.search).has('edit'));
  const [notice, setNotice] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const auth = useAuth();
  const renameButton = useRef<HTMLButtonElement>(null);
  const avatarButton = useRef<HTMLButtonElement>(null);
  const closeRename = () => { setRenaming(false); renameButton.current?.focus(); };
  const closeAvatar = () => { setEditingAvatar(false); avatarButton.current?.focus(); };
  return <section className="campus-profile" aria-label="我的主页">
    {location.state?.fromProfileLink && <button className="text-button" type="button" onClick={() => navigate(-1)}><ArrowLeft size={17} aria-hidden="true" />返回帖子</button>}
    <ProfileHeader person={user} avatarAction={<button ref={avatarButton} className="profile-avatar-button" type="button" aria-label="更换头像"
      aria-expanded={editingAvatar} aria-controls="edit-avatar" onClick={() => { setEditingAvatar(true); setNotice(''); }}>
      <StudentAvatar seed={user.id} version={user.avatarVersion} /><span className="avatar-camera"><Camera size={16} aria-hidden="true" /></span>
    </button>}>
      <button ref={renameButton} className="button secondary" type="button" aria-expanded={renaming} aria-controls="rename-profile"
        onClick={() => { setRenaming(value => !value); setNotice(''); }}><Pencil size={16} aria-hidden="true" />改昵称</button>
      <button className="button" type="button" aria-expanded={editing} aria-controls="profile-details"
        onClick={() => setEditing(value => !value)}>{editing ? '收起编辑' : '编辑主页'}</button>
    </ProfileHeader>
    {notice && <p className="success-notice" role="status">{notice}</p>}
    <div id="edit-avatar" hidden={!editingAvatar}>{editingAvatar && <AvatarEditor user={user} close={closeAvatar}
      saved={message => { closeAvatar(); setNotice(message); }} />}</div>
    <div id="rename-profile" hidden={!renaming}>{renaming && <NicknameEditor user={user} saved={() => { closeRename(); setNotice('昵称已更新。'); }}
      cancel={closeRename} />}</div>
    <div id="profile-details" hidden={!editing}><ProfileDetails key={user.id} user={user} /></div>
    <nav className="profile-shortcuts" aria-label="我的常用入口">
      <Link to="/messages?filter=team"><Users size={19} aria-hidden="true" />我的队伍</Link>
      <Link to="/saved"><Bookmark size={18} aria-hidden="true" />我的收藏</Link>
      <Link to="/topic-requests">我的申请与举报<ArrowUpRight size={15} aria-hidden="true" /></Link>
      {user.role === 'ADMIN' && <Link to="/admin">社区管理<ArrowUpRight size={15} aria-hidden="true" /></Link>}
    </nav>
    <div className="profile-main">
      <ProfileAlbum ownerId={user.id} viewerId={user.id} />
      <ProfileActivity userId={user.id} own />
    </div>
    <section className="profile-settings">
      <SoftDisclosure title={<><Settings size={17} aria-hidden="true" />账号与消息设置</>}>
        <div className="profile-settings-content">
          <div><h2>登录邮箱</h2><p>{user.email}</p><p className="form-note">仅自己可见 · 邮箱未验证</p></div>
          <ContactPreferences userId={user.id} />
          <FormError>{logoutError}</FormError>
          <button className="button secondary" disabled={loggingOut} onClick={async () => {
            setLoggingOut(true); setLogoutError('');
            try { await auth.logout(); } catch (error) { setLogoutError(messageOf(error)); } finally { setLoggingOut(false); }
          }}><LogOut size={17} aria-hidden="true" />{loggingOut ? '正在退出……' : '退出登录'}</button>
        </div>
      </SoftDisclosure>
    </section>
  </section>;
}

export function VisitorProfile() {
  const { userId } = useParams(), auth = useAuth(), location = useLocation(), navigate = useNavigate();
  const result = useQuery({
    queryKey: ['profile', userId, auth.user?.id], enabled: !!auth.user && auth.user.id !== userId, retry: false,
    queryFn: ({ signal }) => api<PublicProfileDTO>('/profiles/' + userId, { signal }),
  });
  if (!auth.user) return <LoginGate next={location.pathname} />;
  if (auth.user.id === userId) return <Navigate replace to="/me" />;
  const back = location.state?.fromProfileLink
    ? <button className="text-button" type="button" onClick={() => navigate(-1)}><ArrowLeft size={17} aria-hidden="true" />返回上一页</button>
    : <Link className="text-button" to="/discover"><ArrowLeft size={17} aria-hidden="true" />返回发现</Link>;
  if (result.isPending) return <Loading label="正在打开主页……" />;
  if (result.isError) return <>{back}<ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} /></>;
  const person = result.data.data, source = postProfileSource(location.state);
  return <section className="campus-profile" aria-label="同学主页">
    {back}
    <ProfileHeader person={person}>
      <ContactAction userId={person.id} nickname={person.nickname} className="button" source={source}
        sourceLabel={source?.commentId ? '附上这条评论' : '附上这篇帖子'} />
    </ProfileHeader>
    <div className="profile-main">
      <ProfileAlbum key={person.id} ownerId={person.id} viewerId={auth.user.id} />
      <ProfileActivity userId={person.id} own={false} />
    </div>
  </section>;
}

function ProfileHeader({ person, children, avatarAction }: { person: PublicProfileDTO; children: ReactNode; avatarAction?: ReactNode }) {
  return <header className="profile-hero">
    <div className="profile-identity">
      {avatarAction || <StudentAvatar seed={person.id} version={person.avatarVersion} />}
      <div>
        <h1>{person.nickname}</h1>
        <p className="profile-school">{person.school.name}（本人填写）{person.grade && ' · ' + person.grade}</p>
      </div>
    </div>
    <div className="profile-actions">{children}</div>
    {person.bio && <p className="profile-bio">{person.bio}</p>}
    {(person.skills.length > 0 || person.interests.length > 0) && <div className="profile-tags">
      {person.skills.length > 0 && <div><h2>擅长的事</h2><ul>{person.skills.map((skill, i) => <li key={i}>{skill}</li>)}</ul></div>}
      {person.interests.length > 0 && <div><h2>最近想一起做</h2><ul>{person.interests.map(category => <li className={'cat-' + category} key={category}>{categoryInfo[category].name}</li>)}</ul></div>}
    </div>}
  </header>;
}

function NicknameEditor({ user, saved, cancel }: { user: MeDTO; saved: () => void; cancel: () => void }) {
  const auth = useAuth();
  const [value, setValue] = useState(user.nickname), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return <form className="paper form-stack profile-editor" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    const nickname = NicknameSchema.safeParse(value);
    if (!nickname.success) { setError('昵称需要 2–20 个字。'); return; }
    setBusy(true); setError('');
    try {
      const { data } = await api<MeDTO>('/me/profile/nickname', { method: 'PATCH', body: { nickname: nickname.data } });
      auth.accept(data, undefined, 'nickname'); saved();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }}>
    <label>新昵称<input autoComplete="nickname" ref={input} value={value} maxLength={20}
      disabled={busy} onChange={event => { setValue(event.target.value); setError(''); }} /></label>
    <FormError>{error}</FormError>
    <div className="button-row"><button className="button" disabled={busy}>{busy ? '正在保存……' : '保存昵称'}</button>
      <button className="text-button" type="button" disabled={busy} onClick={cancel}>取消改名</button></div>
  </form>;
}

function ProfileDetails({ user }: { user: MeDTO }) {
  const auth = useAuth(), { schools } = useSchool();
  const [skills, setSkills] = useState(user.skills.join('，'));
  const [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(ProfileDetailsSchema), defaultValues: { schoolId: user.school.id, bio: user.bio, grade: user.grade, skills: user.skills, interests: user.interests },
  });
  const interests = watch('interests');
  return <form className="paper form-stack profile-editor" aria-label="编辑主页" onChange={() => setSaved(false)} onSubmit={handleSubmit(async values => {
    setError(''); setSaved(false);
    try {
      const { data } = await api<MeDTO>('/me/profile', { method: 'PATCH', body: values });
      auth.accept(data, undefined, 'details'); reset(values); setSkills(data.skills.join('，')); setSaved(true);
    } catch (e) { setError(messageOf(e)); }
  })}>
    <div className="form-row">
      <label>学校（本人填写）<select {...register('schoolId')}>
        {!schools.some(school => school.id === user.school.id) && <option value={user.school.id}>{user.school.name}</option>}
        {schools.map(school => <option value={school.id} key={school.id}>{school.name}</option>)}
      </select></label>
      <label>年级（可选）<input {...register('grade')} maxLength={20} placeholder="例如：大二" /></label>
    </div>
    {errors.schoolId && <FormError>请选择可用的学校。</FormError>}
    <label>一句话介绍自己<textarea {...register('bio')} rows={3} maxLength={300} placeholder="最近喜欢什么，想和大家一起做什么？" /></label>
    <div className="form-field">
      <label htmlFor="profile-skills">擅长的事</label>
      <input id="profile-skills" aria-describedby="profile-skills-note" maxLength={480} value={skills} placeholder="例如：带新手，拍照，讲题"
        onChange={event => {
          setSkills(event.target.value);
          setValue('skills', event.target.value.split(/[,，]/).map(entry => entry.trim()).filter(Boolean), { shouldDirty: true });
        }} />
      <span id="profile-skills-note" className="field-note">用逗号分隔，最多 15 项，每项不超过 30 个字。</span>
    </div>
    {errors.skills && <FormError>请检查标签数量与每项长度。</FormError>}
    <fieldset className="interest-fields"><legend>最近想一起做什么？</legend><div className="interest-options">
      {(['COMPETITION', 'STUDY', 'GAME', 'OUTDOOR'] as const).map(category => <button key={category} type="button"
        className={'interest-option cat-' + category} aria-pressed={interests.includes(category)} onClick={() => {
          setValue('interests', interests.includes(category) ? interests.filter(value => value !== category) : [...interests, category], { shouldDirty: true });
          setSaved(false);
        }}>{interests.includes(category) && <Check size={15} aria-hidden="true" />}{categoryInfo[category].name}</button>)}
    </div></fieldset>
    <FormError>{error}</FormError>{saved && <p className="success-text" role="status">资料已保存。</p>}
    <button className="button" type="submit" disabled={isSubmitting}>{isSubmitting ? '正在保存……' : '保存资料'}</button>
  </form>;
}

function ProfileActivity({ userId, own }: { userId: string; own: boolean }) {
  const result = useQuery({
    queryKey: ['profile-activity', userId], retry: false,
    queryFn: ({ signal }) => api<ProfileActivityDTO[]>('/profiles/' + userId + '/activity', { signal }),
  });
  return <section className="paper profile-panel">
    <h2>{own ? '我的动态' : '最近动态'}</h2>
    {result.isPending ? <Loading label="正在读取动态……" />
      : result.isError ? <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} />
      : result.data.data.length ? <ul className="profile-activity">{result.data.data.map(activity => <li key={activity.id}>
        <Link to={(activity.type === 'POST' ? '/posts/' : '/recruitments/') + activity.id}>
          <small>{activity.type === 'POST' ? '讨论' : '招募'}</small><strong>{activity.title}</strong><ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </li>)}</ul> : <p className="form-note">还没有公开的讨论或招募。</p>}
  </section>;
}
