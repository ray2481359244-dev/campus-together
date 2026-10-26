import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ProfileSchema, categoryInfo } from '@campus/contracts';
import type { MeDTO } from '@campus/contracts';
import { ArrowUpRight, LogOut, Check } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useSchool } from '../components/Layout';
import { api, messageOf } from '../lib/api';
import { PageTitle, FormError, Loading, LoginGate, ErrorState } from '../components/UI';
import { Link } from 'react-router-dom';

export function Profile() {
  const auth = useAuth(), { schools } = useSchool(), [error, setError] = useState(''), [saved, setSaved] = useState(false), [loggingOut, setLoggingOut] = useState(false), [skillsText, setSkillsText] = useState('');
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(ProfileSchema), defaultValues: { nickname: '', bio: '', schoolId: '', grade: '', skills: [] as string[], interests: [] as MeDTO['interests'] } });
  const interests = watch('interests'), skills = watch('skills');
  useEffect(() => { if (auth.user) { reset({ nickname: auth.user.nickname, schoolId: auth.user.school.id, bio: auth.user.bio, grade: auth.user.grade, skills: auth.user.skills, interests: auth.user.interests }); setSkillsText(auth.user.skills.join('，')); } }, [auth.user, reset]);
  if (auth.loading) return <Loading />;
  if (auth.error) return <ErrorState message={auth.error.message} retry={() => void auth.reload()} />;
  if (!auth.user) return <LoginGate next="/me" />;
  return <section className="form-page"><PageTitle title="你好，同频的你。" eyebrow="THIS IS YOUR CORNER." />
    <Link className="button secondary my-teams-link" to="/teams">我的队伍 →</Link>
    <div className="profile-summary"><span className="avatar jumbo">{auth.user.nickname.slice(0, 1)}</span><div><h2>{auth.user.nickname}</h2><p>{auth.user.email}</p><span>邮箱未验证 · 学校与技能均为自述</span></div></div>
    <form className="paper form-stack" onChange={() => setSaved(false)} onSubmit={handleSubmit(async values => { setError(''); setSaved(false); try { const r = await api<MeDTO>('/me/profile', { method: 'PATCH', body: values }); auth.accept(r.data); setSaved(true); } catch (e) { setError(messageOf(e)); } })}>
      <div className="form-row"><label>昵称<input {...register('nickname')} maxLength={20} /></label><label>学校（自述）<select {...register('schoolId')}>{schools.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label></div>{(errors.nickname || errors.schoolId) && <FormError>昵称需要 2—20 个字，并选择有效学校。</FormError>}
      <label>年级（可选）<input {...register('grade')} maxLength={20} placeholder="例如：大二" /></label>
      <label>一句话介绍自己<textarea {...register('bio')} rows={3} maxLength={300} placeholder="你喜欢什么，最近想做什么？" /></label>
      <div className="form-field"><label htmlFor="profile-skills">自述技能</label><input id="profile-skills" aria-describedby="profile-skills-note" value={skillsText} maxLength={450} placeholder="例如：前端开发，摄影" onChange={e => { setSkillsText(e.target.value); setValue('skills', e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean), { shouldDirty: true }); }} /><span id="profile-skills-note" className="field-note">用逗号分隔，最多 15 项；每项不超过 30 个字。仅表示自述，不代表认证。</span></div>{errors.skills && <FormError>请检查技能数量和每项长度。</FormError>}
      <fieldset className="interest-fields"><legend>最近想一起做什么？</legend><div className="interest-options">{(['COMPETITION', 'STUDY', 'GAME', 'OUTDOOR'] as const).map(c => <button key={c} type="button" className={'interest-option cat-' + c} aria-pressed={interests.includes(c)} onClick={() => { setValue('interests', interests.includes(c) ? interests.filter(v => v !== c) : [...interests, c], { shouldDirty: true }); setSaved(false); }}>{interests.includes(c) && <Check size={15} />}{categoryInfo[c].name}</button>)}</div></fieldset>
      <FormError>{error}</FormError>{saved && <p className="success-text" role="status">资料已保存到账号，刷新后仍会保留。</p>}
      <button className="button wide" type="submit" disabled={isSubmitting}>{isSubmitting ? '正在保存……' : '保存资料'}<ArrowUpRight size={19} /></button>
    </form><div className="profile-bottom"><p>公开资料包含昵称、自述学校、兴趣与技能；登录邮箱仅本人可见。</p><button className="button secondary" disabled={loggingOut} onClick={async () => { setLoggingOut(true); try { await auth.logout(); } catch (e) { setError(messageOf(e)); } finally { setLoggingOut(false); } }}><LogOut size={17} />{loggingOut ? '正在退出……' : '退出登录'}</button></div>
  </section>;
}
