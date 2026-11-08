# Spec: 会议录音设备

## Behavior

### 设备身份与归属

- `npm --prefix server run seed:device` 创建或复用 demo 用户、创建一台设备并打印 email、password、deviceId、token；明文 token 只出现一次，数据库只存 SHA-256。
- 设备请求带 `Authorization: Bearer <device-token>`；token 缺失、无效、被撤销或设备不存在返回 401 `UNAUTHORIZED`。
- 设备录音在 `recordings.device_id` 上记录来源；设备只能读取自己创建的录音，跨设备访问返回 404。

### 上传

- `POST /api/device/recordings`，multipart，字段 `audio`（必填）和 `durationMs`（可选）。
- 接受现有音频白名单格式；不支持返回 415，超过 `RECORDING_MAX_BYTES` 返回 413，`durationMs` 超过 `RECORDING_MAX_SECONDS`（默认 480 秒）或格式非法返回 400，空文件返回 400。
- 音频写盘后插入一条 `recordings`（`user_id` 为设备绑定的用户、`device_id` 为当前设备、`status = transcribing`），返回 202 和 `Recording`，异步处理不阻塞请求。

### 处理

- 复用会议管线：`prepareAudio`（必要时转码）→ ASR → 转写成功后创建 `kind = meeting` 的 thread → 转写全文作为第一条用户消息走 `sendMessageCore`（扣额度、跑 Agent、写纪要）。
- 原始音频在转写成功后删除；失败保留 `RECORDING_RETENTION_HOURS`（默认 24 小时）。
- 失败写 `errorCode`：转写失败 `TRANSCRIPTION_FAILED`，额度不足 `QUOTA_EXCEEDED`，进程重启打断 `INTERRUPTED`；额度按 `sendMessageCore` 的退款规则退回。
- 失败时如果会议还没有任何消息，删除空 thread，时间线里不出现空会议。
- 服务启动时把遗留的 `transcribing` 标成 `failed / INTERRUPTED`，并清理过期音频。

### 查询

- `GET /api/device/recordings/{recordingId}` 返回当前状态；`completed` 带 `threadId`，`failed` 带 `errorCode`。
- 只有录音所属设备能查询；不存在或不属于该设备返回 404。

### 固件

- Wokwi `board-esp32-devkit-c-v4`；按键 GPIO4（INPUT_PULLUP，按下为低），LED GPIO5。
- 启动连 Wi-Fi，串口等待一行 `<baseUrl> <deviceToken>`；缺参数不进入工作态。
- 状态机：待机灭 → 按一下录音、灯常亮 → 再按或满 480 秒结束、灯 1 Hz 慢闪并上传 → 拿到 202 后每 5 秒轮询、最长 5 分钟 → `completed` 灭；`failed`、上传失败或轮询超时进入失败，灯 5 Hz 快闪 10 秒后回待机并保留录音。
- 上传中按键被忽略；失败后的待机再按一次按重试处理，长按 2 秒丢弃本地录音并回到无待发录音的待机。
- 轮询超时的重试先查同一个录音 id；从未拿到 id 的上传失败才重新上传；服务端明确 `failed` 的重试重新上传新录音。
- 设备只上传和查询状态，不下载任何音频；成功后删除本地录音。
- 模拟器没有麦克风，输入是内嵌的约 40 秒双人会议 MP3；按下开始只切换状态并计时，结束时上传这段音频。串口 `s` 等同按一下按钮，`d` 等同长按 2 秒。

### 契约

- 删除 `/api/device/utterances`、`/{utteranceId}`、`/{utteranceId}/reply-audio` 三条路径，删除 `DeviceUtterance` schema 与 `UtteranceId` 参数。
- 新增 `/api/device/recordings`（POST）与 `/api/device/recordings/{recordingId}`（GET），复用 `Recording` schema 与 `deviceAuth`。
- 契约版本升到 `0.7.0`；这是破坏性变更。

### 数据

- `recordings` 增加可空 `device_id`，外键指向 `devices`；App 录音保持为空。
- 删除 `device_utterances` 表、`deviceUtterances` 定义与 `DeviceUtteranceRow`。
- 删除 TTS 模块、`synthesizeSpeech` 装饰器与 `MINIMAX_TTS_*` / `TTS_*` 配置；服务端不再有语音合成。

## Alternatives considered

- **散会整段上传 vs 边录边传**：整段实现简单、离线时录音不丢；代价是设备需要本地存储，长会议要切片。边录边传更适合超长会议与断网续传，留给长会议变更。
- **复用会议管线 vs 独立设备会议**：复用让设备录音和手机录音是同一种会议，纪要、候选待办、额度和时间线都不用重做；独立实体要新建表、页面和一套纪要逻辑。
- **本次做 8 分钟 vs 做切片**：供应商 500 秒上限是硬的，切片要改转写、合并、上传上限和测试；先保持 8 分钟，把硬件形态和链路做通，切片单独变更。
- **保留 TTS vs 删除**：设备没有喇叭，App 也没有语音回复入口，TTS 没有任何消费者；保留会成为死代码和多余的外部调用。
- **独立 `device_recordings` 表 vs `recordings.device_id`**：独立表会再复制一套状态机和清理逻辑；加一列即可复用会议管线和归属校验。
- **重试重新上传 vs 复用 id**：轮询超时可能只是后台还在跑，重新上传会建第二场会议并重复扣额度；按 id 继续查更安全。服务端明确 failed 时重新上传，失败已退款。
- **设备长按取消 vs 不支持取消**：只有一枚按钮，长按是唯一能表达丢弃的手势；不取消会让失败文件永远占着待机语义。

## Areas of concern

- 转写供应商单次 500 秒上限；480 秒留了余量，切片是下一个变更，不在本次。
- Wokwi 免费公共网关吞吐低，约 160 KB 的上传和轮询可能变慢；隧道每次重启换域名，靠串口注入。
- 迁移会 `DROP TABLE device_utterances`；只影响演示数据，升级后旧设备录音不可恢复。
- 轮询超时后设备重试查同一个 id，后台若已完成则会议已出现，不会重复建会。
- 额度幂等依赖 `sendMessageCore` 的退款路径；重传新录音只有在旧录音已 failed 且已退款时才发生。
- 设备 token 没有管理 UI，撤销只能改库；v1 接受。
