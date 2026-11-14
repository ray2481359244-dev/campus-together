import type { RecruitmentDraft } from './recruitments.js';

const scenes = {
  GAME: { capacity: '队友名额', guest: '队友', slot: '队友类型', join: '加入这局', apply: '申请一起玩', details: '开局安排', start: '开局时间', end: '预计结束时间', place: '桌游地点' },
  STUDY: { capacity: '搭子名额', guest: '学习搭子', slot: '搭子类型', join: '一起学', apply: '申请一起学', details: '学习安排', start: '约定开始时间', end: '约定结束时间', place: '学习地点' },
  COMPETITION: { capacity: '队友名额', guest: '队友', slot: '分工', join: '确认直接加入', apply: '申请加入', details: '赛事与协作安排', start: '协作开始时间', end: '协作结束时间', place: '协作地点' },
  OUTDOOR: { capacity: '同行名额', guest: '同行伙伴', slot: '同行类型', join: '加入行程', apply: '申请同行', details: '行程与集合安排', start: '出发时间', end: '预计返回时间', place: '公开集合区域' },
};
export const recruitmentCopy = (category: RecruitmentDraft['category']) => scenes[category];

export function hasNamedSeats(slots: { name: string; requiredSkills: string[] }[]) {
  return slots.length > 1 || slots.some(slot => slot.name !== '成员' || slot.requiredSkills.length > 0);
}

export function isTabletop(draft: RecruitmentDraft) {
  return draft.category === 'GAME' && (draft.mode === 'OFFLINE' || draft.game?.server === '线下桌游，无服务器限制');
}

export function gameRequirements(draft: RecruitmentDraft) {
  const game = draft.category === 'GAME' ? draft.game : undefined;
  return {
    server: !!game && !!game.server && game.server !== '不限' && game.server !== '线下桌游，无服务器限制' && (draft.plan?.serverRequired ?? true),
    platform: !!game && game.platform !== 'ANY' && (draft.plan?.platformRequired ?? true),
  };
}
