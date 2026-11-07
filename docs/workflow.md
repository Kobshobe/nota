# 工作循环与环境

## 工具：worktrunk

`wt` 是一个管理 git worktree 的 CLI，按**分支名**寻址，不用记路径。

```sh
brew install worktrunk     # 或 cargo install worktrunk
wt --version
```

不装 shell 集成也能用，但切换后**不会自动 `cd`**，要自己进命令输出里的 `../<repo>.<branch>` 目录。项目配置在 [`.config/wt.toml`](../.config/wt.toml)。

| 命令 | 作用 |
|---|---|
| `wt switch -c feat/x` | 建分支 + 建 worktree，并切过去 |
| `wt list` | 列出所有 worktree、脏状态、领先主线的提交数 |
| `wt step copy-ignored` | 把 gitignored 的文件（依赖、构建缓存）复制到新 worktree |
| `wt merge main` | 把当前分支合回主线，**并自动删除 worktree 与分支** |

## 一次变更的循环

```sh
source scripts/env.sh

wt switch -c feat/<slug>        # 从当前 HEAD 建 worktree
wt step copy-ignored            # 带上依赖缓存（reflink，秒级）
# ... 在 worktree 里实现、写变更链 ...
wt merge main                   # 合并并自动清理
```

多端时的顺序：

1. 生产端（拥有契约的那端）先做、先合。
2. **消费端必须从合并后的主线重新开 worktree**，否则拿不到生产端的代码。
3. 在主线跑全量门禁和端到端。

## 并行时的四条规矩

1. **生产端先合。**
2. **消费端从合并后的主线重开。**
3. **契约只有一个作者。** 消费方只读契约，不改它。
4. **任务书单点。** 派子 agent 时，边界与验收写在 `.changes/<slug>/plan.md`，prompt 里只说环境、禁令和汇报格式。

## 门禁

| 命令 | 跑什么 | 什么时候用 |
|---|---|---|
| `make check` | 文档门禁 + 契约破坏性比对 | 骨架阶段、只有一方时 |
| `make check-all` | 再加两端测试与运行时契约一致性 | 完成标准 |
| `make e2e` | 端到端 | 合并前最后一道 |

门禁失败就是没做完，不要绕过去。

## 端到端的两条约定

- **断言结果页文本按 Key 取**，不要用 `find.text(<唯一值>)`：同一个值可能同时出现在输入框和结果页，会报 `is too many`。
- **等异步结果要轮询，不要 `pumpAndSettle`**：请求不调度帧，它会在结果到达前就返回。循环 `pump(100ms)` 直到目标出现，超时再 fail 并打印当前屏幕文本。

## 环境故障排查（示例：Flutter + iOS）

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
