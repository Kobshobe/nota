# Plan: 多代理工作流与独立 review

## Files

- `AGENTS.md`：多代理与合并规则，移除临时收尾清单。
- `docs/workflow.md`：角色、worktree、顺序、review 清单、门禁和端到端约定。
- `Makefile`：服务端 gate 加 `tsc --noEmit`，客户端 gate 加 `flutter analyze`。
- `.agents/scripts/doc-budgets.json`：workflow 文档预算随内容上调。

## Order

1. 写 worktree 与独立 review 规则。
2. 更新工作流文档和预算。
3. `make check-all` 验证文档、两端测试、类型检查、analyze 和契约。
4. 独立 review 复核 P0/P1 修复后归档本变更链。

## Proof

- `make check-all` 全绿。
- 独立审查者复核后确认没有 P0/P1。
- 文档中的命令与 `wt v0.81.0`、现有 `Makefile` 一致。
- AGENTS.md 只保留常驻规则，细节链接到 `docs/workflow.md`。
