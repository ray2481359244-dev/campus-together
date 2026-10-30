import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, RegisterSchema } from '@campus/contracts';
import type { MeDTO } from '@campus/contracts';
import { ArrowUpRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useSchool } from '../lib/school';
import { api, messageOf } from '../lib/api';
import { PageTitle, FormError, Loading, ErrorState } from '../components/UI';
import {StudentArtwork} from '../components/visual/StudentArtwork';

export function AuthPage({ registerMode = false }: { registerMode?: boolean }) {
  const { accept, loading, error: authError, reload } = useAuth(), { schools, schoolsLoading, schoolsError, reloadSchools } = useSchool(), navigate = useNavigate(), [params] = useSearchParams();
  const [error, setError] = useState('');
  const nextParam = params.get('next') || '/discover';
  const next = /^\/(?!\/)/.test(nextParam) && !nextParam.includes('\\') ? nextParam : '/discover';
  const submit = async (values: unknown) => {
      setError('');
      try { const r = await api<{ user: MeDTO; csrfToken: string }>(registerMode ? '/auth/register' : '/auth/login', { method: 'POST', body: values }); accept(r.data.user, r.data.csrfToken); navigate(next, { replace: true }); }
      catch (e) { setError(messageOf(e)); }
  };
  if (loading) return <Loading label="正在确认登录状态……" />;
  if (authError) return <ErrorState message={authError.message} retry={() => void reload()} />;
  return <section className="auth-page"><aside className="auth-story" aria-label="从一句一起吗开始"><span>从一句「一起吗」开始。</span><h2>先碰个头，<br/>再一起行动。</h2><p>你的奇思妙想，<br/>会有人和你一起认真。</p><StudentArtwork kind={registerMode?'pink':'blue'} pose={registerMode?'cheer':'default'}/><small>不必很厉害才开始。</small></aside><div className="auth-main">
    <nav className="auth-mode-nav" aria-label="账号方式"><Link to={'/login?next='+encodeURIComponent(next)} aria-current={!registerMode?'page':undefined}>登录</Link><Link to={'/register?next='+encodeURIComponent(next)} aria-current={registerMode?'page':undefined}>注册</Link></nav>
    <PageTitle title={registerMode ? '认识一下，同频的你。' : '欢迎回来，继续一起做。'} />
    {registerMode ? schoolsError?<ErrorState message="暂时无法读取学校列表，请重试。" retry={reloadSchools}/>:schoolsLoading?<Loading label="正在读取学校列表……"/>:<RegistrationForm schools={schools} submit={submit} error={error} next={next} /> : <LoginForm submit={submit} error={error} next={next} />}
    <div className="under-note"><strong>从一个真实的问题开始。</strong><p>先聊聊你的兴趣，再找到一起行动的人。</p></div></div>
  </section>;
}
type FormProps = { submit: (values: unknown) => Promise<void>; error: string; next: string };
function Credentials({ email, password, signup, emailError, passwordError }: { email: UseFormRegisterReturn; password: UseFormRegisterReturn; signup: boolean; emailError: boolean; passwordError: boolean }) {
  const [visible,setVisible]=useState(false);
  return <><label htmlFor="auth-email">邮箱</label><input id="auth-email" type="email" autoComplete="email" spellCheck={false} aria-invalid={emailError} aria-describedby={emailError?'auth-email-error':undefined} maxLength={254} {...email} placeholder="you@example.com" />{emailError && <div id="auth-email-error"><FormError>请输入有效的邮箱地址。</FormError></div>}<label htmlFor="auth-password">密码</label><div className="auth-password"><input id="auth-password" type={visible?'text':'password'} autoComplete={signup ? 'new-password' : 'current-password'} aria-invalid={passwordError} aria-describedby={passwordError?'auth-password-error':undefined} maxLength={128} {...password} /><button type="button" aria-label={visible?'隐藏密码':'显示密码'} aria-pressed={visible} onClick={()=>setVisible(value=>!value)}>{visible?<EyeOff size={19} aria-hidden="true"/>:<Eye size={19} aria-hidden="true"/>}</button></div>{passwordError && <div id="auth-password-error"><FormError>{signup ? '密码需要 10—128 位。' : '请输入密码。'}</FormError></div>}</>;
}
function FormEnd({ signup, error, pending, next }: { signup: boolean; error: string; pending: boolean; next: string }) {
  return <><FormError>{error}</FormError><button type="submit" className="button wide" disabled={pending}>{pending ? '正在处理……' : signup ? '创建账号，开始碰个头' : '登录'}<ArrowUpRight size={19} /></button><p className="form-note">邮箱仅作登录标识，当前不提供邮件核验。学校与技能均由本人填写，不代表校方认证。</p><p className="auth-switch">{signup ? '已经有账号？' : '第一次来？'} <Link to={(signup ? '/login' : '/register') + '?next=' + encodeURIComponent(next)}>{signup ? '去登录' : '创建账号'}</Link></p></>;
}
function LoginForm({ submit, error, next }: FormProps) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(LoginSchema) });
  return <form className="paper form-stack" aria-busy={isSubmitting} onSubmit={handleSubmit(submit)}><Credentials email={register('email')} password={register('password')} signup={false} emailError={!!errors.email} passwordError={!!errors.password} /><FormEnd signup={false} error={error} pending={isSubmitting} next={next} /></form>;
}
function RegistrationForm({ schools, submit, error, next }: FormProps & { schools: { id: string; name: string }[] }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(RegisterSchema) });
  return <form className="paper form-stack" onSubmit={handleSubmit(submit)}><Credentials email={register('email')} password={register('password')} signup emailError={!!errors.email} passwordError={!!errors.password} /><label>昵称<input autoComplete="nickname" maxLength={20} placeholder="2—20 个字" {...register('nickname')} /></label>{errors.nickname && <FormError>昵称需要 2—20 个字。</FormError>}<label>学校（自述）<select {...register('schoolId')} defaultValue=""><option value="" disabled>请选择学校</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{errors.schoolId && <FormError>请选择学校。</FormError>}<FormEnd signup error={error} pending={isSubmitting} next={next} /></form>;
}
