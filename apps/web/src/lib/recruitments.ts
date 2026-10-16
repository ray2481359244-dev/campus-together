import { RecruitmentDraftSchema } from '@campus/contracts';
import type { RecruitmentDraft } from '@campus/contracts';
import { ApiError, messageOf } from './api';

export function emptyRecruitment(): RecruitmentDraft {
  const captain = crypto.randomUUID();
  return RecruitmentDraftSchema.parse({ slots: [{ key: captain, name: '项目统筹', capacity: 1 }, { key: crypto.randomUUID(), name: '开发伙伴', capacity: 2 }], captainSlotKey: captain });
}
export const splitSkills = (text: string) => [...new Set(text.split(/[,，]/).map(v => v.trim()).filter(Boolean))];
export const beijingTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '待填写';
export const beijingInput = (value: string | null) => value ? new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 16) : '';
export const fromBeijingInput = (value: string) => value ? new Date(value + (value.length === 16 ? ':00+08:00' : '+08:00')).toISOString() : null;
export const recruitmentError = (e: unknown) => e instanceof ApiError && e.fields ? Object.values(e.fields).flat().slice(0, 5).join('；') : messageOf(e);
