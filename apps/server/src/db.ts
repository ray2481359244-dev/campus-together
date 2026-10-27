import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { config } from './config.js';

export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl, options: '-c timezone=UTC', connectionTimeoutMillis: 5000, max: 10 }) });
