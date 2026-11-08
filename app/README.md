# Nota Flutter 客户端

Nota 的 Web / iOS 客户端：登录、日常对话、会议录音转纪要、候选事项确认、事项管理、本地提醒。

## 运行

```sh
# 默认连接 http://127.0.0.1:8080
flutter run -d chrome
flutter run -d ios

# 指定 API
flutter run -d chrome --dart-define=API_BASE_URL=http://127.0.0.1:8080
```

## 检查

```sh
flutter analyze
flutter test
flutter build web
```

## 结构

- `lib/core/`：Dio + 拦截器、token 存储、路由、主题、通知。
- `lib/features/auth/`：登录 / 自动注册。
- `lib/features/chat/`：主对话、候选事项、额度。
- `lib/features/meeting/`：录音页、录音抽象、录音字节读取。
- `lib/features/items/`：事项列表与增删改完成。
- `lib/shared/`：通用展示组件与时间格式。

通知：iOS 用 `flutter_local_notifications` 按 dueAt 排本地通知；Web 不调用通知插件，页面打开时由应用内定时检查弹出提示。
