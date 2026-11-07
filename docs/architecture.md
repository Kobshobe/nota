# 架构

当前状态，不是设计史。改动影响到的段落要跟着改。

## 概览

Flutter 客户端（Web、iOS、Android）通过 HTTP + JSON 调用 Node API，唯一耦合点是 [`contract/openapi.yaml`](../contract/openapi.yaml)。API 内跑 Agent 循环，SQLite 存笔记、待办、工具轨迹与额度。

## 组件

| 组件 | 职责 | 依赖方向 |
|---|---|---|
| Flutter app | 录音与端上转写、展示摘要/待办、历史、额度 | → API |
| Node API | 校验、额度、Agent 编排、持久化 | → SQLite、DeepSeek |
| Agent | 调工具、组织回复、记录轨迹 | → DeepSeek |
| SQLite | notes、todos、tool_calls、usage_daily | — |
| DeepSeek | 摘要、待办、function calling | — |

依赖只能从消费方指向被依赖方；契约不知道自己被谁用。

## 数据流

麦克风 → 端上 STT → 文本 → `POST /api/notes` → 额度原子扣减 → Agent 循环调工具 → SQLite → 响应 → 界面展示摘要、待办与工具轨迹。

## 扩展点

- **新增工具**：在工具注册表登记，并同步契约里的 `ToolCall.name` 枚举。
- **新增 ASR**：替换 Flutter 的 `SpeechService`，或加服务端 `/api/transcribe`；Agent 不变。
- **硬件接入**：Wokwi 或 ESP32 用设备 token 调新增的 `/api/device/utterances`，复用 Agent 与额度。

## 已知限制

- 匿名 `X-Client-Id` 可被重置，额度只防误用不防刷。
- 端上 STT 依赖系统或浏览器，Web 以 Chrome 系为准。
- 同步处理、单进程 SQLite；不做水平扩展。
