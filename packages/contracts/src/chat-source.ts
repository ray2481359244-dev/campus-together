import { z } from 'zod';

export const ConversationSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('POST'), postId: z.uuid(), commentId: z.uuid().optional() }).strict(),
  z.object({ kind: z.literal('RECRUITMENT'), recruitmentId: z.uuid() }).strict(),
]);
export type ConversationSource = z.infer<typeof ConversationSourceSchema>;
