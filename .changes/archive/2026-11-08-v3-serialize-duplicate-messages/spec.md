# Spec: 同一 clientMessageId 并发提交

## Behavior

- API 进程内按 `<threadId>:<clientMessageId>` 串行化消息请求。
- 后到的相同 key 请求等待第一个请求，然后读取已存响应；不再次扣额度或调用模型。
- 第一个请求失败时，等待者收到同一失败结果；失败路径继续删除用户消息并退款。
- 串行化只覆盖同一 Node 进程；多进程部署需要数据库级方案，v1 不涉及。

## Alternatives considered

- **只靠数据库唯一索引**：能阻止重复写入，但后到请求会 500，且可能已经扣额度；不采用。
- **SQLite `BEGIN IMMEDIATE` 全局锁**：会串行化所有用户消息，范围过大；不采用。
- **外部分布式锁**：demo 单进程不需要。

## Areas of concern

- 进程内 Map 在请求结束后必须清理，避免内存泄漏。
- 请求取消时任务仍会跑完，这是同步 Agent 的既有行为。
