# Spec: 启动先出首帧再请求通知权限

## Behavior

- `main()` 先恢复 token（失败则清空），立即 `runApp`。
- 通知服务在首帧之后异步初始化；权限弹窗覆盖登录页而不是空白。
- `ErrorWidget.builder` 显示可读失败文案；`GoRouter.errorBuilder` 显示返回按钮。
- 通知初始化失败只记录日志，不影响应用可用性。

## Alternatives considered

- **继续 await 通知初始化**：权限弹窗期间无首帧；不采用。
- **完全不请求通知权限**：iOS 提醒不可用；不采用。
- **只在 Web 加 loading 占位**：不解决 iOS 启动空白。

## Areas of concern

- 通知权限可能晚于用户首次创建提醒；排期时会懒初始化，仍能请求权限。
- `authStore.restore()` 仍有短暂等待，但不再被通知弹窗阻塞。
