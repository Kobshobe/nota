# Nota

AI 语音便签 / 会议助手 MVP：文字输入 → 摘要、重点、候选待办 → Agent 创建、修改、删除事项。

## 文档

- 产品范围：[`docs/product.md`](docs/product.md)
- 架构：[`docs/architecture.md`](docs/architecture.md)
- 工程约定：[`docs/engineering.md`](docs/engineering.md)
- 接口契约：[`contract/openapi.yaml`](contract/openapi.yaml)

## 形态

- Flutter Web + iOS，Riverpod + Dio；v1 文字输入，语音 / ASR 后续。
- Node 22 + TypeScript + Fastify + SQLite（Drizzle）；JWT 无状态。
- Agent 用 `pi-agent-core` + `pi-ai`，模型 DeepSeek `deepseek-flash`。

## 状态

产品、架构、工程与契约文档已定稿；服务端与客户端待实现，当前变更见 [`.changes/bootstrap-nota-mvp/`](.changes/bootstrap-nota-mvp/)。

## 常用命令

```sh
cp .env.example .env   # 填入 JWT_SECRET 与 DEEPSEEK_API_KEY
source scripts/env.sh
make check         # 文档门禁 + 契约破坏性
make check-all     # 加两端测试与运行时一致性
make baseline      # 发布时冻结契约基线
```
