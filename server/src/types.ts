import type Database from 'better-sqlite3';
import type { AppConfig } from './config';
import type { Db } from './db';
import type { AgentRuntime } from './agent/runtime';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    sqlite: Database.Database;
    runtime: AgentRuntime;
    now: () => Date;
    authenticate: (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}
