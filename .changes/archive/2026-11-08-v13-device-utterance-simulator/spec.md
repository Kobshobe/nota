# Spec: 设备语音快记模拟器

## Behavior

### 设备身份

- `devices` 表存 `id`、`user_id`、`name`、`token_hash`、`created_at`、`revoked_at`；token 明文只在 seed 输出里出现一次，数据库只存 SHA-256。
- 设备请求带 `Authorization: Bearer <device-token>`；token 缺失、无效、被撤销或设备不存在时返回 401 `UNAUTHORIZED`。
- seed 脚本 `npm --prefix server run seed:device` 创建或复用 demo 用户、确保日常 thread、创建一台设备，并打印 email、password、deviceId、token；默认 `demo@nota.app` / `nota-demo-123`。
- 设备只能读写自己创建的 utterance；跨设备访问返回 404。

### 上传

- `POST /api/device/utterances`，multipart，字段 `audio`（必填）和 `durationMs`（可选）。
- 接受 mp3 / wav / m4a 等现有白名单格式；不支持返回 415，超过 5 MB 返回 413，`durationMs` 超过 60 秒或格式非法返回 400。
- 返回 202 `{ id, status: "processing", createdAt }`；音频写盘后异步处理，不阻塞请求。

### 处理

- 异步任务顺序：`prepareAudio`（必要时转码）→ ASR → 取用户日常 thread → `sendMessageCore`（扣 1 次额度、写用户消息与 assistant 回复）→ 取 assistant content 作为 `replyText` → TTS 合成 mp3。
- `durationMs` 只是客户端提示；服务端按转写返回的时长复核 60 秒上限，超限按 `TRANSCRIPTION_FAILED` 失败。
- `replyText` 超过 200 字时按最后一个句末标点截断；TTS 用 `speech-2.8-hd`、`female-yujie`、24 kHz / 64 kbps mp3。
- 成功后 `status = completed`，写 `replyText` 与 `replyAudioUrl`；上传的原始音频删除。
- 失败时 `status = failed`，写 `errorCode`：ASR 失败 `TRANSCRIPTION_FAILED`，额度不足 `QUOTA_EXCEEDED`，Agent 失败 `AGENT_FAILED`，进程重启打断 `INTERRUPTED`；失败不扣额度，上传音频删除。
- TTS 失败不判整条失败：`status = completed`，保留 `replyText`，不返回 `replyAudioUrl`，设备打印文本、不播放。
- 服务启动时对账：已有 assistant 回复的记录回填 `completed`（有 TTS 文件就带上），否则标 `failed / INTERRUPTED` 并退回已扣额度；同时清理超过 1 小时的 TTS 音频文件。

### 查询与下载

- `GET /api/device/utterances/{utteranceId}` 返回当前状态；`completed` 带 `replyText`，有音频时带 `replyAudioUrl`（相对路径）。
- `GET /api/device/utterances/{utteranceId}/reply-audio` 返回 `audio/mpeg`；未完成、TTS 失败、已过期或不属于该设备时返回 404。
- 设备每秒轮询一次，最长 120 秒；`completed` 后下载音频，串口打印 `replyText` 与音频字节数，LED 熄灭。

### 固件

- Wokwi `board-esp32-devkit-c-v4`，Arduino；按键 GPIO4（INPUT_PULLUP，按下为低），LED GPIO5。
- 启动连 `Wokwi-GUEST`（信道 6），串口等待一行 `<baseUrl> <deviceToken>`；缺参数不进入工作态。
- 按住按键时 LED 常亮并打印录音状态；松开后把内嵌 MP3（约 11.7 KB）按 multipart 上传，轮询到结果后熄灭；失败闪 3 下。
- 设备不模拟麦克风与扬声器：输入音频是固定 fixture，输出音频只打印「would play」；HTTPS 使用 `setInsecure()`，仅限模拟器。

### 契约

- 新增 `deviceAuth` security scheme、`DeviceUtterance` schema、`UtteranceId` 参数、三条 device 路径；`ErrorResponse.code` 枚举不变。
- 设备状态里的 `errorCode` 是独立枚举 `[TRANSCRIPTION_FAILED, QUOTA_EXCEEDED, AGENT_FAILED, INTERRUPTED]`。

## Alternatives considered

- **主机级协议模拟器**：不写固件也能验证云端，但用户明确要固件级，且按键、LED、Wi-Fi 状态机是这次要验证的东西。
- **Espressif QEMU**：免费本地，但没有 Wi-Fi、I2S、GPIO matrix，设备和云端的主路径都跑不了。
- **Wokwi VS Code（Hobby+）**：迭代和本地网关更好，但要付费；免费网页版加隧道足以跑通。
- **BLE 配网 / 手机绑定**：真实首次使用必须做，但 Wokwi 不支持 BLE；这一轮预置绑定，把这两段留给真机。
- **同步返回结果**：设备 HTTP 要挂 10–30 秒，超时与重试难做；沿用 202 加轮询。
- **内嵌 WAV / 从服务端拉 fixture**：WAV 源码太大，从服务端拉又多一个模拟器专用接口；内嵌 MP3 在体积和真实性之间折中最好。
- **TTS 失败判整条失败**：结果已经在 App 里，判失败会误导；改为 completed 加无音频。
- **复用 `/api/recordings`**：那条路径创建会议，设备快记应该进日常 thread，语义不同。

## Areas of concern

- Wokwi 免费项目公开：固件源码公开可接受，token 必须靠串口注入，不能写进 sketch。
- 隧道域名每次启动变化；串口注入解决，但演示脚本要手动粘贴。
- `setInsecure()` 放弃证书校验，只用于本地模拟；真机必须换成 CA pinning 或安全存储。
- 固件不在 CI 里编译，只能靠 Wokwi 手动验收；服务端契约与测试必须覆盖设备主路径。
- TTS 多一次外部调用，增加延迟和费用；文本截断到 200 字控制成本。
- 处理任务在 API 进程内，重启会丢；靠启动清扫标 failed，设备重按即可。
- 设备 token 没有管理 UI，撤销只能改库；v1 接受。
