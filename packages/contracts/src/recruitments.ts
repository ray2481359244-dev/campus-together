import { z } from 'zod';

const Id = z.uuid();
const Skills = z.array(z.string().trim().min(1).max(30)).max(15);
export const RecruitmentDraftSchema = z.object({
  category: z.literal('COMPETITION').default('COMPETITION'),
  topicId: Id.nullable().default(null), sourcePostId: Id.nullable().default(null),
  title: z.string().trim().max(60).default(''), description: z.string().trim().max(3000).default(''),
  mode: z.enum(['ONLINE', 'OFFLINE']).default('ONLINE'), locationPublic: z.string().trim().max(120).default(''),
  allowCrossSchool: z.boolean().default(false), joinMode: z.literal('APPROVAL').default('APPROVAL'),
  startAt: z.iso.datetime({ offset: true }).nullable().default(null),
  endAt: z.iso.datetime({ offset: true }).nullable().default(null),
  joinDeadline: z.iso.datetime({ offset: true }).nullable().default(null),
  capacity: z.number().int().min(2).max(20).default(3), goal: z.string().trim().max(100).default(''),
  competitionName: z.string().trim().max(100).default(''), officialUrl: z.union([z.literal(''), z.url().max(500).refine(v => /^https?:\/\//i.test(v), '仅支持 http 或 https 链接')]).default(''),
  direction: z.string().trim().max(200).default(''), existingSkills: Skills.default([]),
  weeklyHours: z.number().int().min(1).max(60).default(5), collaboration: z.string().trim().max(300).default(''),
  competitionDeadline: z.iso.datetime({ offset: true }).nullable().default(null),
  slots: z.array(z.object({ key: Id, name: z.string().trim().max(30), capacity: z.number().int().min(1).max(20), requiredSkills: Skills.default([]) }).strict()).min(1).max(8),
  captainSlotKey: Id.nullable().default(null),
}).strict();
export type RecruitmentDraft = z.infer<typeof RecruitmentDraftSchema>;
export const PublishableRecruitmentSchema = RecruitmentDraftSchema.superRefine((v, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (!v.topicId) issue('topicId', '请选择竞赛主题');
  if (v.title.length < 5) issue('title', '标题需要 5—60 个字');
  if (v.description.length < 20) issue('description', '说明需要 20—3000 个字');
  for (const [key, name] of [['competitionName', '比赛名称'], ['direction', '项目方向'], ['goal', '目标'], ['collaboration', '协作时段说明']] as const) if (!v[key]) issue(key, `请填写${name}`);
  if (v.mode === 'OFFLINE' && !v.locationPublic) issue('locationPublic', '线下协作请填写粗粒度地点');
  if (!v.startAt || !v.endAt) issue('startAt', '请填写协作开始和结束时间');
  if (v.startAt && v.endAt && Date.parse(v.endAt) <= Date.parse(v.startAt)) issue('endAt', '结束时间须晚于开始');
  if (v.joinDeadline && v.startAt && Date.parse(v.joinDeadline) > Date.parse(v.startAt)) issue('joinDeadline', '招募截止不能晚于开始');
  if (!v.competitionDeadline) issue('competitionDeadline', '请填写比赛截止时间');
  if (v.competitionDeadline && v.startAt && Date.parse(v.competitionDeadline) < Date.parse(v.startAt)) issue('competitionDeadline', '比赛截止不能早于协作开始');
  if (v.slots.some(s => !s.name)) issue('slots', '每个岗位都需要名称');
  if (v.slots.reduce((sum, s) => sum + s.capacity, 0) !== v.capacity) issue('slots', '岗位人数之和必须等于总人数（含队长）');
  if (new Set(v.slots.map(s => s.key)).size !== v.slots.length || new Set(v.slots.map(s => s.name.normalize('NFKC').toLowerCase())).size !== v.slots.length) issue('slots', '岗位编号和名称不能重复');
  if (!v.slots.some(s => s.key === v.captainSlotKey)) issue('captainSlotKey', '请明确自己占据的岗位');
});
export const CreateRecruitmentSchema = z.object({ requestKey: Id, draft: RecruitmentDraftSchema }).strict();
export const UpdateRecruitmentSchema = z.object({ revision: z.number().int().positive(), draft: RecruitmentDraftSchema }).strict();
export const RecruitmentRevisionSchema = z.object({ revision: z.number().int().positive() }).strict();
export const RecruitmentsQuerySchema = z.object({ schoolId: Id, category: z.literal('COMPETITION').default('COMPETITION'), topicId: Id.optional(), q: z.string().trim().max(100).optional(), cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(30).default(12) }).strict();
export const RecruitmentCursorSchema = z.object({ publishedAt: z.iso.datetime(), id: Id }).strict();

export interface RecruitmentDTO {
  id: string; publicationStatus: 'DRAFT' | 'PUBLISHED'; revision: number; title: string; description: string;
  category: 'COMPETITION'; school: { id: string; name: string; isDemo: boolean }; topic: { id: string; name: string } | null;
  author: { id: string; nickname: string }; canEditDraft: boolean; sourceAvailable: boolean; createdAt: string; updatedAt: string; publishedAt: string | null;
  draft: RecruitmentDraft;
  team: null | { id: string; status: string; memberCount: number; capacity: number; captainUserId: string; acceptingStatus: 'OPEN' | 'CLOSED';
    slots: { id: string; name: string; capacity: number; occupied: number; requiredSkills: string[] }[]; chatAvailable: false };
}
