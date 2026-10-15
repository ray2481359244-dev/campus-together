// Checks common credential signatures and current local secrets without printing values.
// This is a focused pre-push check, not a comprehensive security certification.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function git(args) { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
const pending = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
const forbidden = /(^|\/)(?:\.env(?:\..+)?|node_modules|\.local|\.cache|\.pnpm-store|test-results|playwright-report)(?:\/|$)/;
const patterns = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['model/service key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{28,}\b/],
];
const secrets = new Set();
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match || !/(SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL)$/.test(match[1])) continue;
    const value = match[2].replace(/^['"]|['"]$/g, '');
    if (value.length < 8 || /REPLACE_|YOUR_|^$/i.test(value)) continue;
    secrets.add(value);
    if (/DATABASE_URL$/.test(match[1])) {
      try { const password = decodeURIComponent(new URL(value).password); if (password.length >= 8) secrets.add(password); } catch {}
    }
  }
}
const findings = [];
function inspect(text, location) {
  for (const [name, pattern] of patterns) if (pattern.test(text)) findings.push({ location, kind: name });
  for (const secret of secrets) if (text.includes(secret)) { findings.push({ location, kind: 'current local environment secret' }); break; }
}
const safeTemplate = p => p === '.env.example';
for (const file of [...new Set([...tracked, ...pending])]) {
  if (forbidden.test(file) && !safeTemplate(file)) findings.push({ location: file, kind: 'forbidden runtime path' });
  if (fs.existsSync(file) && fs.statSync(file).isFile()) inspect(fs.readFileSync(file, 'utf8'), file);
}
const objects = git(['rev-list', '--objects', '--all']).trim().split('\n').filter(Boolean);
let historyBlobs = 0;
for (const object of objects) {
  const space = object.indexOf(' ');
  const id = space < 0 ? object : object.slice(0, space);
  const file = space < 0 ? '' : object.slice(space + 1);
  if (file && forbidden.test(file) && !safeTemplate(file)) findings.push({ location: `history:${id.slice(0, 8)}:${file}`, kind: 'forbidden runtime path' });
  if (git(['cat-file', '-t', id]).trim() !== 'blob') continue;
  historyBlobs++;
  inspect(git(['cat-file', 'blob', id]), `history:${id.slice(0, 8)}:${file}`);
}
console.log(JSON.stringify({ workingFiles: new Set([...tracked, ...pending]).size, historyBlobs, findings }, null, 2));
if (findings.length) process.exitCode = 1;
