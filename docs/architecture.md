# 架构

当前状态，不是设计史。产品范围见 [product.md](product.md)，工程规范见 [engineering.md](engineering.md)，接口见 [openapi.yaml](../contract/openapi.yaml)。

## 概览

Flutter（Web / iOS）经 HTTP + JSON 调 Fastify API；API 用 pi-agent-core + pi-ai 跑 Agent，SQLite 存业务数据。设备端（Wokwi）走设备 token，不经过登录；唯一耦合点是契约。

## 组件

| 组件 | 职责 | 依赖 |
|---|---|---|
| Flutter app | 登录、对话、事项、历史、通知 | → API |
| Wokwi ESP32 | 按键、LED、上传音频、下载 TTS | → API（隧道） |
| Fastify API | JWT / 设备 token、threads / messages / items / usage / 设备语音 | → SQLite、Agent、ASR、TTS |
| Agent | pi-agent-core 循环、工具、finish | → pi-ai、DeepSeek |
| SQLite（Drizzle） | 全部业务表；schema 在 `db/schema.ts` | — |
| 外部服务 | DeepSeek `deepseek-flash`；MiniMax `asr-1.0` / `speech-2.8-hd` | — |

依赖只能从消费方指向被依赖方；契约不知道自己被谁用。

## 数据流

用户消息 → 鉴权与额度预扣 → Agent → 工具 staging → finish 提交 → SQLite → Flutter。会议录音：上传 → 转写 → 建会 → 同一条 Agent 管线。设备语音：上传 → 转写 → 日常 thread → Agent → TTS → 设备下载。

## 数据

| 表 | 关键字段 |
|---|---|
| `users` | id、email、password_hash |
| `threads` | id、user_id、kind（daily / meeting）、title |
| `messages` | id、thread_id、role、content、payload_json、client_message_id |
| `items` | id、user_id、thread_id、kind、title、due_at、status |
| `tool_calls` | id、message_id、name、arguments_json、result_json |
| `usage_daily` | user_id、day、used |
| `recordings` | id、user_id、status、audio_path、thread_id |
| `devices` | id、user_id、token_hash、revoked_at |
| `device_utterances` | id、device_id、status、reply_text、reply_audio_path |

没有 sessions 表；JWT 无状态。时间存 UTC，额度日界 Asia/Shanghai；`client_message_id` 唯一，用于幂等。

## 扩展点

- **新增工具**：注册 `AgentTool`，同步契约里的 `ToolCall.name` 枚举。
- **转写 / TTS**：`server/src/asr/`、`server/src/tts/` 是唯一适配器；换供应商不改 Agent 与设备协议。
- **Web 录音**：webm/opus 由 ffmpeg 转 m4a 后转写。
- **流式**：订阅 pi-agent 事件映射 SSE；v1 先同步。
- **设备**：`devices` 表 + 设备 token；`device-utterances` 是唯一入口，真机替换固件即可。

## 已知限制

- 会议录音上限 8 分钟；转写在 API 进程内，重启把未完成记录标失败。
- 设备模拟器没有麦克风、扬声器、BLE：输入是固定 MP3，输出只打印；HTTPS 不校验证书。
- 同步处理，20,000 字可能几十秒；SSE 为 P1。
- SQLite 单进程；不做水平扩展。
- JWT 无服务端吊销；退出只清客户端。
- Web 无后台推送；多设备通知不同步。
