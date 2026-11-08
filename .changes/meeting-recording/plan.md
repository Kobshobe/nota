# Plan: 会议录音转纪要

## Files

### 契约

- `contract/openapi.yaml`：新增 `POST /api/recordings`、`GET /api/recordings/{id}`、`POST /api/recordings/{id}/retry`；`Recording` schema；错误复用 `NOT_FOUND` / `INVALID_INPUT`，新增 `TRANSCRIPTION_FAILED`。

### 服务端

- `server/src/db/schema.ts`：`recordings` 表（id、user_id、status、mime、size、duration_ms、audio_path、transcript_json、thread_id、error_code、error_message、created_at、updated_at）。
- `server/src/config.ts`：`MINIMAX_API_KEY`、`MINIMAX_ASR_BASE_URL`、`MINIMAX_ASR_MODEL`、`RECORDING_MAX_SECONDS`、`RECORDING_MAX_BYTES`、`RECORDING_RETENTION_HOURS`。
- `server/src/asr/minimax.ts`（新）：调 `POST /v1/speech_to_text`，映射上游错误。
- `server/src/asr/transcript.ts`（新）：把 `segments` 合并成 `说话人 N：内容` 的全文。
- `server/src/recordings.ts`（新）：上传、状态查询、重试、后台任务、启动清扫。
- `server/src/messages.ts`：把路由里的发送逻辑抽成 `sendMessageCore`，供录音任务复用。
- `server/src/app.ts`：注册 `@fastify/multipart` 与录音路由。
- `server/package.json`：加 `@fastify/multipart`。
- `server/test/recordings.test.ts`（新）、`server/test/asr.test.ts`（新）、`server/test/helpers.ts`：注入假 ASR。

### 客户端

- `app/pubspec.yaml`：`record`、`path_provider`。
- `app/lib/features/meeting/recorder.dart`（新）：录音抽象（开始 / 停止 / 暂停 / 音量流 / 权限），测试可替换。
- `app/lib/features/meeting/recorder_screen.dart`（新）：四态页面、计时、8 分钟自动停、上传与轮询、失败重试、粘贴文字入口。
- `app/lib/core/api.dart`：`uploadRecording` / `getRecording` / `retryRecording`。
- `app/lib/core/router.dart`：新增 `/meeting/record`。
- `app/lib/features/chat/chat_screen.dart`：会议按钮改跳录音页。
- `app/ios/Runner/Info.plist`：`NSMicrophoneUsageDescription`、`UIBackgroundModes: audio`。
- `app/test/recorder_test.dart`（新）、`app/test/test_helpers.dart`：假录音器与假 API。

### 文档

- `docs/product.md`：S3、4.2、4.5、6.3 改为录音流程。
- `docs/architecture.md`：组件表加 ASR，数据表加 `recordings`，扩展点更新。
- `docs/engineering.md`、`docs/layout.md`：新模块与目录。

## Order

1. 契约先行，跑契约检查。
2. 服务端表、配置、ASR 适配器、转写格式化 + 单测。
3. 抽出 `sendMessageCore`，实现录音路由与后台任务 + 接口测试（注入假 ASR）。
4. 客户端依赖、录音抽象、录音页、路由、API + 组件测试。
5. 文档同步。
6. `make test-fast`、`make check`；Web 与 iOS 构建后手动验证。
7. 独立 review，修复后提交。

## Proof

- 服务端：上传音频后轮询到 `completed` 且出现一场会议；会议首条消息是带说话人编号的全文；额度只扣 1；转写失败时 `failed` + 音频仍在，重试后复用同一会议且不重复扣额度；启动清扫把卡住的记录标 `failed`。
- 客户端：权限被拒时出现「粘贴文字」；计时到 480 秒自动停止；停止后进入上传 → 轮询 → 会议页；失败时出现重试；离开页面不报错。
- `make test-fast` 全绿，`make check` 全绿。
- 手动：Chrome 录 20 秒中文 → 会议出现在时间线并带纪要；iOS 模拟器录一段，锁屏后仍继续，回来能出纪要。
