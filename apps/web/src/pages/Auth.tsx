import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, RegisterSchema } from '@campus/contracts';
import type { MeDTO } from '@campus/contracts';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useSchool } from '../components/Layout';
import { api, messageOf } from '../lib/api';
import { PageTitle, FormError, Loading, ErrorState } from '../components/UI';

export function AuthPage({ registerMode = false }: { registerMode?: boolean }) {
  const { accept, loading, error: authError, reload } = useAuth(), { schools } = useSchool(), navigate = useNavigate(), [params] = useSearchParams();
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
  return <section className="form-page auth-page"><PageTitle title={registerMode ? '认识一下，同频的你。' : '欢迎回来，继续一起做。'} eyebrow={registerMode ? 'NICE TO MEET YOU.' : 'GOOD TO SEE YOU AGAIN.'} />
    {registerMode ? <RegistrationForm schools={schools} submit={submit} error={error} next={next} /> : <LoginForm submit={submit} error={error} next={next} />}
    <div className="under-note"><strong>从一个真实的问题开始。</strong><p>先聊聊你的兴趣，再找到一起行动的人。</p></div>
  </section>;
}
type FormProps = { submit: (values: unknown) => Promise<void>; error: string; next: string };
function Credentials({ email, password, signup, emailError, passwordError }: { email: UseFormRegisterReturn; password: UseFormRegisterReturn; signup: boolean; emailError: boolean; passwordError: boolean }) {
  return <><label>邮箱<input type="email" autoComplete="email" maxLength={254} {...email} placeholder="you@example.com" /></label>{emailError && <FormError>请输入有效的邮箱地址。</FormError>}<label>密码<input type="password" autoComplete={signup ? 'new-password' : 'current-password'} maxLength={128} {...password} /></label>{passwordError && <FormError>{signup ? '密码需要 10—128 位。' : '请输入密码。'}</FormError>}</>;
}
function FormEnd({ signup, error, pending, next }: { signup: boolean; error: string; pending: boolean; next: string }) {
  return <><FormError>{error}</FormError><button type="submit" className="button wide" disabled={pending}>{pending ? '正在处理……' : signup ? '创建账号，开始碰个头' : '登录'}<ArrowUpRight size={19} /></button><p className="form-note">邮箱仅作登录标识，当前不提供邮件核验。学校与技能均由本人填写，不代表校方认证。</p><p className="auth-switch">{signup ? '已经有账号？' : '第一次来？'} <Link to={(signup ? '/login' : '/register') + '?next=' + encodeURIComponent(next)}>{signup ? '去登录' : '创建账号'}</Link></p></>;
}
function LoginForm({ submit, error, next }: FormProps) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(LoginSchema) });
  return <form className="paper form-stack" onSubmit={handleSubmit(submit)}><Credentials email={register('email')} password={register('password')} signup={false} emailError={!!errors.email} passwordError={!!errors.password} /><FormEnd signup={false} error={error} pending={isSubmitting} next={next} /></form>;
}
function RegistrationForm({ schools, submit, error, next }: FormProps & { schools: { id: string; name: string }[] }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(RegisterSchema) });
  return <form className="paper form-stack" onSubmit={handleSubmit(submit)}><Credentials email={register('email')} password={register('password')} signup emailError={!!errors.email} passwordError={!!errors.password} /><label>昵称<input autoComplete="nickname" maxLength={20} placeholder="2—20 个字" {...register('nickname')} /></label>{errors.nickname && <FormError>昵称需要 2—20 个字。</FormError>}<label>学校（自述）<select {...register('schoolId')} defaultValue=""><option value="" disabled>请选择学校</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{errors.schoolId && <FormError>请选择学校。</FormError>}<FormEnd signup error={error} pending={isSubmitting} next={next} /></form>;
}
