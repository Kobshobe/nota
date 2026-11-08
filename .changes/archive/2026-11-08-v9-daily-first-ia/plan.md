# Plan: 事项优先，会议从主对话进入

## Files

- `app/lib/core/router.dart`：`/` 改为 `ItemsScreen`，删掉 `AppShell` 引用。
- `app/lib/features/shell/app_shell.dart`：删除。
- `app/lib/features/chat/threads_screen.dart`：删除（含新建会议弹窗）。
- `app/lib/features/items/items_screen.dart`：AppBar 加额度徽标与退出登录；右下角悬浮按钮进入 daily thread。
- `app/lib/features/chat/chat_screen.dart`：右上角会议按钮（daily 才有）、去掉额度徽标、daily 顶部「最近会议」卡片区、进入时刷新 threads。
- `app/lib/features/chat/threads_controller.dart`：`createMeeting` 在列表未加载时先刷新，不用空列表覆盖。
- `app/test/test_helpers.dart`：`FakeApi.createThread` 用服务端默认标题「新会议」。
- `app/test/`：新增 `home_items_test.dart`、`meeting_entry_test.dart`；删掉 `empty_conversations_test.dart`；`send_message_test.dart`、`quota_exhausted_test.dart` 去掉对话页额度徽标断言；`test_helpers.dart` 增加 `testRoutedApp` 与会议详情兜底。
- `docs/product.md`、`docs/engineering.md`、`README.md`、`app/README.md`：交互入口与目录同步。
- `app/integration_test/login_smoke_test.dart`：登录冒烟改判「进入事项首页」。

## Order

1. 变更链。
2. 路由与首页：`/` 指向事项页，悬浮按钮进主对话。
3. 对话页：会议按钮、卡片区、额度徽标下移。
4. 删除线程列表页与 `AppShell`，清理引用。
5. 测试：新增/替换场景，`flutter analyze` + `flutter test`。
6. `make check-all`、重建 Web、`make smoke-ios`，独立 review 后提交。

## Proof

- `app/test/`：事项页有悬浮按钮，点击后进入「日常」；主对话点会议按钮后进入标题为「新会议」的对话；有会议时卡片可见且可点进；主对话 AppBar 不再出现额度/VIP 徽标。
- `flutter analyze` 无告警，`make check-all` 全绿。
- 手动：Web 与 iOS 模拟器上「登录 → 事项 → 悬浮按钮 → 日常 → 右上角会议 → 直接输入」全链路走通。
