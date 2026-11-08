# Plan: 发出第一条内容才创建会议

## Files

- `app/lib/features/chat/new_meeting_screen.dart`（新）：空白会议页，发送时才建会并转发首条消息。
- `app/lib/features/chat/chat_composer.dart`（新）：从 `chat_screen.dart` 抽出的输入条，两个页面共用。
- `app/lib/features/chat/chat_screen.dart`：会议按钮改为跳转（防重复点击）；删掉「最近会议」横条；时间线改用 `buildTimeline`。
- `app/lib/features/chat/timeline.dart`（新）：消息保持原序、会议按创建时间插入的稳定合并。
- `app/lib/core/router.dart`：新增 `/meeting/new`。
- `app/test/meeting_entry_test.dart`：只进空白页不建会、发首条内容才建会、发送失败后重试复用同一场会议、时间线卡片可进入。
- `app/test/timeline_test.dart`（新）：同一时间戳问答不倒序、会议插在消息之间。
- `app/test/test_helpers.dart`：`FakeApi` 记录每个 thread 的消息，供会议页回读。
- `docs/product.md`、`docs/engineering.md`：交互与目录同步。

## Order

1. 变更链。
2. 抽输入条 → 空白会议页 → 路由。
3. 对话页时间线卡片。
4. 测试与文档。
5. `make check-all`、重建 Web 与 iOS、独立 review 后提交。

## Proof

- `meeting_entry_test`：点按钮后 `threads` 里没有会议；发送首条内容后恰好一条会议且页面变成会议对话；发送失败停在空白页、重试后仍只有一场会议且 `clientMessageId` 不变；时间线卡片可点进会议。
- `timeline_test`：20 轮同时间戳问答保持原顺序；会议按创建时间插入。
- `flutter analyze` + `flutter test` 全绿，`make check-all` 全绿。
- Web / iOS 手动：事项 → 日常 → 右上角会议 → 空白页输入 → 进入会议 → 返回日常看到会议卡片。
