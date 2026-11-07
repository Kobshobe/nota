# Intent: 启动先出首帧再请求通知权限

## Problem

iOS 启动时 `main()` 先 `await notifications.init()`，其中包含通知权限弹窗；用户看到的是权限弹窗后面的空白底，容易误判为登录后空白页。secure storage 恢复失败也可能让 `runApp` 永远不执行。

## Outcome

- 首帧先渲染登录页或已登录界面，再异步请求通知权限。
- secure storage 恢复或通知初始化失败时，应用仍能进入登录页，而不是空白。
- 路由构建异常时有可见的错误页，而不是空白。

## Constraints

- 不改变通知排期与取消逻辑。
- Web 端不调用通知插件。
