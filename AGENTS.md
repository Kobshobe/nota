# AGENTS.md

每个会话自动加载的常驻规则。只放「每次都该知道」的内容，细节推到各自的层。

## 路由

- 当前任务：看 `.changes/` 里有没有进行中的链；没有就是空闲，等一个任务
- 架构与模块边界：[`docs/architecture.md`](docs/architecture.md)
- 工程约定：[`docs/engineering.md`](docs/engineering.md)
- 目录地图：[`docs/layout.md`](docs/layout.md)
- 工作循环与环境：[`docs/workflow.md`](docs/workflow.md)
- API 唯一事实源：[`contract/openapi.yaml`](contract/openapi.yaml)
- 变更链规则：[`.changes/README.md`](.changes/README.md)
- 文档标准：[`.agents/references/doc-standard.md`](.agents/references/doc-standard.md)

## 铁律

- **契约是唯一事实源。** 字段名、错误码、状态码只能来自 `contract/openapi.yaml`，实现和 UI 都不得自行发明。
- **改契约必须走完整变更链**：intent、spec、plan 三层齐全；其余改动的层数按 `.changes/README.md` 的触发条件。
- **一个变更只做一件事。** 独立改动拆成独立提交，不夹带无关编辑。
- **文档随代码走。** 受影响的架构文档和目录地图在同一变更内更新。
- **机器能查的不要靠记忆。** 可机械检查的约定要进门禁；只写在散文里的规则一定会漂移。

## 变更链

- 每个非平凡变更有且只有一个链，位于 `.changes/`：`intent.md` 说解决什么，`spec.md` 说系统行为应当如何，`plan.md` 说这次怎么落地。
- 链由协调者拥有，实现者只读 `plan.md`，不写它；发现的问题写进汇报，由协调者决定是否回填 `spec.md`。
- 链是这次变更的历史快照，不是当前行为的权威；当前行为只属于架构文档、契约和源码。
- 未决问题写成 `[NEEDS CLARIFICATION: ...]`；`spec.md` 一旦存在，`intent.md` 里不允许残留。
- **把实现交给子 agent 时**，任务书只写环境、禁令和汇报格式；边界与验收让它读 `plan.md`。
- 落地后归档到 `.changes/archive/`，同时更新受影响的架构文档。

## 工程约定

- **优先用成熟依赖。** 只有当依赖真的删掉了自己的代码和测试才引入。
- **配置错误要早失败、大声失败。** 不给缺失的引用留静默兜底。
- **跨边界的标识用强类型。** 不让裸字符串在模块之间充当不透明 id。
- **封闭枚举穷尽处理。** 新增成员应当让遗漏分支变成编译错误或显式失败。
- **文件以恰好一个换行结尾。**

## 文档与文案

- 写当前状态，不写变更历史：不用「之前 / 现在 / 不再」，不引用 PR 号或提交号。
- 一个事实只有一个家，其它地方只留链接。
- 一段话占一个物理行，交给编辑器软换行。
- 文档有字符预算；超限要改注册表并说明理由。

## 机械检查

```sh
make check       # 文档门禁 + 契约破坏性
make check-all   # 再加两端测试与运行时一致性
```

**`make check-all` 必须全绿才算完。**

## 项目约定

- **架构**：Flutter 客户端（Web / iOS）+ Node 22 API，HTTP + JSON；唯一耦合点是 [`contract/openapi.yaml`](contract/openapi.yaml)。
- **环境**：`source scripts/env.sh`，它设置 Flutter SDK、pub 缓存、`PORT` 与 `API_BASE_URL`。
- **目录布局**：`contract/`、`server/`、`app/`、`docs/`、`scripts/`、`.changes/`；`.tmp/` 只放本地临时文件。
- **语言与框架**：服务端 Node 22 + TypeScript + Fastify + SQLite（Drizzle）；客户端 Flutter（Riverpod + Dio）；Agent 用 pi-agent-core + pi-ai，模型 DeepSeek `deepseek-flash`。
- **密钥与环境变量**：模型 key 只从 `.env` 读，提交 `.env.example`，绝不提交真实 key。

## 多代理与合并

- **并行写者必须各用一个 worktree。** 用 `wt switch -c feat/<slug>-<role>`；单写者小改才直接在 main 做。
- **生产端先合，消费端从合并后的 main 重开。** 契约只有一个作者，消费方只读契约。
- **非平凡变更合并前必须有独立 review 子代理。** 跨契约/数据/鉴权/Agent/并发/事务的改动都算；每个实现端至少一次，实现者不能自审，审查者只读，按 `file:line` 报 P0/P1/P2；P0 必修，P1 修复或记录延期，改动后复核。
- **子代理不提交、不 push。** 协调者负责 review 分诊、提交、合并和 push。
- **任务书单点。** 边界与验收写在 `.changes/<slug>/plan.md`；prompt 只说环境、禁令和汇报格式。

## 编辑本文件

- 只有「每个会话都必须知道」的规则放这里，每条一到三行。
- 删比加重要：压缩后语义不变就压缩。
- 不要把会过期的状态写在这里（例如「某某目录还不存在」），状态属于 `docs/` 和源码。
