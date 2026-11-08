# Intent: 多代理工作流与独立 review

## Problem

并行开发时，两个写者共用同一个 worktree，没有独立 review；自动化门禁通过就被当成完成。这样会漏掉跨端一致性、事务、并发和 UI 状态问题，也会让实现者的自审盲区进入主线。

## Outcome

- 并行写者各自使用 worktree，生产端先合并，消费端从新主线重开。
- 非平凡变更在合并前必须由独立 review 子代理只读审查，产出 P0/P1/P2。
- 协调者负责分诊、修复、门禁、提交和推送。
- 规则写进 `AGENTS.md`，具体步骤写进 `docs/workflow.md`。

## Constraints

- 小改和文档改动不强制开 worktree 或 review。
- 不改变现有契约、代码行为和门禁命令。
