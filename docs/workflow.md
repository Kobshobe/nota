# 工作循环与协作流程

所有非平凡变更围绕一个 `.changes/<slug>/` 链进行。链由协调者拥有，实现者只读 `plan.md`；当前行为只属于契约、架构文档和源码。

## 角色

- **协调者**：写 intent / spec / plan，拥有契约，拆任务，做集成、review 分诊、提交与推送。
- **生产者**：拥有契约的实现端（本项目是 `server/`）；完成、测试并交付分支，由协调者提交并合回主线。
- **消费者**：消费契约的一端（本项目是 `app/`）；必须从生产者合并后的主线重新开工作区，完成、测试并交付分支，由协调者提交并合并。
- **审查者**：独立的 review 子代理；只读，不改代码，不提交，只报问题。

同一个子代理不得同时承担实现和 review。非平凡变更的每个实现端至少一次独立 review；跨端变更在双方合并后再复核一次最终 diff。

## 工作区

单个写者的小改可以直接在 main worktree 做。**任何两个并行写者必须各用一个 worktree**，不要在同一目录同时写：

```sh
source scripts/env.sh
# 生产端
wt switch -c feat/<slug>-server
wt step copy-ignored          # 复制依赖与缓存

# 生产端实现、独立 review 后，由协调者在 server worktree 提交
git add -A && git commit ...
wt merge main
cd <main-worktree>

# 消费端
wt switch -c feat/<slug>-app
wt step copy-ignored

# 消费端实现、review 后，由协调者在 app worktree 提交
git add -A && git commit ...
wt merge main
cd <main-worktree>
```

- `wt merge main` 会自动删除当前 worktree；先 `cd` 回 main worktree，再建下一端。
- 子代理不得 `git commit`、`git push`、切换已有分支或删除 worktree。
- 协调者负责合并、提交、推送和用 `wt merge main` 清理。
- `wt switch` 不带 shell 集成时不会自动 `cd`，进入命令输出里的 `../<repo>.<branch>`。

## 一次变更的顺序

1. 协调者写 `intent.md`；改变系统行为或跨策略边界时补 `spec.md`；`plan.md` 写文件、顺序、负责人、验收。
2. 契约变更先由协调者单独提交到 main；消费端只读契约，发布冻结时再更新 baseline。
3. 生产者从 main 开 worktree，实现并写测试，跑 `make check-server`；完成后交给独立审查者。
4. 协调者提交生产者分支并 `wt merge main`；消费者从**合并后的 main** 重新开 worktree，实现、测试，跑 `make check-app`，并交给独立审查者。
5. 协调者提交消费者分支并合回 main；在 main 跑 `make check-all`、`make e2e` 和必要的手工验收，并让审查者复核双方合并后的最终 diff。
6. 推送；归档变更链，更新受影响的架构、工程和目录文档，随最终提交推送。

## 并行时的四条规矩

1. **生产端先合。**
2. **消费端从合并后的主线重开。**
3. **契约只有一个作者。** 消费方只读契约，不改它。
4. **任务书单点。** 边界与验收写在 `.changes/<slug>/plan.md`；prompt 只写环境、禁令和汇报格式。

## 独立 review

以下变更必须安排审查者：跨契约、数据库、鉴权、Agent、并发、事务/失败路径，或客户端与服务端的状态同步。

- 审查者拿到 `AGENTS.md`、契约、`docs/engineering.md`、`plan.md` 和完整 diff。
- 审查者只读：不改源码、文档、契约，不提交、不杀进程；可以跑测试和只读命令，测试产物除外。
- 发现问题按 `P0`（阻塞合并）/ `P1`（合并前修）/ `P2`（记录后修）输出，每条带 `file:line`、证据和建议。
- 协调者逐条分诊：P0 必须在合并前修复，不能延期；P1 修复或记录延期理由；P2 进入后续链。
- P0/P1 修复产生的新 diff 必须让同一审查者复核；复核通过前不能合并，不能只靠复跑门禁。
- 协调者自己实现的非平凡改动同样要独立审查；审查者不能是协调者本人。

审查清单：

- 契约字段、状态码、错误码与实现/客户端一致。
- 401 / 400 / 404 / 429 / 500 的路径与客户端映射。
- 用户隔离、JWT、密码与密钥。
- 额度预扣/退款、幂等、并发和跨天。
- 事务边界、finish 失败回滚、通知取消。
- 加载/空/错误态，候选状态、工具轨迹、dueAt 清空。
- 测试是否覆盖主场景和关键错误，而不是只覆盖 happy path。
- 文档、README 与发布时的契约 baseline 是否同步。

## 门禁

| 动了什么 | 必跑 | 跑什么 |
|---|---|---|
| 文档、`.changes` | `make check` | 文档门禁 + 契约破坏性 |
| 服务端 | `make check-server` | 再加 tsc、服务端测试、运行时契约 |
| 客户端 | `make check-app` | 再加 analyze、客户端测试 |
| 鉴权、存储、原生插件、依赖，或要说「iOS 可用」 | `make smoke-ios` | 模拟器装包 + 真实登录，不烧额度 |
| 演示、发布前 | `make check-all` + `make smoke-ios` + `E2E_MESSAGE=1 make e2e` | 全量 + 真实模型 |

不是每次都全跑。没跑过的平台只写「编译通过」；平台边界必须在真环境跑；兜底逻辑要有故障注入测试。门禁失败就是没做完，只有自动化门禁、没有独立 review 也不算完成。

## 端到端约定

- **断言结果页文本按 Key 取**，不要用 `find.text(<唯一值>)`：同一个值可能同时出现在输入框和结果页，会报 `is too many`。
- **等异步结果要轮询，不要 `pumpAndSettle`**：请求不调度帧，它会在结果到达前就返回。循环 `pump(100ms)` 直到目标出现，超时再 fail 并打印当前屏幕文本。

## 环境故障排查

**工具链启动就报 `Operation not permitted`。** 它可能要写自己安装目录下的缓存。把工具链复制进工作区，或放宽该路径的权限。

**xcodebuild 报 `Could not resolve package dependencies`。** 它要写 `~/Library/Developer/Xcode/DerivedData` 和 SwiftPM 缓存，这些路径必须可写。

**模拟器连不上本地 HTTP。** `ios/Runner/Info.plist` 需要 ATS 例外，否则请求被系统拦掉：

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

**`wt switch` 之后目录没变。** 没装 shell 集成，`cd` 到输出里的路径即可。
