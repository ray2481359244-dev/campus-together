import type { Prisma } from './generated/prisma/client.js';
export async function notify(tx: Prisma.TransactionClient, input: {recipientId:string;sourceKey:string;kind:string;title:string;reason:string;teamId?:string;recruitmentId?:string}) {
  const row=await tx.notice.upsert({where:{recipientId_sourceKey:{recipientId:input.recipientId,sourceKey:input.sourceKey}},create:input,update:{}});
  await tx.notification.upsert({where:{noticeId:row.id},create:{recipientId:input.recipientId,noticeId:row.id},update:{}});
}
