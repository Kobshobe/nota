# Plan: 可读的工具调用日志

## Files

- `server/src/agent/tool-log.ts`（新）：`formatToolStart` / `formatToolEnd`，按工具名渲染中文参数行与结果摘要，负责截断和本地时间展示。
- `server/src/agent/run.ts`：`runAgent` 接受可选 logger；运行开始/结束打点；`tool_execution_start` / `tool_execution_end` 时输出工具行与耗时。
- `server/src/messages.ts`：把 `request.log` 传给 `runAgent`。
- `server/src/config.ts`：新增 `logLevel`、`logFormat`，非法 `LOG_FORMAT` 启动即抛错。
- `server/src/server.ts`：按 `logFormat` 选择 pino-pretty 传输或 JSON；`server/package.json` 增加 `pino-pretty`，fastify 下限提到 5.12.8。
- `server/src/app.ts`：用 `LogController` 关掉默认请求日志，`onResponse` 打一行 `方法 路径 → 状态码 耗时`。
- `server/test/tool-log.test.ts`、`server/test/agent-log.test.ts`（新）、`server/test/config.test.ts`、`server/test/helpers.ts`：格式化纯函数、真实运行日志、配置校验、日志捕获。
- `app/lib/features/chat/tool_trace_fields.dart`（新）：中文字段名与值翻译，隐藏 id/时间戳，长文本截断。
- `app/lib/features/chat/message_bubble.dart`：工具轨迹弹窗改成中文键值行，去掉 `JsonEncoder`。
- `app/test/tool_trace_dialog_test.dart`（新）：弹窗不出现 JSON 文本，中文标签与值可见。
- `docs/engineering.md`、`docs/product.md`、`.env.example`：日志格式、级别与开关。

## Order

1. 变更链。
2. 服务端格式化函数 + 运行日志接入 + 配置与终端输出格式。
3. 服务端测试，`cd server && npx tsc --noEmit && npm test`。
4. 客户端弹窗可读化 + widget 测试。
5. 文档与 `.env.example`，`make check-all`，真实运行确认终端输出。

## Proof

- `server/test/tool-log.test.ts`：create/search/finish/失败四类渲染，长文本截断，不出现 `{"`。
- `server/test/config.test.ts`：`LOG_FORMAT=json|pretty` 通过，非法值抛错。
- 启动服务并发送一条真实消息，终端出现 `▶ create_item …`、`✔ finish …`、`agent 运行结束` 和一行请求日志，且没有 JSON 对象行。
- `LOG_FORMAT=json` 启动后同样是每行一条 JSON，`reqId` 与 `tool` 字段保留。
- `app/test/tool_trace_dialog_test.dart`：打开弹窗后能看到「标题」「买牛奶」，找不到 `{`。
- `make check-all` 全绿。
