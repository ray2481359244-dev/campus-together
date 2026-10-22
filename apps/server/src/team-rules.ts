export function recruitingWindow(status: string, deadline: Date | null, now = new Date()) {
  return ['OPEN', 'FULL'].includes(status) && !!deadline && deadline > now;
}
export function acceptingStatus(status: string, deadline: Date | null, members: number, capacity: number): 'OPEN' | 'FULL' | 'CLOSED' {
  if (!recruitingWindow(status, deadline)) return 'CLOSED';
  return members >= capacity ? 'FULL' : 'OPEN';
}
