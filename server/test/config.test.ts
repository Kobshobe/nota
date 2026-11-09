import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const dirs: string[] = [];

// 宿主环境（例如 `source scripts/env.sh` 导出的 PORT）会覆盖临时 .env，测试前统一清掉。
const CONFIG_ENV_KEYS = [
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'PORT',
  'DAILY_LIMIT',
  'DATABASE_PATH',
  'QUOTA_TIMEZONE',
  'LOG_FORMAT',
  'LOG_LEVEL',
];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nota-config-'));
  dirs.push(dir);
  return dir;
}

/** 清掉宿主环境里同名变量，返回恢复函数。 */
function clearConfigEnv(): () => void {
  const saved = CONFIG_ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of CONFIG_ENV_KEYS) delete process.env[key];
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('场景：配置 · JWT_SECRET 必填', () => {
  it('缺少 JWT_SECRET 时立刻抛错，不静默兜底', () => {
    // given：空环境
    const dir = tempDir();

    // when / then
    expect(() => loadConfig({ root: dir, env: {} })).toThrow(/JWT_SECRET/);
  });

  it('相对 DATABASE_PATH 按仓库根目录解析', () => {
    // given
    const dir = tempDir();

    // when
    const config = loadConfig({
      root: dir,
      env: { JWT_SECRET: 'config-test-secret', DATABASE_PATH: './data/nota.db' },
    });

    // then
    expect(config.databasePath).toBe(path.join(dir, 'data/nota.db'));
    expect(config.port).toBe(8080);
    expect(config.dailyLimit).toBe(10);
    expect(config.quotaTimezone).toBe('Asia/Shanghai');
    expect(config.deepseekModel).toBe('deepseek-flash');
    expect(config.jwtExpiresIn).toBe('7d');
  });

  it('从仓库根 .env 读取配置，环境变量优先', () => {
    // given：临时仓库根的 .env；清掉宿主环境，避免 PORT 之类的导出值覆盖文件
    const restore = clearConfigEnv();
    try {
      const dir = tempDir();
      writeFileSync(
        path.join(dir, '.env'),
        ['JWT_SECRET=from-file', 'PORT=9090', 'DAILY_LIMIT=3', 'DATABASE_PATH=./db/nota.db'].join('\n'),
      );

      // when：没有显式 env 时读文件
      const fromFile = loadConfig({ root: dir });
      // when：显式 env 覆盖文件
      const overridden = loadConfig({ root: dir, env: { JWT_SECRET: 'from-env', PORT: '7070' } });

      // then
      expect(fromFile.jwtSecret).toBe('from-file');
      expect(fromFile.port).toBe(9090);
      expect(fromFile.dailyLimit).toBe(3);
      expect(fromFile.databasePath).toBe(path.join(dir, 'db/nota.db'));
      expect(overridden.jwtSecret).toBe('from-env');
      expect(overridden.port).toBe(7070);
    } finally {
      restore();
    }
  });

  it('非法端口、每日额度、时区或 JWT 有效期抛错', () => {
    const dir = tempDir();
    expect(() => loadConfig({ root: dir, env: { JWT_SECRET: 'x', PORT: 'abc' } })).toThrow(/PORT/);
    expect(() => loadConfig({ root: dir, env: { JWT_SECRET: 'x', DAILY_LIMIT: '0' } })).toThrow(
      /DAILY_LIMIT/,
    );
    expect(() =>
      loadConfig({ root: dir, env: { JWT_SECRET: 'x', QUOTA_TIMEZONE: 'Not/AZone' } }),
    ).toThrow(/QUOTA_TIMEZONE/);
    expect(() =>
      loadConfig({ root: dir, env: { JWT_SECRET: 'x', JWT_EXPIRES_IN: 'forever' } }),
    ).toThrow(/JWT_EXPIRES_IN/);
  });

  it('日志默认人类可读，可显式切回 JSON，非法值启动即抛错', () => {
    const dir = tempDir();
    const env = { JWT_SECRET: 'x' };

    // then：默认 pretty
    expect(loadConfig({ root: dir, env }).logFormat).toBe('pretty');
    expect(loadConfig({ root: dir, env }).logLevel).toBe('info');

    // when：显式指定
    const json = loadConfig({ root: dir, env: { ...env, LOG_FORMAT: 'json', LOG_LEVEL: 'debug' } });

    // then
    expect(json.logFormat).toBe('json');
    expect(json.logLevel).toBe('debug');
    expect(() => loadConfig({ root: dir, env: { ...env, LOG_FORMAT: 'xml' } })).toThrow(/LOG_FORMAT/);
    expect(() => loadConfig({ root: dir, env: { ...env, LOG_LEVEL: 'loud' } })).toThrow(/LOG_LEVEL/);
  });
});
