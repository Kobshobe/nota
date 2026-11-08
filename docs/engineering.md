# 工程约定

Demo 版工程规范：结构清楚、代码少、测试场景一眼看懂。产品范围见 [product.md](product.md)，架构见 [architecture.md](architecture.md)，接口见 [openapi.yaml](../contract/openapi.yaml)。

## 1. Demo 原则

- 这是 demo，不是生产系统；优先可读、少代码、清晰结构。
- 封装按 feature 切，不按技术层切；不为假设的未来加抽象。
- 省略：限流、CI、监控、refresh token、游标分页、密钥轮换、UUID 版本讨论、DI 容器、codegen。
- 保留：统一错误体、Dio 拦截器、共享组件、场景测试、密码哈希、JWT、数据隔离。

## 2. API 约定

- 请求/响应体都是 JSON，字段 camelCase；时间用 ISO 8601 UTC。
- 除 `/api/auth/login` 和 `/api/health`，所有接口要求 `Authorization: Bearer <JWT>`。
- 响应带 `X-Request-Id`；错误体带 `requestId`。
- 单次文字输入上限 20,000 字符；超限返回 400 `INVALID_INPUT`。
- 写消息带 `clientMessageId`；同键重试返回原结果，不重复创建或扣额度。
- 按钮确认候选事项带 `sourceMessageId` 与 `candidateIndex`，两者必须成对；`GET /threads/{id}` 的 `Message.toolCalls` 回放工具轨迹。
- 创建 `reminder` 必须带 `dueAt`；`PATCH /items/{id}` 的 `dueAt: null` 只能清空待办时间，提醒不能清空，省略表示不变。
- 列表用 `limit` 控制数量，不做游标分页。

## 3. 错误规范

统一错误体：

```json
{
  "code": "QUOTA_EXCEEDED",
  "message": "Daily quota exhausted",
  "details": null,
  "requestId": "req_..."
}
```

| HTTP | code | 场景 |
|---|---|---|
| 400 | `INVALID_INPUT` | 参数/校验失败；`details` 放字段错误 |
| 401 | `INVALID_CREDENTIALS` | 登录邮箱/密码错误 |
| 401 | `UNAUTHORIZED` | 未登录、token 缺失/过期 |
| 404 | `NOT_FOUND` | 资源不存在或不属于当前用户 |
| 429 | `QUOTA_EXCEEDED` | 当日额度用尽；带 `Retry-After` |
| 500 | `INTERNAL` | 未预期错误；不返回堆栈 |

- `code` 是封闭枚举；服务端 `message` 只做英文诊断，不作为 UI 文案。
- 客户端按 `code` 映射中文；`details` 只放结构化字段错误。
- 不返回堆栈、SQL、内部路径或第三方原始错误。

## 4. 客户端

### 4.1 结构

```text
lib/
  main.dart
  app.dart
  core/
    api.dart          Dio + 拦截器 + ApiException
    auth_store.dart   token
    router.dart
    theme.dart
  features/
    auth/login_screen.dart
    chat/chat_screen.dart
    chat/chat_controller.dart
    chat/models.dart
    items/items_screen.dart
    items/item_card.dart
  shared/widgets/
    async_view.dart
    error_view.dart
    app_button.dart
```

- Riverpod 管状态；`AsyncValue` 表达加载/错误/数据。
- 模型手写 `fromJson` / `toJson`，不上 freezed / codegen。
- `go_router` 做登录重定向；token 存 secure storage；通知用 `flutter_local_notifications`。
- 未签名的模拟器包写 Keychain 会报 -34018：此时退化成内存会话，登录照常，重启后重新登录。
- 不搞 `data/domain/presentation` 三层；一个 feature 一组 screen / controller / models。

### 4.2 Dio 拦截器

- `AuthInterceptor`：加 `Authorization: Bearer`。
- `ErrorInterceptor`：解析统一错误体 → `ApiException`（code / status / requestId / retryable）。
- `LoggingInterceptor`：仅 debug，token 打码。

全局处理：

- 401 → 清 token、回登录。
- 429 → 更新额度状态、提示重置时间。
- 5xx / 网络 / 超时 → 提示可重试。
- 400 / 404 → 不弹全局错误，交给所在 feature。

原则：拦截器做分类和全局副作用，不吞掉所有错误；页面级字段错误由 controller 处理。UI 不直接接触 `DioException`。`POST /messages` 不自动重试；重试复用同一个 `clientMessageId`。

### 4.3 通用组件

只抽真正复用的：

- `AsyncValueView`：loading / error / empty / data。
- `ErrorView`、`EmptyView`。
- `AppButton`、`AppTextField`、`ConfirmDialog`、`AppSnackBar`。
- `SectionCard`、`ItemCard`、`MessageBubble`、`ToolCallTile`、`QuotaBadge`。

组件只做展示；业务逻辑在 controller；不为了封装多一层。

## 5. 后端

### 5.1 结构

