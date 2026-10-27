import { z } from 'zod';

export const SceneAnswersSchema = z.object({ server: z.string().trim().max(80).optional(), platform: z.enum(['PC','CONSOLE','MOBILE','ANY']).optional(), studyMethod: z.enum(['SELF','DISCUSS','TEACH']).optional(), experienceConfirmed: z.boolean().optional(), equipmentConfirmed: z.boolean().optional() }).strict();
export const EligibilityInputSchema = z.object({ slotId: z.uuid().nullable().default(null), timeConfirmed: z.boolean().nullable().default(null), answers: SceneAnswersSchema.optional() }).strict();
export const CreateApplicationSchema = z.object({ requestKey: z.uuid(), slotId: z.uuid(), message: z.string().trim().max(1000), timeConfirmed: z.boolean(), answers: SceneAnswersSchema.optional() }).strict();
export const WithdrawApplicationSchema = z.object({ revision: z.number().int().positive() }).strict();
export const MyApplicationsQuerySchema = z.object({ teamId: z.uuid().optional() }).strict();
export const ReviewApplicationSchema = z.object({ revision: z.number().int().positive(), decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(500).default('') }).strict();
export const CaptainApplicationsQuerySchema = z.object({ status: z.enum(['PENDING', 'ALL']).default('PENDING'), cursor: z.uuid().optional() }).strict();
export const NotificationsQuerySchema = z.object({ cursor: z.uuid().optional() }).strict();
export const ReadNotificationSchema = z.object({}).strict();
export type ReviewApplicationInput = z.infer<typeof ReviewApplicationSchema>;
export type ApplicationInput = z.infer<typeof CreateApplicationSchema>;
export type EligibilityInput = z.infer<typeof EligibilityInputSchema>;
export type ConditionStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export interface EligibilityDTO {
  ruleVersion: 'competition-application-v1' | 'competition-application-v2' | 'scene-application-v1'; assessedAt: string; status: ConditionStatus;
  checks: { code: string; label: string; status: ConditionStatus; reason: string }[];
}
export interface ApplicationDTO {
  id: string; teamId: string; recruitmentId: string; recruitmentTitle: string; slotId: string; slotName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED';
  message: string; timeConfirmed: boolean; revision: number; submission: number;
  submittedAt: string; resolvedAt: string | null; canWithdraw: boolean; reapplyAt: string | null;
  eligibilitySnapshot: EligibilityDTO; reviewAvailable: true;
  review: null | { decision: ReviewApplicationInput['decision']; reason: string; reviewedAt: string; eligibilitySnapshot: EligibilityDTO | null };
  membership: null | { status: 'ACTIVE' | 'LEFT' | 'REMOVED'; slotName: string; joinedAt: string };
}
export interface CaptainApplicationDTO extends ApplicationDTO {
  applicant: { id: string; nickname: string; schoolName: string; skills: string[]; accountActive: boolean };
  canReview: boolean;
}
export interface CaptainApplicationsPageDTO { items: CaptainApplicationDTO[]; nextCursor: string | null; pendingCount: number }
export interface NotificationDTO {
  id: string; applicationId: string | null; teamId: string; recruitmentId: string; recruitmentTitle: string; slotName: string;
  kind: 'APPLICATION_APPROVED' | 'APPLICATION_REJECTED' | 'MEMBER_LEFT' | 'MEMBER_REMOVED' | 'RECRUITMENT_CLOSED' | 'CAPTAIN_TRANSFERRED' | 'TEAM_STARTED' | 'TEAM_COMPLETED' | 'TEAM_CANCELLED' | 'APPLICATION_EXPIRED' | 'TEAM_EXPIRED'; reason: string; createdAt: string; readAt: string | null;
}
export interface NotificationsPageDTO { items: NotificationDTO[]; nextCursor: string | null; unreadCount: number }
