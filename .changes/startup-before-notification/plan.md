# Plan: 启动先出首帧再请求通知权限

## Files

- `app/lib/main.dart`：先 `runApp`，通知初始化改为未等待的异步任务；恢复失败兜底。
- `app/lib/core/router.dart`：增加 `errorBuilder` 可见错误页。
- `app/test/`：现有登录、通知、路由测试回归。

## Order

1. 调整启动顺序和错误兜底。
2. 重建 iOS，确认权限弹窗覆盖登录页。
3. 重建 Web，真实登录进入日常。
4. 跑 `make check-all` 并提交。

## Proof

- iOS 模拟器首屏截图显示登录页（权限弹窗不再挡在空白底上）。
- Web 新账号登录后进入“日常”，截图可见。
- `flutter analyze`、`flutter test`、`make check-all` 通过。
