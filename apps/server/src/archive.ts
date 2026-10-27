import { db } from './db.js';
import { databaseNow } from './time.js';
export const terminal = (status: string) => ['COMPLETED','CANCELLED','EXPIRED'].includes(status);
const seconds = Number(process.env.CHAT_ARCHIVE_SECONDS || 30*86400);
if (!Number.isInteger(seconds) || seconds < (process.env.NODE_ENV === 'production' ? 86400 : 1) || seconds > 365*86400) throw new Error('Invalid CHAT_ARCHIVE_SECONDS');
export const archiveDeadline = (at: Date) => new Date(at.getTime()+seconds*1000);
export async function purgeTeamChat(teamId: string) {
  return db.$transaction(async tx=>{
    const identity=await tx.team.findUnique({where:{id:teamId},select:{recruitmentId:true}});if(!identity)return false;
    await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id"=${identity.recruitmentId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id"=${teamId}::uuid FOR UPDATE`;
    const team=await tx.team.findUniqueOrThrow({where:{id:teamId},include:{chatSpace:true}}),now=await databaseNow(tx);
    if(!terminal(team.status)||!team.archiveUntil||team.archiveUntil>now||!team.chatSpace||team.chatSpace.purgedAt)return false;
    await tx.chatMessage.updateMany({where:{teamId},data:{body:null,bodyHash:null,deletedAt:now,nickname:'已归档'}});
    await tx.chatSpace.update({where:{teamId},data:{announcement:'',announcementRevision:{increment:1},purgedAt:now}});
    await tx.domainEvent.create({data:{teamId,kind:'CHAT_ARCHIVE_PURGED',payload:{archiveUntil:team.archiveUntil.toISOString()},createdAt:now}});return true;
  },{maxWait:5000,timeout:10000});
}
export async function purgeExpiredChats(batchSize=100){
  const rows=await db.$queryRaw<{id:string}[]>`SELECT t."id" FROM "Team" t JOIN "ChatSpace" s ON s."teamId"=t."id" WHERE t."status" IN ('COMPLETED','CANCELLED','EXPIRED') AND t."archiveUntil"<=clock_timestamp() AND s."purgedAt" IS NULL ORDER BY t."archiveUntil",t."id" LIMIT ${batchSize}`;
  let purged=0,failed=0;for(const row of rows){try{if(await purgeTeamChat(row.id))purged++;}catch{failed++;console.error('One archive cleanup failed; later scans will retry.');}}return{scanned:rows.length,purged,failed};
}
