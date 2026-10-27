import type { Prisma } from './generated/prisma/client.js';
export async function databaseNow(tx: Prisma.TransactionClient) {
  // Epoch milliseconds avoid driver-dependent timezone handling for raw SQL timestamps.
  const [row] = await tx.$queryRaw<{ milliseconds: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS milliseconds`;
  return new Date(Number(row.milliseconds));
}
