# 项目骨架

一套给 AI 编码代理用的项目规范骨架。复制一份到新项目里，填几个槽位，就能让代理按同一套流程干活：**契约先行 → worktree 并行 → 门禁收口**。

它不是代码模板，不假设语言和框架。它规定的是「什么东西放在哪、谁读什么、什么算做完」。

骨架里不含任务书——第一个任务来了才建 `.changes/<slug>/`，用那里的 `intent.md` 说清楚要做什么。

## 怎么用

```sh
cp -R agent-project-template my-new-project
cd my-new-project && git init
```

然后四步：

1. **填 `AGENTS.md` 的「项目约定」段**——项目名、构建测试命令、目录布局、语言与框架。
2. **填 `docs/architecture.md`**——组件、依赖方向、扩展点。这决定代理能不能理解代码边界。
3. **改 `docs/layout.md`**——你的目录归谁。
4. **换 `contract/openapi.yaml`**——当前只有健康检查，换成你的接口；同时更新 `contract/baseline/`。

改完跑 `make check`，全绿即可开工。

## 里面有什么

| 路径 | 作用 |
|---|---|
| `AGENTS.md` | 常驻规则。每个会话自动加载，只放「每次都该知道」的 |
| `docs/architecture.md` | 当前架构：组件、依赖方向、扩展点 |
| `docs/layout.md` | 目录地图：谁拥有哪个目录 |
| `docs/workflow.md` | 工作循环、门禁、环境故障排查 |
| `docs/decisions/` | 长期决策记录（ADR） |
| `contract/` | 唯一事实源 + 上一个版本的快照 |
| `.changes/` | 变更链：intent / spec / plan |
| `.agents/` | 文档标准、技能、文档门禁 |
| `scripts/` | 门禁脚本与环境脚本 |
| `Makefile` | 一条命令跑完所有检查 |
| `.config/wt.toml` | worktrunk 配置（每个 worktree 一个端口） |

`.agents/skills/` 里除 `product-marketing` 外都是流程技能，任何项目都用得上；`product-marketing` 是营销专用（生成并维护 `.agents/product-marketing.md`），不需要就删掉。

## 为什么是这几个东西

- **契约单独成目录**：两端唯一的耦合点，必须能被机器检查。
- **变更链而不是流水账**：`intent` 说问题，`spec` 说行为，`plan` 说这次怎么落地；落地后冻结归档。
- **常驻文档与变更记录分开**：前者描述“现在是什么”，后者描述“这次怎么做的”。混在一起就会同时过期。
- **门禁写成 `make check`**：只写在散文里的规则一定会漂移。
