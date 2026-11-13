import { Router, type Response } from 'express';
import { IdSchema } from '@campus/contracts';
import { requireUser } from './auth.js';
import { db } from './db.js';
import { ApiError, parse } from './http.js';

const streams = new Map<string, Set<Response>>();
const update = 'event: changed\ndata: {}\n\n';

// Events carry no message data. A client reloads its authorized HTTP views.
export function signalChats(users: Iterable<string>) {
  for (const userId of new Set(users)) {
    for (const stream of streams.get(userId) ?? []) {
      if (!stream.writableEnded && !stream.write(update)) stream.end();
    }
  }
}

export function signalTeamChat(teamId: string, extra: string[] = []) {
  void db.teamMember.findMany({ where: { teamId, status: 'ACTIVE' }, select: { userId: true } })
    .then(rows => signalChats([...extra, ...rows.map(row => row.userId)]))
    .catch(() => { /* A later HTTP refresh recovers the update. */ });
}

export function closeChatEvents() {
  for (const responses of streams.values()) for (const response of responses) response.end();
  streams.clear();
}

export const chatEventsRouter = Router();
chatEventsRouter.get('/me/chat-events', (req, res) => {
  const user = requireUser(res);
  if (parse(IdSchema, req.query.account) !== user.id) throw new ApiError(409, 'SESSION_CHANGED', '请重新确认当前账号。');
  const sessionId = res.locals.session!.id;
  const clients = streams.get(user.id) ?? new Set<Response>();
  if (clients.size >= 8) throw new ApiError(429, 'CHAT_CONNECTION_LIMIT', '当前账号打开了较多页面。');
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  clients.add(res);
  streams.set(user.id, clients);
  res.write('retry: 4000\n\n' + update);
  let checking = false;
  const heartbeat = setInterval(async () => {
    if (checking || res.writableEnded) return;
    checking = true;
    try {
      const current = await db.session.findFirst({
        where: { id: sessionId, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } },
        select: { id: true },
      });
      if (!current) {
        res.end('event: session-ended\ndata: {}\n\n');
      } else if (!res.writableEnded && !res.write(': keepalive\n\n')) res.end();
    } catch { res.end(); }
    finally { checking = false; }
  }, 15_000);
  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size && streams.get(user.id) === clients) streams.delete(user.id);
  });
});
