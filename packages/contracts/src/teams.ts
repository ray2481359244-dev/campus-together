import { z } from 'zod';

export const MyTeamsQuerySchema = z.object({ cursor: z.uuid().optional() }).strict();
export const LeaveTeamSchema = z.object({ revision: z.number().int().positive() }).strict();
export const RemoveMemberSchema = LeaveTeamSchema.extend({ reason: z.string().trim().min(1, '请填写移除原因').max(500) }).strict();
export const CloseRecruitmentSchema = z.object({ revision: z.number().int().positive(), reason: z.string().trim().max(500).default('') }).strict();
export const TeamActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TRANSFER'), revision: z.number().int().positive(), targetMemberId: z.uuid(), targetRevision: z.number().int().positive(), reason: z.string().trim().max(500).default('') }).strict(),
  z.object({ kind: z.enum(['START', 'COMPLETE', 'CANCEL']), revision: z.number().int().positive(), reason: z.string().trim().min(1, '请填写操作说明').max(500) }).strict()
]);
export type TeamActionInput = z.infer<typeof TeamActionSchema>;
export interface TeamActionDTO { id: string; teamId: string; kind: TeamActionInput['kind']; revision: number; status: string; captainUserId: string; expiredCount: number; reason: string; changedAt: string }
export interface TeamSummaryDTO {
  id: string; recruitmentId: string; title: string; captainUserId: string; status: string; closedAt: string | null;
  acceptingStatus: 'OPEN' | 'FULL' | 'CLOSED'; capacity: number; memberCount: number; recruitmentRevision: number;
  revision: number; startedAt: string | null; completedAt: string | null; cancelledAt: string | null;
  myMembership: { id: string; role: 'CAPTAIN' | 'MEMBER'; revision: number; slotName: string; joinedAt: string };
}
export interface TeamDetailDTO extends TeamSummaryDTO {
  canLeave: boolean; canClose: boolean; canStart: boolean; canComplete: boolean; canCancel: boolean;
  members: { id: string; userId: string; nickname: string; schoolName: string; skills: string[]; role: 'CAPTAIN' | 'MEMBER'; revision: number; slotName: string; joinedAt: string; canRemove: boolean; canTransfer: boolean }[];
}
export interface MyTeamsPageDTO { items: TeamSummaryDTO[]; nextCursor: string | null }
export interface MembershipChangeDTO { teamId: string; recruitmentId: string; memberId: string; status: 'LEFT' | 'REMOVED'; revision: number; reason: string; changedAt: string }
export interface RecruitmentClosureDTO { teamId: string; closedAt: string; expiredCount: number; reason: string }
