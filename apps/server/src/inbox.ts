import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from './generated/prisma/client.js';
import type { ChatBadgeDTO, ChatListItem, InboxDTO, PendingChatItemsDTO } from '@campus/contracts';
import { db } from './db.js';
import { requireUser } from './auth.js';
import { ApiError, parse } from './http.js';

type InboxRow = Omit<ChatListItem, 'activityAt' | 'pinned'> & {
  activityAt: Date;
  pinnedAt: Date | null;
  sortId: string;
  pendingCount: number;
};
const query = z.object({
  filter: z.enum(['all', 'team', 'direct', 'archive']).default('all'),
  q: z.string().trim().max(100).default(''),
  cursor: z.string().max(512).optional(),
}).strict();
const cursorSchema = z.object({ pinned: z.iso.datetime(), activity: z.iso.datetime(), id: z.string().regex(/^(TEAM|DIRECT|DISCUSSION):[a-f0-9-]{36}$/) });
const epoch = new Date(0);
const at = (v: Date | null) => (v || epoch).toISOString();
const shape = ({ activityAt, pinnedAt, sortId: _sortId, ...row }: InboxRow): ChatListItem => ({
  ...row, activityAt: activityAt.toISOString(), pinned: !!pinnedAt,
});

// One statement reads eligible conversations, the latest visible item, and unread
// state from the same snapshot. All private previews are selected after access checks.
const views = (user: string) => Prisma.sql`
  WITH team_rows AS (
    SELECT t."id", 'TEAM' AS "kind", r."title", t."status"::text AS "status",
      t."captainUserId" = tm."userId" AS "captain", NULL::uuid AS "peerId",
      NULL::integer AS "peerAvatarVersion",
      COALESCE(latest."body", '') AS "preview", COALESCE(latest."createdAt", tm."joinedAt") AS "activityAt",
      tm."chatPinnedAt" AS "pinnedAt", tm."chatMuted" AS "muted", (end_state.archived OR end_state.expired) AS "archived",
      end_state.expired AS "archiveExpired", NULL::text AS "request", COALESCE(unread.total, 0)::int AS "unreadCount",
      COALESCE(unread.mentioned, false) AS "mentioned", COALESCE(pending.total, 0)::int AS "pendingCount"
    FROM "TeamMember" tm
    JOIN "User" me ON me."id" = tm."userId" AND me."status" = 'ACTIVE'
    JOIN "Team" t ON t."id" = tm."teamId"
    JOIN "Recruitment" r ON r."id" = t."recruitmentId" AND r."publicationStatus" = 'PUBLISHED'
    LEFT JOIN "ChatSpace" space ON space."teamId" = t."id"
    CROSS JOIN LATERAL (
      SELECT t."status" IN ('COMPLETED','CANCELLED','EXPIRED')
        OR (t."status" IN ('OPEN','FULL') AND COALESCE(r."joinDeadline" <= CURRENT_TIMESTAMP, false)) AS archived,
        (space."id" IS NULL OR space."purgedAt" IS NOT NULL
          OR COALESCE(t."archiveUntil" <= CURRENT_TIMESTAMP, false)) AS expired
    ) end_state
    LEFT JOIN LATERAL (
      SELECT CASE WHEN m."body" <> '' THEN m."body" WHEN m."imageId" IS NOT NULL THEN '[图片]'
        WHEN m."sourcePostId" IS NOT NULL OR m."sourceRecruitmentId" IS NOT NULL THEN '[内容卡片]' ELSE '' END AS "body", m."createdAt"
      FROM "ChatMessage" m WHERE m."teamId" = t."id" AND m."kind" = 'TEXT' AND m."deletedAt" IS NULL AND NOT end_state.expired
      ORDER BY m."seq" DESC LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total, bool_or(tm."userId" = ANY(m."mentionIds")) AS mentioned
      FROM "ChatMessage" m
      WHERE m."teamId" = t."id" AND m."seq" > tm."lastReadSeq" AND m."kind" = 'TEXT' AND m."deletedAt" IS NULL
        AND m."senderId" IS DISTINCT FROM tm."userId" AND NOT end_state.expired
    ) unread ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total FROM "Application" a
      JOIN "User" applicant ON applicant."id" = a."applicantId" AND applicant."status" = 'ACTIVE'
      WHERE a."teamId" = t."id" AND t."captainUserId" = tm."userId" AND tm."role" = 'CAPTAIN'
        AND a."status" = 'PENDING' AND t."status" IN ('OPEN','FULL')
        AND t."recruitmentClosedAt" IS NULL AND r."hiddenAt" IS NULL AND r."joinDeadline" > CURRENT_TIMESTAMP
    ) pending ON true
    WHERE tm."userId" = ${user}::uuid AND tm."status" = 'ACTIVE'
  ), social_rows AS (
    SELECT c."id", c."kind"::text AS "kind", CASE WHEN c."kind" = 'DIRECT' THEN COALESCE(p."nickname", '校园用户') ELSE c."title" END AS "title",
      NULL::text AS "status", (c."kind" = 'DISCUSSION' AND c."ownerId" = cm."userId") AS "captain",
      peer."userId" AS "peerId", CASE WHEN other."status" = 'ACTIVE' AND p."hasCustomAvatar" THEN p."avatarRevision" END AS "peerAvatarVersion",
      COALESCE(latest."body", '') AS "preview", COALESCE(latest."createdAt", c."createdAt") AS "activityAt",
      cm."pinnedAt", cm."muted", (c."closedAt" IS NOT NULL OR (c."kind" = 'DISCUSSION' AND post."status" IS DISTINCT FROM 'PUBLISHED')) AS "archived",
      false AS "archiveExpired",
      CASE WHEN c."state" = 'REQUESTED' THEN CASE WHEN c."ownerId" = cm."userId" THEN 'OUTGOING' ELSE 'INCOMING' END END AS "request",
      COALESCE(unread.total, 0)::int AS "unreadCount", COALESCE(unread.mentioned, false) AS "mentioned",
      COALESCE(pending.total, 0)::int AS "pendingCount"
    FROM "ConversationMember" cm
    JOIN "User" me ON me."id" = cm."userId" AND me."status" = 'ACTIVE'
    JOIN "Conversation" c ON c."id" = cm."conversationId"
    LEFT JOIN "Post" post ON post."id" = c."postId"
    LEFT JOIN "ConversationMember" peer ON c."kind" = 'DIRECT' AND peer."conversationId" = c."id" AND peer."userId" <> cm."userId"
    LEFT JOIN "User" other ON other."id" = peer."userId"
    LEFT JOIN "Profile" p ON p."userId" = peer."userId"
    LEFT JOIN LATERAL (
      SELECT CASE WHEN m."body" <> '' THEN m."body" WHEN m."imageId" IS NOT NULL THEN '[图片]'
        WHEN m."sourcePostId" IS NOT NULL OR m."sourceRecruitmentId" IS NOT NULL THEN '[内容卡片]' ELSE '' END AS "body", m."createdAt"
      FROM "ConversationMessage" m WHERE m."conversationId" = c."id" AND m."seq" > cm."joinedAfterSeq" AND m."deletedAt" IS NULL AND m."redactsMessageId" IS NULL
      ORDER BY m."seq" DESC LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total, bool_or(cm."userId" = ANY(m."mentionIds")) AS mentioned
      FROM "ConversationMessage" m WHERE m."conversationId" = c."id" AND m."seq" > greatest(cm."lastReadSeq", cm."joinedAfterSeq")
        AND m."senderId" IS DISTINCT FROM cm."userId" AND m."deletedAt" IS NULL AND m."redactsMessageId" IS NULL
    ) unread ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total FROM "ConversationMember" wait
      JOIN "User" applicant ON applicant."id" = wait."userId" AND applicant."status" = 'ACTIVE'
      WHERE c."kind" = 'DISCUSSION' AND c."ownerId" = cm."userId" AND c."closedAt" IS NULL AND post."status" = 'PUBLISHED'
        AND wait."conversationId" = c."id" AND wait."status" = 'PENDING'
    ) pending ON true
    WHERE cm."userId" = ${user}::uuid AND cm."status" = 'ACTIVE' AND c."state" <> 'DECLINED'
      AND (c."kind" <> 'DIRECT' OR c."state" = 'ACTIVE' OR
        (other."status" = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM "UserBlock" b WHERE (b."blockerId",b."blockedId") IN ((cm."userId",peer."userId"),(peer."userId",cm."userId"))
        )))
  ), inbox AS (
    SELECT *, "kind" || ':' || "id"::text AS "sortId" FROM (
      SELECT * FROM team_rows UNION ALL SELECT * FROM social_rows
    ) rows
  )
`;

