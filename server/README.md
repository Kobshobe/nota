# Nota server

Nota MVP 的 Fastify API：JWT 鉴权、threads / messages / items / usage，Agent 用 `pi-agent-core` + `pi-ai` 调用 DeepSeek `deepseek-flash`。契约唯一事实源是仓库根的 [`contract/openapi.yaml`](../contract/openapi.yaml)。

## 运行

要求 Node 22（`pi-agent-core` 需要 >= 22.19）。

```sh
cd server
npm install
npm start        # tsx src/server.ts，默认 PORT=8080
npm run dev      # tsx watch
npm test         # vitest run
npx tsc --noEmit
```

`npm start` 从仓库根 `.env` 读取配置；`JWT_SECRET` 必填，缺失会在启动时直接报错。`DATABASE_PATH` 的相对路径按仓库根解析。`DEEPSEEK_API_KEY` 缺失不会阻止启动，但发送消息会返回 500，且不扣额度、不保留用户消息。

## 目录

```text
src/
  app.ts        Fastify 实例、CORS、JWT、统一错误体、X-Request-Id
  server.ts     启动与优雅退出
  config.ts     .env 与默认值
  db.ts         better-sqlite3 + Drizzle 连接与迁移
  db/schema.ts  users / threads / messages / items / tool_calls / usage_daily
  auth.ts       登录、自动注册、日常 thread、/api/auth/me
  threads.ts    thread 列表、新建会议、详情
  messages.ts   发消息、幂等、额度预扣/退款、持久化
  items.ts      列表、按钮直建、改、删、完成
  usage.ts      当日额度
  quota.ts      Asia/Shanghai 日界、Free / VIP 规则
  agent/        system prompt、staging、6 个工具、DeepSeek 运行时
drizzle/        生成的 SQL 迁移
test/           场景测试（临时 SQLite + pi-ai fauxProvider）
```

## 行为要点

- 密码 scrypt；邮箱小写去空格；新邮箱自动注册；JWT HS256 7 天；无 sessions 表。
- 每个用户一个 `daily` thread；`POST /api/threads` 只创建 `meeting`。
- 写消息按 `(thread_id, client_message_id)` 幂等；顺序重试和同进程并发同 key 都只跑一次 Agent、只扣一次额度。
- 并发串行化是进程内 Map；多进程部署需要数据库级方案，v1 不做。
- Free 每天 10 次（Asia/Shanghai 日界），VIP（邮箱含 `vip`）不限；失败或没 `finish` 的 run 会退额度并删除用户消息。
- Agent 的写操作先进入 staging；`finish` 在一个事务里提交并把 `terminate` 置真，`finishTurn` 在提交后结束本轮。没 `finish` 时整体回滚。
- 会议长文本默认只返回 `title` / `summary` / `keyPoints` / 候选 `actions`，不自动创建事项；会议标题为默认 `新会议` 时由首条 payload 的 `title` 补齐。
- 所有错误响应为 `{code, message, details?, requestId}`，`X-Request-Id` 与 `requestId` 一致；不返回堆栈、SQL 或第三方原始错误。

## 迁移

```sh
npm run db:generate -- --name <change>  # 改 schema 后生成
npm run db:migrate                      # 应用到 DATABASE_PATH
```

服务启动时也会自动应用 `drizzle/` 下的迁移。
