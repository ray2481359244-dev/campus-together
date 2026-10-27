import { Router } from 'express';
import { IdSchema, NotificationsQuerySchema, ReadNotificationSchema } from '@campus/contracts';
import type { NotificationDTO } from '@campus/contracts';
import type { Prisma } from './generated/prisma/client.js';
import { db } from './db.js';
import { requireUser, csrfGuard, writeLimit } from './auth.js';
import { parse, ApiError } from './http.js';

const teamLink = { select: { id: true, recruitmentId: true } } as const;
const include = { actionNotice: { include: { action: { include: { team: teamLink } } } }, review: { include: { application: { select: { team: teamLink } } } }, memberChange: { include: { member: { select: { team: teamLink } } } }, closure: { include: { team: teamLink } }, closedApplication: { select: { slot: { select: { name: true } } } } } as const;
function dto(row: Prisma.NotificationGetPayload<{ include: typeof include }>): NotificationDTO {
  const base = { id: row.id, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
  if (row.review) return { ...base, applicationId: row.review.applicationId, teamId: row.review.application.team.id, recruitmentId: row.review.application.team.recruitmentId,
    recruitmentTitle: row.review.recruitmentTitle, slotName: row.review.slotName, kind: row.review.decision === 'APPROVE' ? 'APPLICATION_APPROVED' : 'APPLICATION_REJECTED', reason: row.review.reason };
  if (row.memberChange) return { ...base, applicationId: null, teamId: row.memberChange.member.team.id, recruitmentId: row.memberChange.member.team.recruitmentId,
    recruitmentTitle: row.memberChange.recruitmentTitle, slotName: row.memberChange.slotName, kind: row.memberChange.kind === 'LEFT' ? 'MEMBER_LEFT' : 'MEMBER_REMOVED', reason: row.memberChange.reason };
  if (row.closure && row.closedApplication) return { ...base, applicationId: row.applicationId, teamId: row.closure.teamId, recruitmentId: row.closure.team.recruitmentId,
    recruitmentTitle: row.closure.recruitmentTitle, slotName: row.closedApplication.slot.name, kind: 'RECRUITMENT_CLOSED', reason: row.closure.reason };
  if (row.actionNotice) {
    const notice = row.actionNotice, action = notice.action;
    const kinds = { TRANSFER: 'CAPTAIN_TRANSFERRED', START: 'TEAM_STARTED', COMPLETE: 'TEAM_COMPLETED', CANCEL: 'TEAM_CANCELLED', EXPIRE: 'TEAM_EXPIRED' } as const;
    return { ...base, applicationId: notice.applicationId, teamId: action.teamId, recruitmentId: action.team.recruitmentId, recruitmentTitle: action.recruitmentTitle,
      slotName: notice.slotName, kind: notice.applicationId ? 'APPLICATION_EXPIRED' : kinds[action.kind], reason: action.reason };
  }
  throw new Error('Notification source invariant missing');
}
export const notificationsRouter = Router();
notificationsRouter.use('/me/notifications', (_req, res, next) => { requireUser(res); res.setHeader('Cache-Control', 'no-store'); next(); });
notificationsRouter.get('/me/notifications', async (req, res) => {
  const user = requireUser(res), input = parse(NotificationsQuerySchema, req.query);
  const result = await db.$transaction(async tx => {
    const cursor = input.cursor ? await tx.notification.findFirst({ where: { id: input.cursor, recipientId: user.id } }) : null;
    if (input.cursor && !cursor) throw new ApiError(400, 'INVALID_CURSOR', '分页位置无效，请刷新通知。');
    const rows = await tx.notification.findMany({ where: { recipientId: user.id,
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
      include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21 });
    const items = rows.slice(0, 20);
    return { items: items.map(dto), nextCursor: rows.length > 20 ? items.at(-1)!.id : null, unreadCount: await tx.notification.count({ where: { recipientId: user.id, readAt: null } }) };
  });
  res.json({ data: result });
});
notificationsRouter.post('/me/notifications/:id/read', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id);
  parse(ReadNotificationSchema, req.body);
  const result = await db.$transaction(async tx => {
    await tx.notification.updateMany({ where: { id, recipientId: user.id, readAt: null }, data: { readAt: new Date() } });
    const row = await tx.notification.findFirst({ where: { id, recipientId: user.id }, include });
    if (!row) throw new ApiError(404, 'NOT_FOUND', '这条通知不存在或不属于当前账号。');
    return dto(row);
  });
  res.json({ data: result });
});
