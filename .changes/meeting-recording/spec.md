# Spec: 会议录音转纪要

## Behavior

### 入口与录音

- 主对话右上角会议按钮进入 `/meeting/record`（录音页），不写任何数据；页面底部「或者粘贴文字」进入 `/meeting/new`（原文字会议页）。
- 录音页有四个状态：待开始、录音中、上传中、整理中（转写 + 纪要），另有失败态；每个状态都有对应文案，不允许出现无反馈的等待。
- 录音中显示计时与音量；满 480 秒自动停止并进入上传。录音页不显示实时文字。
- 麦克风权限被拒时停在待开始态，说明原因并提供「粘贴文字」入口。
- iOS 锁屏、切换 App 继续录音（`UIBackgroundModes: audio`）；Web 标签页不可见时暂停录音并提示，回到前台可继续。

### 上传与转写

- 结束录音后整段音频一次上传：`POST /api/recordings`（multipart，字段 `audio`），服务端返回 202 与 `{ id, status: "transcribing" }`。
- 客户端每 2 秒 `GET /api/recordings/{id}`；`completed` 时用返回的 `threadId` 进入 `/chat/{threadId}`；`failed` 时展示错误与「重试」。
- 用户在上传完成后离开页面，服务端继续；会议在就绪后出现在时间线，客户端刷新 thread 列表即可看到。
- 上传支持 `wav` / `aiff` / `flac` / `m4a` / `mp3` / `aac` / `opus` / `ogg`；其它格式返回 415。音频超过 12 MB 返回 413，时长超过 500 秒返回 400。

### 服务端处理

- 上传成功后写入 `recordings`（`status = transcribing`），随后异步调用 MiniMax `asr-1.0`（`response_format = verbose_json`）取得 `text`、`n_speakers`、`segments`。
- 转写成功后才创建会议：`threads` 新增一条 `kind = meeting`、标题为默认值；记录上立即写入 `threadId`，再用固定 `clientMessageId = rec:<recordingId>` 写入首条用户消息，内容是按说话人合并后的转写全文。
- 首条消息走现有 Agent 管线：计 1 次额度、产出摘要 / 重点 / 候选待办、自动填充会议标题；语义与一次普通用户消息完全一致。
- 同一 recording 的重试复用已创建的 `threadId` 与 `clientMessageId`，不重复建会、不重复扣额度。
- 成功后记录 `status = completed` 并删除音频文件；失败记录 `status = failed` 与错误码，音频保留 24 小时，`POST /api/recordings/{id}/retry` 可重跑。
- 服务启动时把超过 10 分钟仍为 `transcribing` 的记录标为 `failed`（错误码 `interrupted`），音频保留，可重试。
- 额度不足（`quota_exceeded`）时任务失败但音频保留，客户端提示「额度用完，录音保留 24 小时」。

### 转写文本

- 相邻同说话人的片段合并成一行，格式 `说话人 N：内容`；`n_speakers` 缺失时只输出段落，不编造编号。
- 转写全文作为会议的第一条消息保存，长度受现有 20,000 字上限约束。

### 契约

- 新增 `POST /api/recordings`、`GET /api/recordings/{id}`、`POST /api/recordings/{id}/retry`，以及 `Recording` schema；错误复用 `NOT_FOUND`、`INVALID_INPUT`（400 / 413 / 415），新增 `TRANSCRIPTION_FAILED`。

## Alternatives considered

- **实时上屏 + 短切片转写**：12 秒以内的切片会把多人合成一个说话人（实测 4 秒切片三句三人塌成 1 人），等于用实时性换掉纪要的核心价值。
- **8 分钟切片 + DeepSeek 合并对齐**：录音硬上限收在 8 分钟后不再需要，切片对齐和跨片说话人编号的复杂度不值得保留。
- **端上 ASR（iOS SFSpeechRecognizer / Web Speech）**：都不能分说话人，Web 端跨浏览器不可靠，且拿不到统一的段落时间戳。
- **换讯飞 / 阿里长音频**：能绕开 500 秒限制，但要实名开通、重新验证中文效果；MiniMax 的 key 现成可用，8 分钟上限下够用。
- **边录边传**：换来崩溃恢复，代价是分片合并、断点续传和跨片说话人对齐。
- **按下录音就建会**：会在时间线留下空会议，且与「第一条消息才建会」的既有规则正面冲突。
- **保留音频并提供回听**：多一套播放器、音频鉴权和清理任务；v1 只留文本。

## Areas of concern

- 转写任务跑在 API 进程里：进程重启会丢任务，只能靠启动清扫把记录标成失败并允许重试。
- Web 端 MediaRecorder 默认输出 webm，MiniMax 拒收；实现时要确认浏览器能录出 ogg/opus，否则需要服务端转码或给出可读的失败提示。
- iOS 来电会打断音频会话；v1 不处理，打断后按已录部分结束。
- 说话人编号在短音频上不稳定，负责人字段可能推断错；纪要里宁可留空。
- 整段上传：上传完成前进程被杀会丢失这段录音。
- 8 分钟是产品上限，真实一小时的会议不支持；这是本次刻意接受的范围收缩。
