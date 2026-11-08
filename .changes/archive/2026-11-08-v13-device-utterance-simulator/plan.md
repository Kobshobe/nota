# Plan: 设备语音快记模拟器

## Files

### 契约

- `contract/openapi.yaml`：`deviceAuth`、`DeviceUtterance`、`UtteranceId`、`/api/device/utterances`、`/api/device/utterances/{utteranceId}`、`/api/device/utterances/{utteranceId}/reply-audio`。

### 服务端

- `server/src/db/schema.ts`：`devices`、`device_utterances` 两张表；`server/drizzle/` 新迁移。
- `server/src/config.ts`：`DEVICE_MAX_SECONDS`、`DEVICE_MAX_BYTES`、`DEVICE_UPLOADS_PATH`、`MINIMAX_TTS_BASE_URL`、`MINIMAX_TTS_MODEL`、`MINIMAX_TTS_VOICE`、`TTS_MAX_CHARS`、`TTS_PATH`、`TTS_RETENTION_HOURS`。
- `server/src/devices.ts`（新）：token 生成与哈希、设备鉴权、`createDeviceRecord`。
- `server/src/device-utterances.ts`（新）：上传、状态、回复音频、异步任务、启动清扫。
- `server/src/tts/minimax.ts`（新）：T2A 请求与错误映射。
- `server/src/app.ts`、`server/src/types.ts`：注册路由、`synthesizeSpeech` 装饰器、启动清扫。
- `server/src/scripts/seed-device.ts`、`server/package.json`：`seed:device` 命令。
- `server/test/helpers.ts`、`server/test/device-utterances.test.ts`（新）：假 ASR/TTS、设备鉴权、主路径与失败路径。

### 固件

- `device/fixtures/utterance-01.mp3`：MiniMax TTS 生成的演示输入。
- `device/tools/embed-fixture.mjs`：MP3 → base64 头文件。
- `device/firmware/nota_device.ino`、`device/firmware/fixture.h`、`device/firmware/diagram.json`。
- `device/README.md`：seed → server → 隧道 → Wokwi → 串口 → 按键 → App 的步骤与限制。

### 文档

- `docs/architecture.md`：设备组件、TTS、数据流、两张表、扩展点。
- `docs/layout.md`：`device/` 行。
- `docs/engineering.md`：设备模拟器约定与限制。
- `docs/product.md`：设备快记（模拟器）行为；硬件发货仍是非目标。预算 5400 → 5700，给新增的设备用户故事与功能清单留出空间。
- `README.md`：设备模拟器入口链接。
- `.env.example`：TTS 与设备配置。

## Order

1. 契约，跑 `make check`。
2. 表、迁移、config、seed。
3. TTS 客户端、设备鉴权、路由、异步任务、测试。
4. 固件、fixture、diagram、运行手册。
5. 文档。
6. `make check-all`；seed、server、隧道、Wokwi 手动验收。
7. 独立 review，修复后提交并归档。

## Proof

- 服务端：seed 后设备上传 mp3，202 后轮询到 completed；日常 thread 出现转写消息与 assistant 回复，额度为 1；`reply-audio` 返回非空 mp3；TTS 失败仍 completed 且无音频；ASR 失败 failed 且不扣额度；撤销 token 返回 401；跨设备返回 404；启动清扫把 processing 标 INTERRUPTED。
- 固件：Wokwi 里按键后 LED 亮，串口打印 202，轮询到 completed 后打印 replyText 与音频字节数，LED 灭；失败闪 3 下。
- App：用 seed 的 demo 账号登录，日常 thread 看到同一条记录和提醒事项。
- `make check-all` 全绿。