```text
server/src/
  app.ts        Fastify 实例、插件、错误处理
  server.ts     启动
  config.ts     env
  db.ts         Drizzle 连接
  db/schema.ts  表定义
  lib/errors.ts AppError + 错误映射
  lib/jwt.ts    JWT 签发/校验
  auth.ts       登录/注册/JWT
  threads.ts    thread 列表/新建
  messages.ts   发消息、额度、调用 agent
  items.ts      事项增删改完成
  usage.ts      额度
  agent/
    run.ts      pi-agent-core 组装、事件
    tools.ts    5 个工具 + finish
    tool-log.ts 工具调用的一行中文日志
    prompt.ts   system prompt
    staging.ts  写操作暂存/提交
server/test/
  auth.test.ts
  quota.test.ts
  threads.test.ts
  items.test.ts
  agent.test.ts
  validation.test.ts
  config.test.ts
  prompt.test.ts
  agent-log.test.ts
  tool-log.test.ts
  contract-message.test.ts
```

- 一个 feature 一个文件，路由、业务、查询就近；不建 `repositories/`、`services/` 分层。
- 不做 DI 容器、接口抽象；文件尽量 <200 行。
- 错误统一用 `lib/errors.ts` 的 `AppError`；JWT 在 `lib/jwt.ts`。

### 5.2 Drizzle

- `drizzle-orm` + `better-sqlite3`；`drizzle-kit` 生成迁移。
- `server/drizzle.config.ts` 指向 `src/db/schema.ts`；迁移放 `server/drizzle/`。
- `db/schema.ts` 定义表；`db.ts` 只导出连接；feature 里直接 `db.select/insert/update/delete`。
- 关联查询直接写 Drizzle 表达式，不额外包 repository；复杂 SQL 可以在 feature 内用 `sql` 模板。
- 时间存 ISO UTC；ID 用 `crypto.randomUUID()`；额度日界 Asia/Shanghai。
- 多写操作放 `db.transaction`；staging/finish 也走事务。

### 5.3 错误处理

- 领域层抛 `AppError`（code / status / message / details）。
- 全局 error handler 统一转成第 3 节错误体；Zod 失败 → `INVALID_INPUT`；JWT 失败 → `UNAUTHORIZED`；未知 → `INTERNAL`。
- pino 记录 requestId、code、status（`LOG_FORMAT=json` 可见）；不记录密码、token、完整会议内容。

### 5.4 日志

- 每次 Agent 运行打运行开始/结束和每个工具一行中文摘要：`▶ create_item 标题=「买牛奶」 类型=待办`、`✔ create_item 已暂存 new_1（待办） 3ms`；参数和结果不序列化成 JSON，换行压成一行。
- 终端默认 pretty（隐藏 `tool`/`durationMs`/`isError`/`reqId`）；`LOG_FORMAT=json` 输出 pino 原始 JSON 且保留这些字段，`LOG_LEVEL` 控级别，非法值启动即失败。

### 5.5 Agent

- 用 `pi-agent-core` + `pi-ai` + `pi-schema`，不用 `pi-coding-agent`。
- 每次请求新建 `Agent`，从 SQLite 恢复 messages；`sessionId` 用 thread id。
- 工具：`create_item`、`update_item`、`delete_item`、`complete_item`、`search_items`、`finish`；写操作 `executionMode: "sequential"`。
- `finish` 校验并暂存 summary / keyPoints / actions / reply；assistant、payload、tool_calls、事项与幂等响应在同一事务里提交；没 finish、事务失败或报错则回滚并退额度。
- 订阅 `tool_execution_end` 收集工具轨迹；运行结束后把 assistant 消息、payload、tool_calls 与幂等响一并落库；v1 同步，P1 再 SSE。
- DeepSeek 用 `deepseekProvider()` + `deepseek-flash`；`thinkingLevel` 先 `low`。

## 6. 测试

### 6.1 原则

不强制红-绿-重构的仪式；测试可以在实现前、中、后写。要求是测试名和结构能直接看出应用场景和意图。

- 一个测试一个行为；断言可观察结果，不测私有实现。
- 用公共 seam：HTTP 路由、service、agent；不 mock 内部细节。
- 只测主场景 + 关键错误；不追求覆盖率、不穷举边界。

### 6.2 命名

- 后端：`describe('场景：额度 · Free 第 11 次被拒')` + `it('第 11 次提交被拒绝，且不重复扣额度')`。
- 客户端：`testWidgets('场景：会议纪要 · 点选候选待办后出现提醒', ...)`。
- 中文写场景，英文写代码标识；测试体按 given / when / then 组织。

### 6.3 后端

- Vitest；临时 SQLite；每个测试独立库或事务。
- LLM 用 `pi-ai` 的 `fauxProvider` 或 fake `streamFn`。
- 覆盖：登录/注册、JWT 过期、额度并发/幂等、thread 归属、工具参数、finish/staging 回滚、错误码。
- 契约测试：`scripts/check-contract.mjs` 起真实服务核对状态码和字段。

### 6.4 客户端

- `flutter_test` + provider override；API 用 fake，不连真实后端。
- 覆盖：登录错误、加载/空/错误态、消息发送、候选确认、额度用尽、通知排期/取消。
- Widget 测试关注用户可见行为；controller 单测关注状态流转。

## 7. 完成标准

- `make check` 全绿；实现阶段再要求 `make check-all`。
- 新增接口/错误码同步更新契约与 baseline。
- 受影响的产品/架构/工程文档在同一变更内更新。
- 测试名和 given/when/then 能让人一眼看懂场景。
- 没有明文密钥、堆栈、SQL 或第三方原始错误泄漏到客户端。
