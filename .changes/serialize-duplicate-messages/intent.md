# Intent: 同一 clientMessageId 并发提交

## Problem

两个带相同 `clientMessageId` 的请求同时到达时，都会在写入前查不到已有消息，于是都可能扣一次额度并调用一次模型；其中一个随后会撞上唯一索引返回 500。顺序重试已经幂等，并发重试还不稳。

## Outcome

同一 thread 内相同 `clientMessageId` 的并发请求只跑一次 Agent、只扣一次额度，两个响应返回同一条 assistant 消息。

## Constraints

- 单进程 SQLite demo；不引入分布式锁或新依赖。
- 现有顺序重试行为不变。
- 进程重启后由数据库唯一索引继续兜底。
