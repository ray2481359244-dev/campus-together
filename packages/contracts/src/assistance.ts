import { z } from 'zod';
import type { EligibilityDTO } from './applications.js';
export const MatchingSchema = z.object({ schoolId: z.uuid(), goal: z.string().trim().max(100).default(''), mode: z.enum(['ONLINE','OFFLINE']).nullable().default(null), confirmations: z.record(z.uuid(),z.boolean()).default({}) }).strict().refine(v=>Object.keys(v.confirmations).length<=30,'一次最多确认 30 个活动');
export const DraftFieldsSchema = z.object({ fields: z.array(z.object({ field:z.enum(['title','description','competitionName','direction','goal','collaboration']), value:z.string().min(1).max(2000), sourceExcerpt:z.string().min(1).max(2000) }).strict()).max(6), missingQuestions:z.array(z.string().min(1).max(200)).max(10) }).strict();
export const AiDraftInputSchema = z.object({ requestKey:z.uuid(), text:z.string().trim().min(1).max(2000), consent:z.literal(true) }).strict();
export const AiExplainInputSchema = z.object({ requestKey:z.uuid(), slotId:z.uuid(), timeConfirmed:z.boolean().nullable().default(null), consent:z.literal(true) }).strict();
export interface MatchItemDTO { startAt:string|null;endAt:string|null;weeklyHours:number;collaboration:string; recruitmentId:string; teamId:string; title:string; slotId:string; slotName:string; assessment:EligibilityDTO; score:number|null; completeness:number; dimensions:{id:string;label:string;weight:number;value:number|null;applicable:boolean;reason:string}[] }
export interface MatchesDTO { mode:'RULES_ONLY'; scope:string; items:MatchItemDTO[] }
export interface AiBaseDTO { id:string; mode:'LIVE'|'RULES_ONLY'; reason:string; createdAt:string }
export interface AiDraftDTO extends AiBaseDTO { fields:z.infer<typeof DraftFieldsSchema>['fields']; missingQuestions:string[] }
export interface AiExplainDTO extends AiBaseDTO { assessment:EligibilityDTO; sentences:{evidenceId:string;text:string}[] }
