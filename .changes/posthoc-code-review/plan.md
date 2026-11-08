# Plan: 对已落地 MVP 做补审

## Files

- `server/`：鉴权、额度、消息、事项、Agent、事务、配置和测试。
- `app/`：Dio/错误映射、路由、启动、对话、事项、通知和测试。
- `contract/openapi.yaml`、`contract/baseline/openapi.yaml`：条件校验、400、baseline。
- `scripts/`：运行时契约覆盖、进程树清理。
- `docs/engineering.md`：测试清单和条件规则。
- `.changes/posthoc-code-review/`：审查范围与修正记录。

## Order

1. 独立审查服务端、客户端和跨端契约。
2. 修复 P0/P1；P2 能低成本修的修，其余记录。
3. 审查者复核修复后的 diff。
4. 跑 `make check-all`、真实 e2e、Web/iOS 构建；归档本链。

## Proof

- 服务端 69 个测试、客户端 15 个测试、运行时契约 103 项。
- `make check-all`、`E2E_MESSAGE=1 make e2e` 通过。

## Deferred

- 多实例部署下的并发/自动注册竞争：v1 明确单进程 SQLite。
- CORS 来源白名单：本地 demo 允许任意来源，部署前收紧。
- 超过 100 条事项时旧候选状态的推页与 20 条满长候选的历史预算：记录为后续改进。
- 独立审查者复核无 P0/P1。
