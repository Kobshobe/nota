# Intent: Bootstrap Nota MVP

## Problem

Nota 需要一个可真实体验的 MVP：用户输入一段文字（短命令或会议记录），AI 整理出摘要、重点和候选待办，并能在对话中创建、修改、删除、完成事项；Free 用户每天 10 次额度必须在并发和重试下准确。

## Expected outcome

- Flutter Web + iOS 共用一份代码；文字输入先跑通，语音 / ASR 留作扩展。
- Fastify API + SQLite；JWT 无状态鉴权；DeepSeek 负责理解与工具调用。
- Agent 用 `pi-agent-core` + `pi-ai`；工具执行有 staging 和 `finish` 提交，避免半成功。
- 日常 thread 与会议 thread 分开；会议候选待办需用户确认。
- 文档、契约、测试与实现一致；`make check-all` 全绿。

## Constraints

- 产品范围见 [`docs/product.md`](../../docs/product.md)，架构见 [`docs/architecture.md`](../../docs/architecture.md)，工程约定见 [`docs/engineering.md`](../../docs/engineering.md)。
- v1 文字输入；不做语音 / ASR、Android、硬件、真实日历、多端通知同步。
- 消息同步处理；SSE / 异步任务为 P1。
- 单次输入上限 20,000 字符；单条用户消息扣 1 次额度，按钮操作不扣。

## Open questions

无阻塞问题。实现中发现的边界问题写进汇报，由协调者决定是否回填 spec。
