# Plan: 设备会议完成消息

## Files

1. `contract/openapi.yaml`：版本 `0.8.0`；`Message.role` 枚举加 `system`；`MessagePayload` 加可选 `meetingThreadId`。
2. `server/src/domain.ts`、`server/src/lib/dto.ts`、`server/src/db/schema.ts`：`MessagePayload.meetingThreadId`、`MessageDto` 角色联合、`messages.role` 枚举、`parsePayload` 白名单。
3. `server/src/recordings.ts`：设备录音处理成功后，`ensureDailyThread` + 去重 + 写入 system 消息并前移日常 thread 的 `updatedAt`；通知失败只记日志，不影响录音完成。
4. `server/test/device-recordings.test.ts`：设备会议后日常对话出现 system 消息、带 `meetingThreadId`；`server/test/recordings.test.ts`：App 录音不写。
5. `app/lib/features/chat/models.dart`：`MessageRole.system`、`MessagePayload.meetingThreadId`。
6. `app/lib/features/chat/message_bubble.dart`：system 消息的通知条与「查看会议」跳转。
7. `app/test/system_message_test.dart`：通知条渲染与按钮。
8. 文档：`docs/product.md` 设备会议、`docs/architecture.md` 消息角色、`device/design.md` 服务端行为。

## Proof

- `make check-all` 全绿。
- 设备上传 → 日常对话出现 system 消息，App 里点「查看会议」进入会议。
