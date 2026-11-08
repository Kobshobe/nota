import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError } from 'zod';
import { loadConfig, type AppConfig } from './config';
import { createDb, migrateDb } from './db';
import {
  AppError,
  internal,
  invalidInput,
  notFound,
  unauthorized,
  type ErrorBody,
} from './lib/errors';
import { verifyJwt } from './lib/jwt';
import { createDeepSeekRuntime, type AgentRuntime } from './agent/runtime';
import { transcribeAudio as runTranscription, type Transcript } from './asr/minimax';
import { transcriptionFailed } from './lib/errors';
import { registerAuthRoutes } from './auth';
import { registerThreadRoutes } from './threads';
import { registerItemRoutes } from './items';
import { registerMessageRoutes } from './messages';
import { recoverRecordings, registerRecordingRoutes } from './recordings';
import { registerUsageRoutes } from './usage';
import './types';

export interface BuildAppOptions {
  config?: AppConfig;
  databasePath?: string;
  runtime?: AgentRuntime;
  transcribeAudio?: (filePath: string) => Promise<Transcript>;
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const { db, sqlite } = createDb(options.databasePath ?? config.databasePath);
  migrateDb(db);

  const runtime = options.runtime ?? createDeepSeekRuntime(config);
  const transcribeAudio =
    options.transcribeAudio ??
    ((filePath: string) => {
      const apiKey = config.minimaxApiKey;
      if (!apiKey) throw transcriptionFailed('MINIMAX_API_KEY is not configured');
      return runTranscription({
        apiKey,
        baseUrl: config.minimaxAsrBaseUrl,
        model: config.minimaxAsrModel,
        filePath,
      });
    });
  const now = options.now ?? (() => new Date());

  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => `req_${randomUUID()}`,
    bodyLimit: 2 * 1024 * 1024,
    // Fastify 默认每个请求打 incoming/completed 两条；改用 onResponse 里的一行。
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.decorate('runtime', runtime);
  app.decorate('transcribeAudio', transcribeAudio);
  app.decorate('now', now);
  app.decorate('authenticate', async (request) => {
    await verifyJwt(request);
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    if (request.url === '/api/health') return;
    request.log.info(
      `${request.method} ${request.url} → ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms`,
    );
  });
  app.addHook('onClose', async () => {
    sqlite.close();
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });
  await app.register(multipart, {
    limits: { fileSize: config.recordingMaxBytes, files: 1, fields: 8 },
  });
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);
    if (mapped.status >= 500) {
      request.log.error(
        {
          requestId: request.id,
          code: mapped.code,
          status: mapped.status,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : 'unknown',
        },
        'request failed',
      );
    } else {
      request.log.warn(
        { requestId: request.id, code: mapped.code, status: mapped.status },
        'request rejected',
      );
    }

    if (mapped.retryAfterSeconds !== undefined) {
      reply.header('Retry-After', String(mapped.retryAfterSeconds));
    }
    const body: ErrorBody = {
      code: mapped.code,
      message: mapped.message,
      requestId: request.id,
    };
    if (mapped.details !== undefined) body.details = mapped.details;
    return reply.code(mapped.status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      code: 'NOT_FOUND',
      message: 'Route not found',
      requestId: request.id,
    } satisfies ErrorBody);
  });

  app.get('/api/health', async () => ({ ok: true }));

  registerAuthRoutes(app);
  registerThreadRoutes(app);
  registerMessageRoutes(app);
  registerItemRoutes(app);
  registerUsageRoutes(app);
  registerRecordingRoutes(app);
  await recoverRecordings(app);

  return app;
}

function mapError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    const flattened = error.flatten();
    return invalidInput('Invalid request', {
      fieldErrors: flattened.fieldErrors,
      formErrors: flattened.formErrors,
    });
  }
  if (isRecord(error) && typeof error.statusCode === 'number') {
    if (error.statusCode === 401) return unauthorized();
    if (error.statusCode === 404) return notFound('Route not found');
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return invalidInput('Invalid request');
    }
  }
  return internal();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
