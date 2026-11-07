import type { FastifyInstance, FastifyRequest } from 'fastify';
import { unauthorized } from './errors';
import type { UserRow } from '../db/schema';

export interface AuthTokenPayload {
  sub: string;
  email: string;
}

export async function verifyJwt(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify<AuthTokenPayload>();
  } catch {
    throw unauthorized();
  }
}

export function signToken(app: FastifyInstance, user: UserRow): string {
  return app.jwt.sign(
    { sub: user.id, email: user.email },
    { expiresIn: app.config.jwtExpiresIn },
  );
}
