import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { normalizeEmail } from '../auth';
import { loadConfig, readEnvFile, repoRoot } from '../config';
import { createDb, migrateDb } from '../db';
import { devices, users } from '../db/schema';
import { createDeviceRecord } from '../devices';
import { hashPassword } from '../lib/password';

function hasArg(name: string): boolean {
  return process.argv
    .slice(2)
    .some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
}

function readArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === `--${name}`) {
      const value = args[index + 1];
      if (value) return value;
    }
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return fallback;
}

const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
migrateDb(db);

const envFile = readEnvFile(path.join(repoRoot, '.env'));
const email = normalizeEmail(
  readArg('email', envFile.SEED_DEVICE_EMAIL?.trim() || 'demo@nota.app'),
);
const password = readArg('password', 'nota-demo-123');
const passwordGiven = hasArg('password');
const name = readArg('name', 'Wokwi ESP32');
const now = new Date();
const timestamp = now.toISOString();

let user = db.select().from(users).where(eq(users.email, email)).get();
const created = !user;
if (!user) {
  user = {
    id: randomUUID(),
    email,
    passwordHash: hashPassword(password),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.insert(users).values(user).run();
} else if (passwordGiven) {
  // 已有账号只在显式传 --password 时改密码，避免换绑设备时动到别人的登录密码。
  db.update(users)
    .set({ passwordHash: hashPassword(password), updatedAt: timestamp })
    .where(eq(users.id, user.id))
    .run();
}

// 同名设备只保留最新一台：旧 token 不能继续用来跑演示。
db.update(devices)
  .set({ revokedAt: timestamp })
  .where(and(eq(devices.userId, user.id), eq(devices.name, name), isNull(devices.revokedAt)))
  .run();
const { device, token } = createDeviceRecord(db, { userId: user.id, name, now });

sqlite.close();

console.log('seed ok');
console.log(`email=${email}`);
console.log(`password=${created || passwordGiven ? password : '(unchanged)'}`);
console.log(`deviceId=${device.id}`);
console.log(`deviceToken=${token}`);
