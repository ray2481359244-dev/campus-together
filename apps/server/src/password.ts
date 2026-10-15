import { hash, verify, argon2id } from 'argon2';

export const hashPassword = (password: string) => hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (encoded: string, password: string) => verify(encoded, password);
