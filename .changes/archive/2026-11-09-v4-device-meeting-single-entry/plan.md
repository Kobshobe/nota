# Plan: 设备会议只留一张卡片

## Files

1. `app/lib/features/chat/timeline.dart`：`timelineMessages` 过滤 system 消息；`deviceMeetingIds` 从 system 消息的 `meetingThreadId` 取会议 id。
2. `app/lib/features/chat/chat_screen.dart`：时间线用过滤后的消息；`_MeetingTile` 增加 `fromDevice`，设备会议换麦克风图标、标签「设备录音」。
3. `app/lib/features/chat/message_bubble.dart`：删除不再使用的 `_SystemNotice` 与 go_router 依赖。
4. `app/test/timeline_test.dart`：覆盖过滤与来源判断；删除 `system_message_test.dart` 中通知条的用例。
5. `docs/product.md`、`device/design.md`：设备会议在时间线里只有一张带「设备录音」标识的卡片。

## Proof

- `make check-app` 全绿。
- App 里设备会议只出现一张卡片；App 录音的会议仍是「会议」。
