# 架构

当前状态，不是设计史。产品范围见 [product.md](product.md)，工程规范见 [engineering.md](engineering.md)，接口见 [openapi.yaml](../contract/openapi.yaml)。

## 概览

Flutter 客户端（Web / iOS）通过 HTTP + JSON 调用 Fastify API；API 内用 pi-agent-core + pi-ai 跑 Agent，SQLite 存用户、对话、事项、工具轨迹和额度。唯一耦合点是契约。

## 组件

| 组件 | 职责 | 依赖 |
|---|---|---|
| Flutter app | 登录、对话、事项、历史、通知 | → API |
| Fastify API | JWT、threads / messages / items / usage | → SQLite、Agent |
| Agent | pi-agent-core 循环、工具、finish | → pi-ai、DeepSeek |
| pi-ai | 模型、供应商、tool calling | → DeepSeek |
| SQLite（Drizzle） | users / threads / messages / items / tool_calls / usage_daily / recordings；schema 在 `db/schema.ts` | — |
| DeepSeek | deepseek-flash | — |
| MiniMax ASR | asr-1.0 转写、说话人分离 | — |

依赖只能从消费方指向被依赖方；契约不知道自己被谁用。

## 数据流

用户消息 → 鉴权与额度预扣 → Agent（pi-agent-core）→ 工具 staging → finish 提交 → SQLite → 响应 → Flutter 展示；刷新 thread 时工具轨迹随消息返回；iOS 本地通知，Web 应用内提示。会议录音另走一条入口：上传 → 转写 → 建会 → 同一条 Agent 管线。

## 数据

| 表 | 关键字段 |
|---|---|
| `users` | id、email、password_hash、created_at |
| `threads` | id、user_id、kind（daily / meeting）、title、时间 |
| `messages` | id、thread_id、role、content、payload_json、client_message_id |
| `items` | id、user_id、thread_id、kind、title、due_at、source_message_id、candidate_index、status |
| `tool_calls` | id、message_id、name、arguments_json、result_json |
| `usage_daily` | user_id、day、used |
| `recordings` | id、user_id、status（transcribing / completed / failed）、audio_path、transcript_json、thread_id |

没有 sessions 表；JWT 无状态。时间存 UTC，额度日界 Asia/Shanghai；`client_message_id` 唯一，用于幂等。

## 扩展点

- **新增工具**：注册 `AgentTool`，同步契约里的 `ToolCall.name` 枚举。
- **换转写供应商**：`server/src/asr/` 是唯一适配器，替换 `transcribeAudio` 装饰即可，Agent 与契约不变。
- **Web 录音格式**：浏览器录 webm/opus，服务端用 ffmpeg 转 m4a 后转写。
- **流式**：订阅 pi-agent 事件并映射 SSE；v1 先同步。
- **硬件**：设备 token 调 `/device/utterances`，复用 Agent 与额度。

## 已知限制

- 会议录音上限 8 分钟：转写单次 500 秒，不做切片；转写任务在 API 进程内，重启会把未完成的记录标成失败。
- 同步处理，20,000 字输入可能几十秒；SSE 为 P1。
- SQLite 单进程；不做水平扩展。
- JWT 无服务端吊销；退出只清客户端。
- Web 无后台推送；多设备通知不同步。
