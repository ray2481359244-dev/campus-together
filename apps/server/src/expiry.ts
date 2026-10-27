import type { RequestHandler } from 'express';
import { db } from './db.js';
import { IdSchema } from '@campus/contracts';
import { databaseNow } from './time.js';
import { archiveDeadline, purgeExpiredChats } from './archive.js';

// Both scheduled recovery and request fallback use the same locked transaction.
export async function expireTeam(teamId: string) {
  return db.$transaction(async tx => {
    const identity = await tx.team.findUnique({ where: { id: teamId }, select: { recruitmentId: true } });
    if (!identity) return false;
    await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id"=${identity.recruitmentId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id"=${teamId}::uuid FOR UPDATE`;
    const team = await tx.team.findUniqueOrThrow({ where: { id: teamId }, include: { recruitment: true, members: { where: { status: 'ACTIVE' }, include: { slot: true } } } });
    const now = await databaseNow(tx);
    if (!['OPEN', 'FULL'].includes(team.status) || !team.recruitment.joinDeadline || team.recruitment.joinDeadline > now || team.recruitment.publicationStatus !== 'PUBLISHED') return false;
    const pending = await tx.application.findMany({ where: { teamId, status: 'PENDING' }, include: { slot: true } });
    await tx.team.update({ where: { id: teamId }, data: { status: 'EXPIRED', expiredAt: team.recruitment.joinDeadline, archiveUntil: archiveDeadline(team.recruitment.joinDeadline), revision: { increment: 1 } } });
    await tx.application.updateMany({ where: { teamId, status: 'PENDING' }, data: { status: 'EXPIRED', revision: { increment: 1 }, resolvedAt: now } });
    const action = await tx.teamAction.create({ data: { teamId, actorId: null, expectedRevision: team.revision, kind: 'EXPIRE', captainUserId: team.captainUserId,
      fromStatus: team.status, toStatus: 'EXPIRED', reason: '招募截止已到，活动未开始，队伍已自动到期。', recruitmentTitle: team.recruitment.title, expiredCount: pending.length, createdAt: now } });
    const recipients = team.members.map(m => ({ recipientId: m.userId, slotName: m.slot.name, applicationId: null as string | null }));
    for (const row of pending) if (!recipients.some(m => m.recipientId === row.applicantId)) recipients.push({ recipientId: row.applicantId, slotName: row.slot.name, applicationId: row.id });
    for (const recipient of recipients) {
      const notice = await tx.teamActionNotice.create({ data: { actionId: action.id, ...recipient } });
      await tx.notification.create({ data: { recipientId: recipient.recipientId, actionNoticeId: notice.id, createdAt: now } });
    }
    await tx.domainEvent.create({ data: { teamId, kind: 'TEAM_EXPIRED', payload: { actionId: action.id, expiredCount: pending.length, deadline: team.recruitment.joinDeadline.toISOString() }, createdAt: now } });
    return true;
  }, { maxWait: 5000, timeout: 10000 });
}
export async function expireDueTeams(batchSize = 100) {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT t."id" FROM "Team" t JOIN "Recruitment" r ON r."id"=t."recruitmentId" WHERE t."status" IN ('OPEN','FULL') AND r."publicationStatus"='PUBLISHED' AND r."joinDeadline" <= clock_timestamp() ORDER BY r."joinDeadline",t."id" LIMIT ${batchSize}`;
  let expired = 0, failed = 0;
  for (const row of rows) { try { if (await expireTeam(row.id)) expired++; } catch { failed++; console.error('One team expiry failed; other teams continue and a later scan will retry.'); } }
  return { scanned: rows.length, expired, failed };
}
export const expiryFallback: RequestHandler = async (req, _res, next) => {
  const match = req.path.match(/^\/(teams|applications|recruitments)\/([a-f0-9-]{36})(?:\/|$)/i);
  if (match) {
    const [, kind, id] = match;
    if (!IdSchema.safeParse(id).success) { next(); return; }
    const teamId = kind === 'teams' ? id : kind === 'applications' ? (await db.application.findUnique({ where: { id }, select: { teamId: true } }))?.teamId : (await db.team.findUnique({ where: { recruitmentId: id }, select: { id: true } }))?.id;
    if (teamId) await expireTeam(teamId);
  }
  next();
};
export function startExpiryWorker() {
  let running: Promise<unknown> | null = null;
  const tick = () => { if (!running) running = expireDueTeams().then(() => purgeExpiredChats()).catch(() => console.error('Team maintenance scan failed; a later scan will retry.')).finally(() => { running = null; }); };
  tick();
  const timer = setInterval(tick, 60_000); timer.unref();
  return async () => { clearInterval(timer); await running; };
}
