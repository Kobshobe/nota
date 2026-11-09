# Plan: 设备上传即结束

## Files

1. `device/firmware/nota_device.ino`：删除 `pollRecording`、`POLL_INTERVAL_MS`、`POLL_TIMEOUT_MS` 与 `pendingId`；`uploadRecording` 成功即 `finishAttempt(true)`；`retryPending` 只重传没有拿到 `202` 的录音；保留 202 的 id 打印。
2. `device/design.md`：状态机表、录音与上传、模拟器映射、验收里的轮询描述改成「202 即结束」。
3. `device/README.md`：预期输出删除 `poll:` 行，排查表去掉轮询超时，限制里说明设备不等纪要。
4. `docs/engineering.md` 5.6：链路从「202 + 轮询」改成「202 → ASR → 建会」。
5. `docs/product.md`：设备只上传，不轮询。
6. Wokwi 工程：重新粘 `sketch.ino`，跑一遍上传，确认 202 后直接 `state: idle`，App 仍然出现会议。

## Proof

- 串口：`upload: HTTP 202` → `state: idle`，没有 `poll:` 行。
- App：设备上传后会议仍出现在绑定的账号时间线。
- `make check` 通过。
