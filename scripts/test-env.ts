import 'dotenv/config';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Tests require a separate database ending in _test.');
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