export const inboxRouter = Router();
inboxRouter.use('/me/chat-inbox', (_req, res, next) => {
  requireUser(res);
  res.setHeader('Cache-Control', 'no-store');
  next();
});

inboxRouter.get('/me/chat-inbox', async (req, res) => {
  const user = requireUser(res).id;
  const input = parse(query, req.query);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (input.cursor) {
    try { cursor = parse(cursorSchema, JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
    catch { throw new ApiError(400, 'INVALID_CURSOR', '会话列表位置已变化，请重新加载。'); }
  }
  const rows = await db.$queryRaw<InboxRow[]>`
    ${views(user)}
    SELECT * FROM inbox WHERE "request" IS DISTINCT FROM 'INCOMING'
    AND ${input.filter === 'archive' ? Prisma.sql`"archived"` : Prisma.sql`NOT "archived"`}
    ${input.filter === 'team' ? Prisma.sql`AND "kind" = 'TEAM'` : Prisma.empty}
    ${input.filter === 'direct' ? Prisma.sql`AND "kind" = 'DIRECT'` : Prisma.empty}
    ${input.q ? Prisma.sql`AND strpos(lower("title"), lower(${input.q})) > 0` : Prisma.empty}
    ${cursor ? Prisma.sql`AND (COALESCE("pinnedAt", 'epoch'::timestamptz), "activityAt", "sortId") < (${new Date(cursor.pinned)}, ${new Date(cursor.activity)}, ${cursor.id})` : Prisma.empty}
    ORDER BY "pinnedAt" DESC NULLS LAST, "activityAt" DESC, "sortId" DESC LIMIT 31
  `;
  const page = rows.slice(0, 30), tail = page.at(-1);
  const data: InboxDTO = { items: page.map(shape), nextCursor: rows.length > page.length && tail
    ? Buffer.from(JSON.stringify({ pinned: at(tail.pinnedAt), activity: at(tail.activityAt), id: tail.sortId })).toString('base64url') : null };
  res.json({ data });
});

inboxRouter.get('/me/chat-inbox/badge', async (_req, res) => {
  const [data] = await db.$queryRaw<ChatBadgeDTO[]>`
    ${views(requireUser(res).id)}
    SELECT count(*) FILTER (WHERE NOT "muted" AND "unreadCount" > 0 AND "request" IS NULL)::int AS "unreadCount",
      (count(*) FILTER (WHERE "request" = 'INCOMING') + COALESCE(sum("pendingCount"), 0))::int AS "requests"
    FROM inbox
  `;
  res.json({ data });
});

inboxRouter.get('/me/chat-inbox/pending', async (_req, res) => {
  const rows = await db.$queryRaw<InboxRow[]>`
    ${views(requireUser(res).id)}
    SELECT * FROM inbox WHERE "request" = 'INCOMING' OR "pendingCount" > 0 ORDER BY "activityAt" DESC, "sortId" DESC
  `;
  const data: PendingChatItemsDTO = { contacts: [], teams: [], discussions: [] };
  for (const row of rows) {
    if (row.request === 'INCOMING') data.contacts.push(shape(row));
    else (row.kind === 'TEAM' ? data.teams : data.discussions).push({ id: row.id, title: row.title, pendingCount: row.pendingCount });
  }
  res.json({ data });
});
