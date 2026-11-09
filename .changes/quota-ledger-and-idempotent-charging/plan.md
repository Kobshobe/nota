# Plan: 额度可归因且扣费幂等

## Files

### 契约

- [`contract/openapi.yaml`](../../contract/openapi.yaml)：`POST /api/recordings` 增加可选请求头 `Idempotency-Key`；`Recording` 保持原样；描述里写明重复键返回既有记录。

### 服务端

- [`server/src/db/schema.ts`](../../server/src/db/schema.ts)：新增 `usage_events` 表与 `uniqueIndex('usage_events_user_key')`、`index('usage_events_user_day')`；`recordings` 增加 `uploadKey` 与 `uniqueIndex('recordings_user_upload_key')`（`where upload_key is not null`）。
- `server/drizzle/0006_*.sql`：用 `npx drizzle-kit generate` 产出迁移。
- [`server/src/quota.ts`](../../server/src/quota.ts)：`reserveQuota` / `confirmQuota` / `releaseQuota` / `reapExpiredReservations`；`getUsage` 不变；`chargeQuota` 与 `refundQuota` 移除。
- [`server/src/messages.ts`](../../server/src/messages.ts)：`sendMessageCore` 改为 reserve → 执行 → confirm；`fail()` 走 `releaseQuota`；`findStoredResponse` 之前先查账本行是否已 `committed`。
- [`server/src/recordings.ts`](../../server/src/recordings.ts)：上传读 `Idempotency-Key`，命中已有 `upload_key` 时直接返回既有记录（202）；`processRecording` 用 `rec:<recordingId>` 作账本键；`catch` 里释放；`recoverRecordings` 的退款改走 `releaseQuota`。
- [`server/src/config.ts`](../../server/src/config.ts)：`QUOTA_RESERVE_TTL_MINUTES`，默认 2；`DEMO_STUCK_PREFIX`，默认不配置。
- [`server/src/app.ts`](../../server/src/app.ts)：启动时在 `recoverRecordings` 之后跑一次 `reapExpiredReservations`，并按 TTL 同间隔（2 分钟）起定时器；`app.close()` 时清理该定时器。
- [`server/src/usage.ts`](../../server/src/usage.ts)：`GET /api/usage/last-anomaly`，取当前用户最新一条 `reserved` 或 `released` 的账本行，映射成一句话；只读。
- `server/scripts/reconcile-usage.mjs`（新）：对账脚本。按 `QUOTA_TIMEZONE` 把 `usage_events` 与 `messages` 的 `created_at` 归日（用 `Intl.DateTimeFormat`，不靠 SQL 的时区函数）。校验 `used` 与账本未释放行数是否相等（账本上线前的日子用当期 assistant 条数补差额）、每条 `committed` 是否有 assistant 产出、每条被 `stale` 释放的占用是否都没有产出。
- `server/test/quota.test.ts`：补幂等、两阶段、清扫、对账用例。
- `server/test/demo-stuck.test.ts`（新）：触发词让运行停在占用中、清扫后退回、未配置时行为不变。
- `server/test/recordings.test.ts`：补上传幂等与录音不重复扣费用例。

### 客户端

- [`app/lib/core/api.dart`](../../app/lib/core/api.dart)：`uploadRecording` 增加 `idempotencyKey` 参数并作为请求头发送。
- [`app/lib/features/meeting/recorder_screen.dart`](../../app/lib/features/meeting/recorder_screen.dart)：进入上传时生成一次 `clientRecordingId`，失败重试复用同一个，成功后丢弃。
- `app/test/recorder_test.dart`：断言重试使用同一个幂等键。
- [`app/lib/features/profile/profile_screen.dart`](../../app/lib/features/profile/profile_screen.dart)：底部加「检测误扣费」按钮，点后调自查接口并用弹窗显示返回的那句话。
- `app/lib/core/api.dart`：`checkChargeAnomaly`；`app/lib/features/chat/models.dart`：`ChargeCheck`。
- `app/test/charge_check_test.dart`（新）：点按钮只调一次，弹窗显示后端返回的话。

### 工具

- [`Makefile`](../../Makefile)：新增 `reconcile` 目标，跑 `node server/scripts/reconcile-usage.mjs`。

### 文档

- [`docs/engineering.md`](../../docs/engineering.md)：额度两阶段、账本与计数器的等式、幂等键存放位置。
- [`docs/architecture.md`](../../docs/architecture.md)：数据表补 `usage_events`，额度模块的职责描述更新。
- [`README.md`](../../README.md)：额度那一行的补充说明。

## Order

1. 改契约，跑 `make breaking` 与 `make contract`。
2. 加 `usage_events` 与 `recordings.upload_key`，生成迁移。
3. 重写 `quota.ts`，补单测（含对账断言与清扫）。
4. 接 `messages.ts`，确认现有幂等测试仍绿。
5. 接 `recordings.ts` 上传幂等与录音账本键。
6. 写对账脚本与 `make reconcile` 目标，在测试库上跑一次确认它能报出人为造出的差额。
7. 客户端传幂等键，补组件测试。
8. 同步文档。
9. `make check-all`，独立 review，修复后复核。

## Proof

- 服务端单测：第 11 次返回 429 且 `used` 停在 10；同一 `clientMessageId` 并发两次只扣一次、只调一次模型；reserve 之后模拟进程重启，`reapExpiredReservations` 把额度退回 0，重试成功后总共只扣 1；任一时刻 `usage_daily.used` 等于账本派生计数。
- 录音单测：同一 `Idempotency-Key` 上传两次只有一条 `recordings` 且只扣 1；转写失败后重试不产生第二次扣费；跨天重试时原日减 1、当日加 1，总量不变。
- 客户端测试：上传失败后点重试，两次请求携带同一个 `Idempotency-Key`。
- 自查接口：最近一条是无产出运行返回 `released`；最后一条正常计费但更早有可疑记录时仍返回那条；全都正常返回 `none`；别的用户看不到我的记录。
- 对账脚本：正常库上输出为空；人为造一条“扣费存在但无 assistant 消息”的数据后，脚本能定位到该用户与该日，并列出对应 `ref_id`。
- 手动：同一份录音文件用 `curl` 带同一 header 连发两次，`GET /api/threads` 只出现一场会议，`GET /api/usage` 只加 1。
- `make check-all` 全绿。
