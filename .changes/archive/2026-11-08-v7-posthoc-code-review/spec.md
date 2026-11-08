# Spec: 补审后的行为修正

## Behavior

- 契约 baseline 固定在上一个版本 0.3.0；当前 0.4.0 的增量必须经过破坏性检查。
- `CreateItemRequest` 表达 reminder 必须有 dueAt，以及 sourceMessageId/candidateIndex 成对。
- `PATCH /items/{id}` 拒绝清空 reminder 的 dueAt；待办仍可清空。
- 候选事项必须指向助手 payload 中真实存在的 action，title 必须匹配。
- Agent 重建历史时带上摘要、重点和候选 actions，而不是只带 reply。
- Web 提醒循环挂在 router 之上，deep link 到 chat 也运行；chat 无栈时可返回 `/`。
- iOS 注册 UNUserNotificationCenter delegate，前台提醒可展示。
- auth 的持久化先成功再改内存；通知取消不再触发权限初始化。
- 429 的重置时刻在错误产生时固定；会议标题只在首条 assistant 前由客户端补齐。
- 暂存写操作提交时排除已删除事项；配置加载校验时区和 JWT 有效期。
- contract-message 测试覆盖 SendMessageResponse、toolCalls、候选来源和 429/Retry-After。

## Alternatives considered

- 只补测试不改行为：reminder 清空、历史上下文和前台通知仍是错的。
- 把 baseline 更新成 0.4.0：破坏性门禁再次变成自比较。
- 用真实模型跑运行时契约：慢、花钱、依赖网络；用 app.inject + faux 覆盖 HTTP 边界。

## Areas of concern

- baseline 0.3.0 会让 `make check` 显示 0.3.0 → 0.4.0；发布时应显式更新。
- 旧数据没有 candidate source 的语义校验；只约束新写入。
- 单进程并发仍是 demo 边界；多实例部署需要数据库级方案。
