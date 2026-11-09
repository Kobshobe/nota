# Spec: 设备会议只留一张卡片

## Behavior

- 日常对话的时间线不再渲染 `role = system` 的消息；设备会议只以会议卡片出现。
- 会议卡片按 `system` 消息的 `payload.meetingThreadId` 判断来源：来自设备的卡片显示「设备录音」标识与麦克风图标，App 自己录的会议仍显示「会议」和群组图标。
- 弹本地通知的逻辑不变，仍以最新的 system 消息为准。
- 服务端不改：system 消息照写，契约不变。

## Alternatives considered

- 删掉 system 消息、改用线程上的 source 字段：要改契约、加迁移，收益只是数据更干净；当前用 system 消息已经能表达来源。
- 保留两条但换成不同样式：用户要的是「一条记录」，不是两种样式。

## Areas of concern

- 其他客户端如果直接展示 system 消息，仍会看到这条；当前只有这个 App。
- 卡片标识依赖 system 消息存在；如果服务端以后不写 system 消息，卡片会退回普通「会议」样式（不会出错）。
