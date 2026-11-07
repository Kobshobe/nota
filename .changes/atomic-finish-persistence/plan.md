# Plan: finish 与消息落库原子化

## Files

- `server/src/agent/staging.ts`：`stageFinish`/`hasFinished`/`commitInTransaction`/`markCommitted`。
- `server/src/agent/tools.ts`：`finish` 只暂存并返回 `finished`。
- `server/src/agent/run.ts`：返回 staging 与 payload，不再提交。
- `server/src/messages.ts`：`persistRun` 单事务提交事项和消息。
- `server/test/agent.test.ts`：assistant 插入触发器失败时，事项、消息、额度一起回滚。

## Order

1. staging 拆分暂存与提交。
2. finish/run 改为暂存。
3. messages 的 persistRun 合并事务。
4. 加失败回滚测试，跑全量门禁。

## Proof

- `cd server && npm test` 63 个测试通过，含强制 assistant 插入失败的回滚用例。
- `make check-all`、真实 e2e 通过。
