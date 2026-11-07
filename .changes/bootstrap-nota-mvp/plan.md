# Plan: Nota MVP

## Files

- `contract/openapi.yaml`、`contract/baseline/openapi.yaml`：定义并冻结第一版接口。
- `server/src/`：Fastify 入口、SQLite 迁移、notes/agent/quota 服务、DeepSeek 适配。
- `server/test/`：额度并发、幂等、Agent 工具循环（假模型）、契约形状。
- `app/lib/`：录音与文本输入、结果页、历史、额度、工具轨迹。
- `app/test/`：输入到结果的状态流转、额度错误提示。
- `docs/architecture.md`、`docs/layout.md`、`AGENTS.md`：按本次决定更新。
- `.agents/scripts/doc-budgets.json`：AGENTS、architecture、layout 的字符预算按实际内容上调，保留超过 5% 的余量。
- `README.md`：运行方式、架构取舍、演示脚本。

## Order

1. 契约与门禁形状（本链）。
2. 服务端：健康检查 → 额度 → notes + Agent（先用假模型跑通）→ DeepSeek 实接。
3. Flutter：Web 先跑通文本链路，再接端上语音；最后构建 iOS、Android。
4. 演示视频与 README 收口；有余力再加 Wokwi。

## Proof

- `cd server && npm test`：并发 20 次请求恰好 10 次成功；同幂等键只扣一次；工具循环产生至少一次调用。
- `cd app && flutter test`：输入到结果的状态流转、额度错误提示。
- `make check-all`：文档门禁、契约破坏性、两端测试、运行时契约一致。
- `make e2e`：起服务后走一次提交与历史查询。
- 演示视频不超过 3 分钟，覆盖语音输入、摘要与待办、工具轨迹、第 11 次拒绝。
