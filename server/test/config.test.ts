import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nota-config-'));
  dirs.push(dir);
  return dir;
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
    // given：临时仓库根的 .env
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
});
