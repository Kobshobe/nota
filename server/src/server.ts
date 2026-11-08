import type { FastifyServerOptions } from 'fastify';
import { buildApp } from './app';
import { loadConfig, type LogFormat } from './config';

const config = loadConfig();
const app = await buildApp({ config, logger: buildLogger(config.logLevel, config.logFormat) });

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Nota server 已启动：监听 0.0.0.0:${config.port}（http://127.0.0.1:${config.port}，日志格式 ${config.logFormat}）`);
} catch (error) {
  app.log.error(
    {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'unknown',
    },
    'failed to start server',
  );
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function buildLogger(level: string, format: LogFormat): FastifyServerOptions['logger'] {
  const redact = ['req.headers.authorization'];
  if (format === 'json') return { level, redact };
  return {
    level,
    redact,
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'SYS:HH:MM:ss',
        // 这些字段在 msg 里已经有了；JSON 模式下它们仍会保留。
        ignore: 'pid,hostname,tool,durationMs,isError,reqId',
      },
    },
  };
}
