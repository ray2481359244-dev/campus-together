import { z } from 'zod';

export const EligibilityInputSchema = z.object({ slotId: z.uuid().nullable().default(null), timeConfirmed: z.boolean().nullable().default(null) }).strict();
export const CreateApplicationSchema = z.object({ requestKey: z.uuid(), slotId: z.uuid(), message: z.string().trim().max(1000), timeConfirmed: z.boolean() }).strict();
export const WithdrawApplicationSchema = z.object({ revision: z.number().int().positive() }).strict();
export const MyApplicationsQuerySchema = z.object({ teamId: z.uuid().optional() }).strict();
export type ApplicationInput = z.infer<typeof CreateApplicationSchema>;
export type EligibilityInput = z.infer<typeof EligibilityInputSchema>;
export type ConditionStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export interface EligibilityDTO {
  ruleVersion: 'competition-application-v1'; assessedAt: string; status: ConditionStatus;
  checks: { code: string; label: string; status: ConditionStatus; reason: string }[];
}
export interface ApplicationDTO {
  id: string; teamId: string; recruitmentId: string; recruitmentTitle: string; slotId: string; slotName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED';
  message: string; timeConfirmed: boolean; revision: number; submission: number;
  submittedAt: string; resolvedAt: string | null; canWithdraw: boolean; reapplyAt: string | null;
  eligibilitySnapshot: EligibilityDTO; reviewAvailable: false;
}
