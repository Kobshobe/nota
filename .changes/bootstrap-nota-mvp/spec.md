# Spec: Nota MVP

## Behavior

- 登录：邮箱 + 密码；新邮箱自动注册，已有邮箱校验密码；JWT 7 天，无 session 表；邮箱含 `vip` 视为 Pro。
- Thread：登录后自动有“日常” thread；`POST /threads` 新建会议 thread；用户只能读自己的 thread。
- 消息：`POST /threads/{id}/messages` 接收 20,000 字以内文本与 `clientMessageId`；同键重试返回原结果。
- Agent：`pi-agent-core` 每次请求新建，messages 从 SQLite（Drizzle）恢复；工具为 create / update / delete / complete / search_items / finish。
- 写操作：工具先 staging；`finish` 在一个事务里提交并返回结构化 payload；没 finish 或报错则回滚。
- 输出：title、summary、3–7 条 keyPoints、候选 actions；summary / keyPoints 只读。
- 额度：Free 10 次/天，Pro 无限；一次用户消息扣 1 次，按钮操作 0 次；失败不扣、重试不重复扣。
- 错误：统一 `{code, message, details?, requestId}`；客户端按 code 映射文案。
- 通知：iOS 本地通知；Web 页面打开时应用内提示；删除 / 完成 / 退出时取消。

## Alternatives considered

- **Vercel AI SDK**：成熟、主流，但 agent 状态、事件和工具钩子要自己搭；`pi-agent-core` 更贴我们的对话形态。
- **`pi-coding-agent`**：带 coding 工具、JSONL session、资源发现；对 Nota 过重，不采用。
- **传统 OpenAI SDK 自写循环**：可控但重复造轮子；不如 `pi-agent-core`。
- **服务端 ASR**：会议录音需要，但 v1 先用文字；留 `/transcribe` 扩展点。
- **硬分 quick / meeting 类型**：按内容和用户入口组织 thread，输出结构自适应，不做类型分支。

## Areas of concern

- 同步处理 20,000 字可能持续几十秒；需要超时、loading、失败可重试，P1 上 SSE。
- JWT 无服务端吊销；短有效期 + 客户端退出，接受该限制。
- `pi-agent-core` 的 `finish` / `terminate` / staging 组合需要 spike 验证。
- Web 无后台推送；多设备通知不同步，v1 明确不做。
- SQLite 单进程；本地演示足够，不做水平扩展。
