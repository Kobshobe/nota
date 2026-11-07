# Nota

AI 语音便签 / 会议助手 MVP：一个入口，接住从一句提醒到一场会议；短的直接办，长的先出纪要再确认事项。v1 做文字输入，客户端是 Flutter Web + iOS。

## 文档

- 产品范围：[`docs/product.md`](docs/product.md)
- 架构：[`docs/architecture.md`](docs/architecture.md)
- 工程约定：[`docs/engineering.md`](docs/engineering.md)
- 接口契约：[`contract/openapi.yaml`](contract/openapi.yaml)

## 架构

- Flutter（Riverpod + Dio）→ Fastify API → SQLite（Drizzle）；唯一耦合点是 OpenAPI 契约。
- Agent 用 `pi-agent-core` + `pi-ai` + `deepseek-flash`，工具写操作先 staging，`finish` 在一个事务里提交。
- 无状态 JWT；Free 每天 10 次、VIP 不限次；`POST /messages` 同步处理，SSE 是 P1。

## 运行

```sh
cp .env.example .env          # 填 JWT_SECRET 和 DEEPSEEK_API_KEY
npm --prefix server install
cd app && flutter pub get && cd ..
source scripts/env.sh
npm --prefix server start      # http://127.0.0.1:8080

# 另一个终端
cd app
flutter run -d chrome --dart-define=API_BASE_URL=http://127.0.0.1:8080
# iOS 模拟器同理，换 -d "iPhone 17 Pro"
```

数据库默认在 `data/nota.db`，已在 `.gitignore` 中。任何邮箱都能注册；邮箱含 `vip`（不区分大小写）即 VIP。

## 验收

```sh
make check-all                 # 文档 + 契约 + 两端测试 + 运行时契约
make e2e                       # HTTP 冒烟（不调模型）
E2E_MESSAGE=1 make e2e         # 再走一次真实 DeepSeek 消息
```

演示顺序：在“日常”说“提醒我两个小时后去游泳” → 新建会议并粘贴会议记录 → 点选候选待办 → 在“事项”里修改 / 完成 / 删除。

v1 不做：语音 / ASR、Android、真实日历同步、订阅支付、多人协作、多端通知同步。
