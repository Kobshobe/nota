# Spec: 设备会议完成消息

## Behavior

- 设备录音转写成功、纪要写入会议 thread 后，服务端在拥有者的「日常」对话追加一条 `role = system` 的消息：content 为「设备录音已整理成会议：<会议标题>」，payload 带 `meetingThreadId`。
- 「日常」对话的 `updatedAt` 同步前移，时间线里它会升到最上面。
- 同一条会议只写一次：处理重试时按 `payload.meetingThreadId` 去重。
- App 自己录的会议不写；转写失败不写；这条消息不扣额度、不触发通知。
- 契约：`Message.role` 增加 `system`；`MessagePayload` 增加可选 `meetingThreadId`。
- App 把 system 消息渲染成居中的通知条，右侧「查看会议」跳转到会议对话；没有 `meetingThreadId` 时只显示文本。

## Alternatives considered

- APNs 推送：手机锁屏也能收到，但需要开发者账号、证书、设备 token 注册和通知服务，Web 也拿不到；不在 v1。
- 前台轮询 + 本地通知：App 被挂起就停了，只能覆盖「正看着手机」的情况。
- 只靠会议卡片（现状）：用户不刷新就不知道，等于没有通知。

## Areas of concern

- 用户不打开 App 不会看到；这是「无推送」的已知代价。
- 「日常」对话被顶到时间线最上面，会改变列表顺序。
- system 消息没有已读 / 未读，重复打开会重复看到同一条。
