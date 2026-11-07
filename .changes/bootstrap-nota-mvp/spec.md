# Spec: Nota MVP

## Behavior

- 身份：客户端首次启动生成 UUID，作为 `X-Client-Id` 随请求发送；服务端按它归属笔记与额度。
- 提交：`POST /api/notes` 接收文本与幂等键；同一幂等键重复提交返回同一条笔记，不重复扣额度。
- Agent：服务端用 DeepSeek 的 function calling 循环，至少注册 `create_todo`、`create_reminder`、`search_history`；工具参数由模型生成，结果回填后再产出最终回复。
- 展示：响应包含 transcript、summary、todos、toolCalls、usage；客户端展示工具调用轨迹。
- 额度：按 client id 与 Asia/Shanghai 自然日计数；第 11 次返回 429 与 `QUOTA_EXCEEDED`；跨天重置；并发与重试下计数不超过 10。
- 历史：`GET /api/notes` 返回当前 client 的笔记；`GET /api/notes/{id}` 只返回自己的笔记，否则 404。
- 错误：错误响应恒为 `{code, message}`，code 只能取契约枚举；未知错误 500 `INTERNAL`。
- 语音：端上识别为主，文本输入始终可用；识别失败不阻塞文本提交。

## Alternatives considered

- **React Web + 独立 Flutter App**：两套 UI 与两套联调，48 小时内会挤占 Agent 与额度证明的时间，放弃。
- **只做手机 App**：缺 Part B 必交的网页版本，放弃。
- **服务端 ASR（GLM-ASR / SenseVoice）**：跨端一致，但多一条上传链路和一个 key；v1 用端上识别，保留 `SpeechService` 抽象以后替换。
- **硬件 v1 实做**：加分但成本高；本期只留设备接入点，后续用 Wokwi 模拟。

## Areas of concern

- Web 端语音依赖浏览器（Chrome 系），演示用 Chrome 或手机；文本兜底必须可见。
- 匿名 client id 可被重置或伪造，额度只防误用不防刷；README 说明这一点。
- 同步 Agent 调用会让请求持续数秒，客户端需要 loading 与超时提示。
- 48 小时窗口下，先保证必交项与额度证明，再加 App 构建和加分项。
