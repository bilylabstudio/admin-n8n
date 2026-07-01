import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')): string {
  const hash = crypto.pbkdf2Sync(password, salt, 210_000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.SALES_AREA_PASSWORD || '';
  if (fromEnv) return fromEnv;

  const rl = readline.createInterface({ input, output });
  const password = await rl.question('Sales area password: ');
  rl.close();
  return password;
}

const password = await readPassword();
if (!password || password.length < 8) {
  throw new Error('Sales area password must be at least 8 characters.');
}

console.log(hashPassword(password));
