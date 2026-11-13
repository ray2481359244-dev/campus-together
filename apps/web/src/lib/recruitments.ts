import { RecruitmentDraftSchema } from '@campus/contracts';
import type { RecruitmentDraft } from '@campus/contracts';
import { ApiError, messageOf } from './api';

export function emptyRecruitment(category: RecruitmentDraft['category'] = 'COMPETITION', capacity = 2): RecruitmentDraft {
  const captain = crypto.randomUUID();
  return RecruitmentDraftSchema.parse({
    category, capacity, slots: [{ key: captain, name: '成员', capacity }], captainSlotKey: captain,
    plan: { schedule: category === 'OUTDOOR' ? 'FIXED' : 'FLEXIBLE' }, weeklyHours: null,
    mode: category === 'OUTDOOR' ? 'OFFLINE' : 'ONLINE',
    joinMode: category === 'GAME' || category === 'STUDY' ? 'AUTO' : 'APPROVAL',
    ...(category === 'GAME' ? { game: { server: '', platform: 'ANY', playMode: '' } } : {}),
    ...(category === 'STUDY' ? { study: { subject: '', level: '', method: 'SELF', methodRequired: false, frequency: '' } } : {}),
    ...(category === 'OUTDOOR' ? { outdoor: { activity: '', region: '', budget: 0, distance: '', intensity: 'LOW', experience: '', equipment: '' } } : {}),
  });
}
export const splitSkills = (text: string) => [...new Set(text.split(/[,，]/).map(v => v.trim()).filter(Boolean))];
export const beijingTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '待填写';
export const beijingInput = (value: string | null) => value ? new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 16) : '';
export function fromBeijingInput(value: string) {
  const time = Date.parse(value + (value.length === 16 ? ':00+08:00' : '+08:00'));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function scheduleLabel(draft: RecruitmentDraft) {
  if (draft.plan?.schedule === 'RECURRING') return '长期招募，时段一起商量';
  if (!draft.startAt) return draft.category === 'OUTDOOR' ? '筹划中，时间待确认' : '时间待商量';
  const start = beijingTime(draft.startAt);
  return draft.endAt ? start + ' 至 ' + beijingTime(draft.endAt) : start + ' 开始';
}
export function budgetLabel(draft: RecruitmentDraft) {
  if (!draft.outdoor || draft.plan && !draft.plan.budgetKnown) return '费用待确认';
  return draft.outdoor.budget ? '每人 ' + draft.outdoor.budget + ' 元以内' : '免费';
}
export const recruitmentError = (e: unknown) => e instanceof ApiError && e.fields ? Object.values(e.fields).flat().slice(0, 5).join('；') : messageOf(e);

export const teamStatusLabel = (status: string) => ({ OPEN: '招募阶段', FULL: '已满员，待开始', IN_PROGRESS: '活动进行中', COMPLETED: '活动已结束', CANCELLED: '活动已取消', EXPIRED: '已截止，未开始' } as Record<string, string>)[status] || status;
