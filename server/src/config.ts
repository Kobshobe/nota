import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export type LogFormat = 'pretty' | 'json';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export const LOG_LEVELS: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

export interface AppConfig {
  repoRoot: string;
  port: number;
  databasePath: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  dailyLimit: number;
  quotaTimezone: string;
  deepseekApiKey?: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  logLevel: LogLevel;
  logFormat: LogFormat;
}

export interface LoadConfigOptions {
  root?: string;
  env?: Record<string, string | undefined>;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const root = options.root ?? repoRoot;
  const env = options.env ?? { ...readEnvFile(path.join(root, '.env')), ...process.env };

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required. Set it in the repo root .env file.');
  }

  const port = parseInteger(env.PORT, 8080, 'PORT');
  const dailyLimit = parseInteger(env.DAILY_LIMIT, 10, 'DAILY_LIMIT');
  const databasePath = path.resolve(root, env.DATABASE_PATH?.trim() || './data/nota.db');
  const jwtExpiresIn = env.JWT_EXPIRES_IN?.trim() || '7d';
  if (!/^\d+(ms|s|m|h|d)$/.test(jwtExpiresIn)) {
    throw new Error('JWT_EXPIRES_IN must look like 7d, 12h, or 30m.');
  }
  const quotaTimezone = env.QUOTA_TIMEZONE?.trim() || 'Asia/Shanghai';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: quotaTimezone }).format();
  } catch {
    throw new Error(`QUOTA_TIMEZONE is not a valid IANA time zone: ${quotaTimezone}`);
  }

  const logLevel = (env.LOG_LEVEL?.trim() || 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}.`);
  }
  const logFormat = env.LOG_FORMAT?.trim() || 'pretty';
  if (logFormat !== 'pretty' && logFormat !== 'json') {
    throw new Error('LOG_FORMAT must be "pretty" or "json".');
  }

  return {
    repoRoot: root,
    port,
    databasePath,
    jwtSecret,
    jwtExpiresIn,
    dailyLimit,
    quotaTimezone,
    deepseekApiKey: env.DEEPSEEK_API_KEY?.trim() || undefined,
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
    deepseekModel: env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash',
    logLevel,
    logFormat,
  };
}

function parseInteger(raw: string | undefined, fallback: number, name: string): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    let value = match[2] as string;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}
