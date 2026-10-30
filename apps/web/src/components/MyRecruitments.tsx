import {SoftDisclosure} from './SoftDisclosure';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { RecruitmentDTO } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Loading } from './UI';

export function MyRecruitments() {
  const { user } = useAuth();
  const result = useQuery({ queryKey: ['my-recruitments', user?.id], queryFn: ({ signal }) => api<RecruitmentDTO[]>('/me/recruitments', { signal }), enabled: !!user });
  if (!user) return null;
  const published = result.data?.data.filter(r => r.publicationStatus === 'PUBLISHED') || [];
  return <section className="my-drafts" aria-label="我发起的招募"><SoftDisclosure title={<>我发起的招募{published.length ? ` (${published.length})` : ''}</>}>{result.isPending ? <Loading label="正在读取我的招募……" /> : result.isError ? <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} /> : !published.length ? <p className="form-note">还没有已发布的招募。发布后可在这里进入队长审核。</p> : <div className="draft-list">{published.map(row => <Link className="draft-row" to={'/recruitments/' + row.id} key={row.id}><span><strong>{row.title}</strong><span>{row.team?.memberCount} / {row.draft.capacity} 人 · {row.team?.acceptingStatus === 'OPEN' ? '招募中' : row.team?.acceptingStatus === 'FULL' ? '当前已满' : '招募已停止'}</span></span><span>查看招募与审核 →</span></Link>)}</div>}<p className="field-note">显示最近 50 条本人招募中的已发布内容，不受浏览学校筛选影响。</p></SoftDisclosure></section>;
}
