# Plan: 设备会议通知的送达

## Files

1. `app/lib/core/notifications_io.dart`、`notifications_stub.dart`：`AppNotificationService.show(id, title, body)`，iOS 立即弹本地通知，Web 空实现。
2. `app/lib/features/chat/device_notices.dart`：取最后一条 system 消息、判断是否为新消息的纯函数。
3. `app/lib/app.dart`：登录后每 20 秒轮询日常对话、回到前台时立即检查；有新消息弹本地通知（Web 用 SnackBar）并刷新对话与线程列表；退出登录清空基线。
4. `app/test/device_notices_test.dart`：最后一条 system 消息的选取与新消息判断。
5. `docs/product.md` 4.9：补一句「App 前台轮询到时会弹本地通知」。

## Proof

- `make check-app` 全绿（analyze + 全部测试）。
- 手动：App 停在事项页时用设备上传一场会议，20 秒内收到本地通知；打开日常能看到系统消息。
