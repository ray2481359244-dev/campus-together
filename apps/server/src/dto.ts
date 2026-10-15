import type { Prisma } from './generated/prisma/client.js';

export const userInclude = { profile: { include: { school: true } } } as const;
export type AuthUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;
export function publicProfile(user: AuthUser) {
  if (!user.profile) throw new Error('Profile invariant missing');
  const p = user.profile;
  return { id: user.id, nickname: p.nickname, bio: p.bio, grade: p.grade, skills: p.skills, interests: p.interests,
    school: { id: p.school.id, name: p.school.name, city: p.school.city, isDemo: p.school.isDemo }, identityStatus: 'SELF_REPORTED' as const };
}
export const privateProfile = (user: AuthUser) => ({ ...publicProfile(user), email: user.email, emailVerified: false as const, role: user.role });
