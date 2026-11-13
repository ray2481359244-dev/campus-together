import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { config } from './config.js';
import { db } from './db.js';
import { actors, apply, ids, join, read, reset, setup, team, tokens, write } from './test-fixtures.js';

beforeAll(setup);
beforeEach(async () => {
  await reset();
  await db.post.deleteMany();
  await db.user.updateMany({ where: { id: { in: ids } }, data: { allowMessageRequests: true } });
});
afterAll(() => db.$disconnect());

const inbox = '/me/chat-inbox';
const conversation = (id: string) => '/conversations/' + id;
const teamChat = (id: string) => '/teams/' + id + '/chat';
const send = (who: number, path: string, body: string, fields = {}) =>
  write(who, path + '/messages', { clientMessageId: randomUUID(), body, ...fields });
const change = (who: number, path: string, body: object) => actors[who].put('/api/v1' + path)
  .set('Origin', config.origin).set('X-CSRF-Token', tokens[who]).send(body);

async function post() {
  const topic = await db.topic.findFirstOrThrow();
  return (await write(0, '/posts', {
    requestKey: randomUUID(), topicId: topic.id, title: '活动讨论与消息验证', body: '这是一段可用于会话来源的公开正文。', imageIds: [],
  }).expect(201)).body.data;
}

describe('unified inbox', () => {
  it('shows empty teams, tracks application decisions and suppresses muted badges', async () => {
    const r = await team();
    const path = teamChat(r.team.id);
    expect((await read(0, inbox + '?filter=team').expect(200)).body.data.items).toEqual([
      expect.objectContaining({ id: r.team.id, kind: 'TEAM', preview: '', unreadCount: 0, captain: true }),
    ]);
    const application = await apply(r);
    expect((await read(1, inbox).expect(200)).body.data.items).toHaveLength(0);
    expect((await read(0, inbox + '/pending').expect(200)).body.data.teams[0]).toMatchObject({ id: r.team.id, pendingCount: 1 });
    expect((await read(0, '/me/notifications?view=activity').expect(200)).body.data.items).toHaveLength(0);
    await write(0, '/applications/' + application.id + '/review', { revision: 1, decision: 'APPROVE', reason: '欢迎加入。' }).expect(200);
    expect((await read(0, inbox + '/pending').expect(200)).body.data.teams).toHaveLength(0);
    expect((await read(0, '/me/notifications/summary').expect(200)).body.data.activityUnreadCount).toBe(0);
    expect((await read(1, '/me/notifications?view=activity').expect(200)).body.data.items[0]).toMatchObject({
      kind: 'APPLICATION_APPROVED', chatAvailable: true,
    });
    const first = (await send(0, path, '会话未读验证').expect(200)).body.data;
    expect((await read(1, inbox + '?q=多阶段').expect(200)).body.data.items[0]).toMatchObject({ preview: '会话未读验证', unreadCount: 1 });
    expect((await read(1, inbox + '/badge').expect(200)).body.data.unreadCount).toBe(1);
    await change(1, path + '/preferences', { muted: true, pinned: true }).expect(200);
    expect((await read(1, inbox).expect(200)).body.data.items[0]).toMatchObject({ muted: true, pinned: true, unreadCount: 1 });
    expect((await read(1, inbox + '/badge').expect(200)).body.data.unreadCount).toBe(0);
    await write(1, path + '/read', { seq: first.seq }).expect(200);
    await write(1, path + '/read', { seq: 0 }).expect(200);
    expect((await read(1, inbox).expect(200)).body.data.items[0].unreadCount).toBe(0);
    await write(1, '/teams/' + r.team.id + '/leave', { revision: 1 }).expect(200);
    expect((await read(1, inbox).expect(200)).body.data.items).toHaveLength(0);
    await read(1, path + '/search?q=未读').expect(404);
  });

  it('hides private summaries when the team archive expires', async () => {
    const r = await team();
    await join(r);
    const path = teamChat(r.team.id);
    await send(0, path, '队伍私有资料').expect(200);
    await write(0, '/teams/' + r.team.id + '/actions', { kind: 'CANCEL', revision: 1, reason: '流程验证' }).expect(200);
    expect((await read(1, inbox + '?filter=archive').expect(200)).body.data.items[0]).toMatchObject({ preview: '队伍私有资料' });
    await db.team.update({ where: { id: r.team.id }, data: { archiveUntil: new Date(Date.now() - 60_000) } });
    expect((await read(1, inbox + '?filter=archive').expect(200)).body.data.items[0]).toMatchObject({
      preview: '', archived: true, archiveExpired: true, unreadCount: 0,
    });
    await read(1, path).expect(410);
  });
});

