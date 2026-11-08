import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db';
import { devices, users, type DeviceRow, type UserRow } from './db/schema';
import { unauthorized } from './lib/errors';

export interface DeviceAuth {
  device: DeviceRow;
  user: UserRow;
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createDeviceToken(): string {
  return `dev_${randomBytes(32).toString('base64url')}`;
}

/** seed 与测试共用：建一台设备，明文 token 只在这里返回一次。 */
export function createDeviceRecord(
  db: Db,
  input: { userId: string; name: string; now: Date },
): { device: DeviceRow; token: string } {
  const token = createDeviceToken();
  const row: DeviceRow = {
    id: randomUUID(),
    userId: input.userId,
    name: input.name,
    tokenHash: hashDeviceToken(token),
    createdAt: input.now.toISOString(),
    revokedAt: null,
  };
  db.insert(devices).values(row).run();
  return { device: row, token };
}

export function authenticateDevice(app: FastifyInstance, request: FastifyRequest): DeviceAuth {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '');
  const token = match?.[1]?.trim();
  if (!token) throw unauthorized('Device token required');

  const device = app.db
    .select()
    .from(devices)
    .where(and(eq(devices.tokenHash, hashDeviceToken(token)), isNull(devices.revokedAt)))
    .get();
  if (!device) throw unauthorized('Device token is invalid or revoked');

  const user = app.db.select().from(users).where(eq(users.id, device.userId)).get();
  if (!user) throw unauthorized('Device owner is missing');
  return { device, user };
}
