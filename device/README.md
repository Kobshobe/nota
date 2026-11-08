# Nota 会议录音设备（模拟器）

用 Wokwi 网页免费版模拟 Nota 的会议录音笔：按一下 GPIO4 开始录音，会议结束再按一下，整段会议音频经 Wi-Fi 上传；服务端转写、创建会议并生成纪要，纪要出现在 App 的主对话时间线。设备只录音，不播放任何声音。

设计与状态机见 [design.md](design.md)。模拟器没有麦克风、扬声器和 BLE：输入是内嵌的一段固定会议音频，按钮、LED、上传与轮询真实运行；设备身份由 seed 预置，跳过配网与手机绑定。

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

另开终端按仓库根 README 起 Flutter Web，用 seed 输出的账号登录；设备录的会议会作为卡片出现在主对话时间线。

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

回车。看到 `ready: press GPIO4 to record` 后，按电路里的绿色按钮开始录音，再按一次结束并上传。

模拟器里也可以在串口输入 `s` 触发一次按下；Wokwi 的部件交互不稳定时用它。`d` 等同长按 2 秒放弃未发送的录音，`t` 打印 DNS 解析和 `/api/health` 的结果；真机没有这三个入口。

## 预期输出

```text
wifi: connected, ip=...
ready: press GPIO4 to record
recording: started
recording: stopped
upload: sending
upload: HTTP 202
upload: id=...
poll: transcribing
completed: thread=...
state: idle
```

同时 App 的主对话时间线里出现会议卡片，点开能看到摘要、重点和候选待办。

## 重新生成 fixture

改台词或换声音后：

```sh
mmx speech synthesize --text "报价再降两千。" \
  --voice male-qn-jingying --format mp3 --sample-rate 16000 --bitrate 32000 --out .tmp/meeting/1.mp3
mmx speech synthesize --text "周四下午联调。" \
  --voice female-yujie --format mp3 --sample-rate 16000 --bitrate 32000 --out .tmp/meeting/2.mp3
ffmpeg -y -i .tmp/meeting/1.mp3 -i .tmp/meeting/2.mp3 \
  -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[out]" -map "[out]" \
  -ar 16000 -ac 1 -b:a 32k device/fixtures/meeting-01.mp3
node device/tools/embed-fixture.mjs
```

`fixture.h` 是生成物，不要手改。新音频的时长要同步改 [`nota_device.ino`](firmware/nota_device.ino) 里的 `FIXTURE_DURATION_MS`；`mmx` 需要先登录或配置 MiniMax key。

## 限制与注意

- **没有麦克风/喇叭**：输入是固定会议音频，按钮只控制状态和计时；输出只打印，不真正播放。
- **没有 BLE/SoftAP**：配网和手机绑定不在模拟范围，设备由 seed 预置绑定。
- **HTTPS 不校验证书**：固件用 `setInsecure()`，只用于本地隧道；真机要换成 CA pinning 或安全存储。
- **Wokwi 免费项目是公开的**：token 只从串口注入，不要写进 sketch。
- **免费版走公共网关**：Wokwi 官方说明公共网关会监控流量；token 和音频内容也会经过它，不要放真实敏感数据。
- **隧道域名会变**：每次重启 cloudflared 都要重新粘贴地址；Wokwi 连不上 Cloudflare 时可以用 `npx localtunnel --port 8080` 换一个域名；`http://` 地址只用于模拟器，token 会明文传输。
- **单场会议上限**：480 秒 / 12 MB；模拟器 fixture 约 3 秒，不会触发上限。

## 排查

| 现象 | 看哪里 |
|---|---|
| `upload: HTTP 401` | token 错或已撤销；重跑 seed 拿新 token |
| `failed: QUOTA_EXCEEDED` | demo 账号当天 10 次用完；等重置或换账号 |
| `poll: timed out` | 隧道或服务断了；看 cloudflared 与 server 日志 |
| `failed: TRANSCRIPTION_FAILED` | 服务端转写失败；看 server 日志，按一下重试 |
| `upload: request failed` | 隧道域名过期或网络断；重新注入地址 |
| 串口没有输出 | 检查 `esptool`/串口监视器是否连到板子，或重置模拟器 |
