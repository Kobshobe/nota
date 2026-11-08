# Plan: 会议录音设备

## Files

1. `contract/openapi.yaml`：版本 `0.7.0`；删除三条 `/api/device/utterances` 路径、`DeviceUtterance`、`UtteranceId`；新增 `POST /api/device/recordings` 与 `GET /api/device/recordings/{recordingId}`，复用 `Recording` 和 `deviceAuth`。
2. `server/src/db/schema.ts`：删除 `deviceUtterances`；`recordings` 增加可空 `deviceId`（FK `devices.id`）；删除 `DeviceUtteranceRow`。
3. `server/drizzle/0005_device-recordings.sql`：`ALTER TABLE recordings ADD COLUMN device_id text REFERENCES devices(id);` 与 `DROP TABLE device_utterances;`；用 `drizzle-kit generate` 重新生成 `meta/0005_snapshot.json` 和 `_journal.json`。
4. `server/src/config.ts`：删除 `deviceMaxSeconds`、`deviceMaxBytes`、`deviceUploadsPath`、`minimaxTts*`、`ttsMaxChars`、`ttsPath`、`ttsRetentionHours`；`.env.example` 同步删除。
5. `server/src/device-recordings.ts`（新）：设备鉴权、multipart 上传、写 `recordings`（带 `deviceId`）、`GET` 归属校验；处理直接调用 `recordings.ts` 导出的 `processRecording`。
6. `server/src/recordings.ts`：`toRecordingDto` 与 `processRecording` 保持导出；补充 `deviceId` 相关查询（如需要）。
7. `server/src/app.ts`：移除 TTS、`synthesizeSpeech`、`recoverDeviceUtterances`、`registerDeviceUtteranceRoutes`；注册 `device-recordings`；启动对账只保留 `recoverRecordings`。
8. 删除 `server/src/device-utterances.ts`、`server/src/tts/minimax.ts`、`server/test/device-utterances.test.ts`、`server/test/tts.test.ts`；`server/src/types.ts` 删除 `synthesizeSpeech` 装饰器类型。
9. `server/src/scripts/seed-device.ts`：保留设备 token 预置；去掉只为日常 thread 服务的建 thread 步骤。
10. `server/test/device-recordings.test.ts`（新）：上传 202、完成带 `threadId`、会议 thread 只有一条、额度扣减、失败退款、跨设备 404、无 token 401、超时长 400、坏格式 415、超大 413、启动对账 `INTERRUPTED`。
11. `device/firmware/nota_device.ino`：按键 + LED 状态机、整段上传、5 秒轮询、失败快闪 10 秒、重试语义、串口 `s` / `d`、内嵌 fixture。
12. `device/fixtures/meeting-01.mp3` + `device/firmware/fixture.h` + `device/tools/embed-fixture.mjs`：换约 40 秒双人会议音频，重新生成头文件。
13. `device/README.md`：按会议录音流程重写步骤、预期输出和排查表。
14. `docs/product.md`：S10、4.9、6.3 与术语改成设备会议录音；守住 5900 预算。
15. `docs/architecture.md`：组件、数据流、表、扩展点、限制里的设备语音改为设备会议录音，去掉 TTS 与 `device_utterances`。
16. `docs/engineering.md` 5.6：设备配置、上传、轮询、无音频下行、Wokwi 验收。

## Proof

- `make check`：文档门禁与契约破坏性检查；破坏性检查必须列出删除的设备语音路径。
- `make check-server`：`tsc --noEmit`、vitest 全绿、`PORT=8082 node scripts/check-contract.mjs` 运行时契约通过。
- `make check-app`：Flutter analyze / test 不受影响但保持全绿。
- Wokwi 手工 e2e：注入地址和 token，按 `s` 开始、再按 `s` 结束；看到上传 202、轮询、`completed`，App 主对话时间线出现会议卡片和纪要；灯按状态机变化。
- 独立 review 子代理按 `file:line` 报 P0/P1；P0 修复、P1 记录或修复后复核。
