# Plan: Nota MVP

## Files

- `contract/openapi.yaml`、`contract/baseline/openapi.yaml`：认证、threads、messages、items（含按钮直建）、usage 与统一错误体。
- `server/src/`：Fastify 入口、配置、Drizzle schema/migrations、auth / threads / messages / items / usage 模块。
- `server/src/agent/`：pi-agent-core + pi-ai、工具定义、finish、staging、事件持久化。
- `server/test/`：鉴权、额度并发/幂等、thread 归属、工具参数、finish 回滚、契约测试。
- `app/lib/`：Riverpod、Dio 拦截器、登录、thread 列表、对话、事项、历史、通知。
- `app/test/`：登录、加载/空/错误态、消息发送、候选确认、额度用尽。
- `docs/product.md`、`docs/architecture.md`、`docs/engineering.md`：本次变更的当前状态。
- `README.md`、`.env.example`、`AGENTS.md`：运行方式与工程入口。

## Order

1. 契约 + 文档 + 门禁形状（当前阶段）。
2. 服务端：登录/JWT → 额度 → threads/messages → Agent（fake 模型）→ DeepSeek 实接。
3. Flutter：登录 → 日常对话 → 会议 thread → 事项操作 → 通知。
4. 契约运行时检查、端到端、演示收口。

## Proof

- `cd server && npm test`：登录/注册、JWT 过期、额度并发、幂等、工具 staging/finish、错误码。
- `cd app && flutter test`：登录错误、加载/空/错误态、消息发送、候选确认、额度提示。
- `make check-all`：文档门禁、契约破坏性、两端测试、运行时契约一致。
- `make e2e`：起服务，走一次登录、发消息、事项创建与查询。
- 手工验收：短命令、复杂多事项、会议纪要、纠错、第 11 次拒绝、VIP 无限。
