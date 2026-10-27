import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { db } from './db.js';
import { setup, reset, team, apply, join, read, write, ids } from './test-fixtures.js';
import { expireTeam, expireDueTeams, startExpiryWorker } from './expiry.js';
import { databaseNow } from './time.js';
beforeAll(setup); beforeEach(reset); afterAll(() => db.$disconnect());
const due = async (id: string) => { const deadline = new Date(Date.now() - 1000); await db.recruitment.update({ where: { id }, data: { joinDeadline: deadline } }); return deadline; };
describe('database-clock expiry and recovery', () => {
  it('uses database epoch time without shifting timezone or expiring a near-future deadline', async () => {
    const now = await db.$transaction(tx => databaseNow(tx)); expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(2000);
    const r = await team(); await db.recruitment.update({ where: { id: r.id }, data: { joinDeadline: new Date(Date.now() + 60_000) } }); expect(await expireTeam(r.team.id)).toBe(false);
  });
  it('expires once across concurrent scans with stable deadline, notices and pending state', async () => {
    const r = await team(); await join(r); const pending = await apply(r, 2), deadline = await due(r.id);
    expect((await Promise.all([expireTeam(r.team.id), expireTeam(r.team.id)])).sort()).toEqual([false, true]);
    expect(await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).toMatchObject({ status: 'EXPIRED', expiredAt: deadline, revision: 2 });
    expect(await db.application.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: 'EXPIRED', revision: 2 });
    expect(await db.teamAction.count({ where: { kind: 'EXPIRE' } })).toBe(1);
    expect(await db.notification.count({ where: { actionNoticeId: { not: null } } })).toBe(3);
    expect((await read(2, '/me/notifications')).body.data.items[0].kind).toBe('APPLICATION_EXPIRED');
    expect((await read(1, '/me/notifications')).body.data.items[0].kind).toBe('TEAM_EXPIRED');
    expect((await expireDueTeams()).expired).toBe(0);
  });
  it('request fallback persists expiry before reads, start and approval, without reopening', async () => {
    const r = await team(); await join(r); const pending = await apply(r, 2); await due(r.id);
    expect((await read(0, '/teams/' + r.team.id)).body.data).toMatchObject({ status: 'EXPIRED', canStart: false });
    await write(0, '/teams/' + r.team.id + '/actions', { kind: 'START', revision: 1, reason: '迟到开始' }).expect(409);
    await write(0, '/applications/' + pending.id + '/review', { revision: 1, decision: 'APPROVE', reason: '' }).expect(409);
    expect((await read(0, '/recruitments/' + r.id)).body.data.team.status).toBe('EXPIRED');
    expect(await db.teamMember.count({ where: { teamId: r.team.id, status: 'ACTIVE' } })).toBe(2);
  });
  it('skips future and already started or terminal teams', async () => {
    for (const status of ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const) { const r = await team(); await due(r.id); await db.team.update({ where: { id: r.team.id }, data: { status } }); expect(await expireTeam(r.team.id)).toBe(false); }
    const future = await team(); expect(await expireTeam(future.team.id)).toBe(false); expect(await db.teamAction.count()).toBe(0);
  });
  it('processes a bounded ordered batch and catches the remainder on a later scan', async () => {
    for (let i = 0; i < 3; i++) await due((await team()).id);
    expect(await expireDueTeams(2)).toEqual({ scanned: 2, expired: 2, failed: 0 }); expect(await expireDueTeams(2)).toEqual({ scanned: 1, expired: 1, failed: 0 });
  });
  it('startup worker catches up teams that expired while service was stopped', async () => {
    const r = await team(); await due(r.id); const stop = startExpiryWorker();
    try { await expect.poll(async () => (await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).status).toBe('EXPIRED'); } finally { await stop(); }
    expect(await db.teamAction.count()).toBe(1);
  });
  it('rolls back all expiry effects if notification storage fails and later retries once', async () => {
    const r = await team(), pending = await apply(r); await due(r.id);
    await db.$executeRawUnsafe(`CREATE FUNCTION expiry_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER expiry_test_failure BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION expiry_test_failure()`);
    try { await expect(expireTeam(r.team.id)).rejects.toThrow(); expect((await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).status).toBe('OPEN'); expect((await db.application.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING'); expect(await db.teamAction.count()).toBe(0); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER expiry_test_failure ON "Notification"'); await db.$executeRawUnsafe('DROP FUNCTION expiry_test_failure()'); }
    expect(await expireTeam(r.team.id)).toBe(true);
    const note = (await read(1, '/me/notifications')).body.data.items[0]; await write(0, '/me/notifications/' + note.id + '/read', {}).expect(404);
    expect(note.teamId).toBe(r.team.id); expect(ids.length).toBe(3);
  });
});
