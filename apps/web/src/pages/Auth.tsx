import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, RegisterSchema } from '@campus/contracts';
import type { MeDTO } from '@campus/contracts';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useSchool } from '../components/Layout';
import { api, messageOf } from '../lib/api';
import { PageTitle, FormError } from '../components/UI';

export function AuthPage({ registerMode = false }: { registerMode?: boolean }) {
  const { accept } = useAuth(), { schools } = useSchool(), navigate = useNavigate(), [params] = useSearchParams();
  const [error, setError] = useState('');
  const nextParam = params.get('next') || '/discover';
  const next = /^\/(?!\/)/.test(nextParam) && !nextParam.includes('\\') ? nextParam : '/discover';
  const schema = registerMode ? RegisterSchema : LoginSchema;
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });
  return <section className="form-page auth-page"><PageTitle title={registerMode ? '认识一下，同频的你。' : '欢迎回来，继续一起做。'} eyebrow={registerMode ? 'NICE TO MEET YOU.' : 'GOOD TO SEE YOU AGAIN.'} />
    <form className="paper form-stack" onSubmit={handleSubmit(async values => {
      setError('');
      try { const r = await api<{ user: MeDTO; csrfToken: string }>(registerMode ? '/auth/register' : '/auth/login', { method: 'POST', body: values }); accept(r.data.user, r.data.csrfToken); navigate(next, { replace: true }); }
      catch (e) { setError(messageOf(e)); }
    })}>
      <label>邮箱<input type="email" autoComplete="email" maxLength={254} {...register('email')} placeholder="you@example.com" /></label>{errors.email && <FormError>请输入有效的邮箱地址。</FormError>}
      <label>密码<input type="password" autoComplete={registerMode ? 'new-password' : 'current-password'} maxLength={128} {...register('password')} /></label>{errors.password && <FormError>{registerMode ? '密码需要 10—128 位。' : '请输入密码。'}</FormError>}
      {registerMode && <RegisterFields register={register as never} schools={schools} errors={errors as Record<string, unknown>} />}
      <FormError>{error}</FormError><button type="submit" className="button wide" disabled={isSubmitting}>{isSubmitting ? '正在处理……' : registerMode ? '创建账号，开始碰个头' : '登录'}<ArrowUpRight size={19} /></button>
      <p className="form-note">邮箱仅作登录标识，当前不提供邮件核验。学校与技能均由本人填写，不代表校方认证。</p>
      <p className="auth-switch">{registerMode ? '已经有账号？' : '第一次来？'} <Link to={(registerMode ? '/login' : '/register') + '?next=' + encodeURIComponent(next)}>{registerMode ? '去登录' : '创建账号'}</Link></p>
    </form>
    <div className="under-note"><strong>从一个真实的问题开始。</strong><p>先聊聊你的兴趣，再找到一起行动的人。</p></div>
  </section>;
}
// Isolated registration fields preserve a single form with a conditional schema.
function RegisterFields({ register, schools, errors }: { register: (name: string) => object; schools: { id: string; name: string }[]; errors: Record<string, unknown> }) {
  return <><label>昵称<input maxLength={20} autoComplete="nickname" {...register('nickname')} placeholder="2—20 个字" /></label>{errors.nickname && <FormError>昵称需要 2—20 个字。</FormError>}<label>学校（自述）<select {...register('schoolId')} defaultValue=""><option value="" disabled>请选择学校</option>{schools.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>{errors.schoolId && <FormError>请选择学校。</FormError>}</>;
}
