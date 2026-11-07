import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

  return {
    repoRoot: root,
    port,
    databasePath,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN?.trim() || '7d',
    dailyLimit,
    quotaTimezone: env.QUOTA_TIMEZONE?.trim() || 'Asia/Shanghai',
    deepseekApiKey: env.DEEPSEEK_API_KEY?.trim() || undefined,
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
    deepseekModel: env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash',
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
