export function recruitingWindow(status: string, deadline: Date | null, now = new Date(), closedAt: Date | null = null) {
  return !closedAt && ['OPEN', 'FULL'].includes(status) && !!deadline && deadline > now;
}
export function acceptingStatus(status: string, deadline: Date | null, members: number, capacity: number, closedAt: Date | null = null): 'OPEN' | 'FULL' | 'CLOSED' {
  if (!recruitingWindow(status, deadline, new Date(), closedAt)) return 'CLOSED';
  return members >= capacity ? 'FULL' : 'OPEN';
}
