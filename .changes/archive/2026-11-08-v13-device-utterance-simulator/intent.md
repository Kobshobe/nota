# Intent: 设备语音快记模拟器

## Problem

Nota 的产品形态是「随身按住说话」，但仓库里只有 Flutter 客户端和 API：没有设备端，设备身份、上传、异步处理和语音回复都没有定义，也没有办法在没有真机的情况下验证这条路径。

## Outcome

- 在 Wokwi 网页免费版里跑一块 ESP32 固件，模拟按住说话、LED 工作指示、Wi-Fi 上传和语音回复（模拟器里以串口日志代替播放）。
- API 新增设备 token 鉴权、设备语音上传与状态查询、TTS 回复音频下载；设备语音落在用户「日常」thread，复用 Agent 与额度。
- 预置设备绑定，跳过 BLE 配网与手机绑定；这两段只写入文档，留给真机阶段。
- App 不改：设备转写作为日常 thread 的用户消息，TTS 文本与 App 里的 assistant 回复一致。

## Constraints

- 只能用 Wokwi 网页免费版：项目公开、无私有网关、无 BLE、无麦克风/扬声器仿真。
- 音频输入用固件内嵌 MP3；设备地址与 token 通过串口注入，不写进公开项目。
- 接口与数据必须走 `contract/openapi.yaml`；设备 token 只存哈希。
- 一条设备语音扣 1 次额度；失败不扣；服务重启打断的任务标失败。
- 不做：BLE、SoftAP、手机绑定 UI、真机 I2S、App 改动、多设备通知同步。

## Open questions

无。
