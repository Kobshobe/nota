# Nota 设备模拟器

用 Wokwi 网页免费版模拟 Nota 的随身设备：按住 GPIO4 说话，松开后把一段内嵌 MP3 经 Wi-Fi 上传，服务端转写、跑 Agent、合成语音回复，设备轮询到结果后打印回复并熄灭 LED。

模拟器没有麦克风和扬声器，也没有 BLE：输入音频是固定 fixture，输出只把 TTS 文本和音频字节数打到串口；设备身份由 seed 预置，跳过配网与手机绑定。

## 前置

- 仓库根 `.env` 有 `JWT_SECRET`、`DEEPSEEK_API_KEY`、`MINIMAX_API_KEY`。
- 安装隧道：`brew install cloudflared`。
- 浏览器能打开 [Wokwi](https://wokwi.com)（免费账号即可）。

## 步骤

### 1. 造一台演示设备

```sh
npm --prefix server run seed:device
```

输出里的 `email` / `password` 用来登录 App，`deviceToken` 下一步要用；每次执行都会新建一台设备并打印新 token，并把 demo 账号的密码重置成传入值。

### 2. 起服务并登录 App

```sh
npm --prefix server start
```

另开终端按仓库根 README 起 Flutter Web，用 seed 输出的账号登录；设备消息会出现在「日常」对话里。

如果 8080 上已经有旧版本的服务在跑，先停掉再启动；设备路由需要重启后的新服务。

### 3. 暴露本机服务

```sh
cloudflared tunnel --url http://127.0.0.1:8080
```

记下输出里的 `https://<随机>.trycloudflare.com`。隧道每次启动域名都会变。

### 4. 在 Wokwi 里搭电路

1. 新建一个 ESP32 项目，板型选 **ESP32 DevKit C V4**。
2. 把 [`diagram.json`](firmware/diagram.json) 的内容粘进 `diagram.json` 标签页。
3. 把 [`nota_device.ino`](firmware/nota_device.ino) 的内容粘进 `sketch.ino`。
4. 新建一个 `fixture.h` 标签页，粘入 [`fixture.h`](firmware/fixture.h) 的内容。
   如果 Wokwi 的免费项目不能新增文件，把 `fixture.h` 的内容直接粘到 `sketch.ino` 顶部。
5. 点绿色运行按钮。

### 5. 注入地址和 token

串口监视器出现 `paste: <baseUrl> <deviceToken>` 后，粘贴一行：

```text
https://<随机>.trycloudflare.com dev_xxxxxxxx
```

回车。看到 `ready: hold GPIO4 to talk` 后，按住电路里的绿色按钮，松开。

## 预期输出

```text
wifi: connected, ip=...
ready: hold GPIO4 to talk
recording: release the button to send
sending...
upload: HTTP 202
upload: id=...
poll: processing
reply: 已设置提醒：明天（11 月 9 日）下午 3 点和张总开会。
would play 59508 bytes
```

同时 App 的「日常」里出现用户消息「提醒我明天下午三点和张总开会。」和同一条 AI 回复，事项页出现 15:00 的提醒。

## 重新生成 fixture

改台词或换声音后：

```sh
mmx speech synthesize --text "提醒我明天下午三点和张总开会" --voice male-qn-jingying \
  --format mp3 --sample-rate 16000 --bitrate 32000 --out device/fixtures/utterance-01.mp3
node device/tools/embed-fixture.mjs
```

`fixture.h` 是生成物，不要手改。新音频的时长要同步改 [`nota_device.ino`](firmware/nota_device.ino) 里的 `FIXTURE_DURATION_MS`；`mmx` 需要先登录或配置 MiniMax key。

## 限制与注意

- **没有麦克风/喇叭**：输入是固定 fixture，按住时长不影响音频；输出只打印，不真正播放。
- **没有 BLE/SoftAP**：配网和手机绑定不在模拟范围，设备由 seed 预置绑定。
- **HTTPS 不校验证书**：固件用 `setInsecure()`，只用于本地隧道；真机要换成 CA pinning 或安全存储。
- **Wokwi 免费项目是公开的**：token 只从串口注入，不要写进 sketch。
- **免费版走公共网关**：Wokwi 官方说明公共网关会监控流量；token 和音频内容也会经过它，不要放真实敏感数据。
- **隧道域名会变**：每次重启 cloudflared 都要重新粘贴地址。
- **设备语音上限**：60 秒 / 5 MB；fixture 约 2.6 秒。

## 排查

| 现象 | 看哪里 |
|---|---|
| `upload: HTTP 401` | token 错或已撤销；重跑 seed 拿新 token |
| `failed: QUOTA_EXCEEDED` | demo 账号当天 10 次用完；等重置或换账号 |
| `reply audio: unavailable` | TTS 失败；看服务端日志，App 里结果仍在 |
| `poll: timed out` | 隧道或服务断了；看 cloudflared 与 server 日志 |
| 串口没有输出 | 检查 `esptool`/串口监视器是否连到板子，或重置模拟器 |
