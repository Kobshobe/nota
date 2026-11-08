import type Database from 'better-sqlite3';
import type { AppConfig } from './config';
import type { Db } from './db';
import type { AgentRuntime } from './agent/runtime';
import type { Transcript } from './asr/minimax';
import type { DeviceAuth } from './devices';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    sqlite: Database.Database;
    runtime: AgentRuntime;
    now: () => Date;
    transcribeAudio: (filePath: string) => Promise<Transcript>;
    prepareAudio: (filePath: string) => Promise<string>;
    synthesizeSpeech: (text: string) => Promise<Buffer>;
    authenticate: (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
    authenticateDevice: (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>;
  }

  interface FastifyRequest {
    deviceAuth?: DeviceAuth;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}