describe('direct and discussion conversations', () => {
  it('deduplicates a first request and a retried reply, enforces access and keeps source excerpts live', async () => {
    const entry = await post();
    const first = { peerId: ids[0], clientMessageId: randomUUID(), body: '可以一起讨论吗？', source: { kind: 'POST', postId: entry.id } };
    const requests = await Promise.all([write(1, '/contacts', first), write(1, '/contacts', first)]);
    expect(requests.map(response => response.status).sort()).toEqual([200, 201]);
    const id = requests[0].body.data.id, path = conversation(id);
    expect(requests[1].body.data).toEqual({ id, sent: true });
    expect((await read(0, inbox + '/pending').expect(200)).body.data.contacts[0]).toMatchObject({ id, request: 'INCOMING' });
    expect((await read(0, inbox).expect(200)).body.data.items).toHaveLength(0);
    await read(2, path).expect(404);
    await send(1, path, '第二条需等接受').expect(409);
    await write(1, '/contacts/requests/' + id, { accept: true }).expect(404);
    const original = (await read(0, path).expect(200)).body.data.items[0];
    expect(original.context.excerpt).toContain('公开正文');
    await write(0, '/contacts/requests/' + id, { accept: true }).expect(200);
    expect((await read(0, inbox + '?filter=direct').expect(200)).body.data.items[0]).toMatchObject({ id, request: null });
    const fields = { clientMessageId: randomUUID(), replyToId: original.id };
    const answer = (await send(0, path, '周五见面', fields).expect(200)).body.data;
    expect((await send(0, path, '周五见面', fields).expect(200)).body.data).toEqual(answer);
    expect(answer.reply).toMatchObject({ seq: original.seq, excerpt: first.body });
    expect(await db.conversationMessage.count({ where: { conversationId: id } })).toBe(2);
    expect((await read(1, path + '/search?q=周五').expect(200)).body.data.items).toHaveLength(1);
    await db.post.update({ where: { id: entry.id }, data: { status: 'HIDDEN' } });
    const updates = (await read(0, path + '?after=' + answer.seq + '&contexts=' + original.id).expect(200)).body.data.contextUpdates;
    expect(updates).toEqual([{ id: original.id, context: null }]);
    await change(0, '/contacts/' + ids[1] + '/block', { blocked: true }).expect(200);
    await send(1, path, '拉黑后无法发送').expect(409);
    await change(0, '/me/contact-preferences', { allowRequests: false }).expect(200);
    await write(2, '/contacts', { peerId: ids[0], clientMessageId: randomUUID(), body: '新联系' }).expect(409);
  });

  it('checks current membership before exposing discussion history, quoted messages and images', async () => {
    const entry = await post();
    await write(1, '/post-discussions/' + entry.id, { title: '讨论', joinMode: 'APPROVAL' }).expect(404);
    const group = (await write(0, '/post-discussions/' + entry.id, { title: '活动讨论群', joinMode: 'APPROVAL' }).expect(200)).body.data;
    const path = conversation(group.id);
    const earlier = (await send(0, path, '入群前私有历史').expect(200)).body.data;
    await write(1, '/discussion-groups/' + group.id + '/join', {}).expect(200);
    await read(1, path).expect(404);
    expect((await read(0, inbox + '/pending').expect(200)).body.data.discussions[0]).toMatchObject({ id: group.id, pendingCount: 1 });
    await write(0, '/discussion-groups/' + group.id + '/people/' + ids[1], { action: 'APPROVE' }).expect(200);
    expect((await read(1, path).expect(200)).body.data.items).toEqual([]);
    await send(1, path, '引用旧记录', { replyToId: earlier.id }).expect(422);
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } }).png().toBuffer();
    const upload = { requestKey: randomUUID(), base64: bytes.toString('base64') };
    const { id } = (await write(0, '/chat-images/SOCIAL/' + group.id, upload).expect(200)).body.data;
    expect((await write(0, '/chat-images/SOCIAL/' + group.id, upload).expect(200)).body.data.id).toBe(id);
    await read(1, '/chat-images/' + id).expect(404);
    await send(0, path, '', { imageId: id, mentionIds: [ids[1]] }).expect(200);
    await read(1, '/chat-images/' + id).expect('Content-Type', /image\/webp/).expect(200);
    await read(2, '/chat-images/' + id).expect(404);
    expect((await read(1, inbox).expect(200)).body.data.items[0]).toMatchObject({ kind: 'DISCUSSION', mentioned: true, preview: '[图片]' });
    await write(0, '/discussion-groups/' + group.id + '/people/' + ids[1], { action: 'REMOVE' }).expect(200);
    await read(1, '/chat-images/' + id).expect(404);
    await read(1, path).expect(404);
  });
});
