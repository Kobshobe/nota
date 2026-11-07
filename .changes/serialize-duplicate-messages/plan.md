# Plan: 同一 clientMessageId 并发提交

## Files

- `server/src/messages.ts`：按 key 复用进行中的 Promise，`finally` 清理。
- `server/test/quota.test.ts`：并发同 key 两个请求，断言同一条 assistant、模型调用 1 次、额度 1。
- `server/README.md`：说明单进程串行化边界。

## Order

1. 加入 in-flight Map 和路由包装。
2. 添加并发测试。
3. 跑 `make check-all`、e2e，提交并归档。

## Proof

- `cd server && npm test` 通过，包含并发用例。
- `make check-all` 全绿。
