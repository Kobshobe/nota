# Plan: 待办区分执行时间和截止时间

## Files

- `contract/openapi.yaml`：`Item`、`CreateItemRequest`、`UpdateItemRequest`、`CandidateAction` 增加 `scheduledAt`。
- `server/src/db/schema.ts` + `drizzle/0003_*.sql`：`items.scheduled_at`。
- `server/src/items.ts`：创建/更新接受 `scheduledAt`，允许单独清空。
- `server/src/lib/dto.ts`：`ItemDto.scheduledAt`；候选 `sanitizeAction` 保留 `scheduledAt`。
- `server/src/domain.ts`、`server/src/agent/payload.ts`：`CandidateAction.scheduledAt` 与校验。
- `server/src/agent/tools.ts`、`staging.ts`：工具参数与暂存/提交携带执行时间。
- `server/src/agent/prompt.ts`：提醒时间 / 截止时间 / 执行时间三条规则。
- `app/lib/features/items/models.dart`、`app/lib/features/chat/models.dart`：`scheduledAt` 字段与 `notificationAt`。
- `app/lib/core/api.dart`：创建/更新参数；`complete`/`delete` 补空 body。
- `app/lib/features/items/items_controller.dart`、`app/lib/core/notifications_io.dart`：按 `notificationAt` 排通知。
- `app/lib/features/items/item_card.dart`、`item_edit_dialog.dart`、`items_screen.dart`：展示与编辑两个时间。
- `app/lib/features/chat/chat_controller.dart`：确认候选时带上执行时间。
- 测试：`server/test/items.test.ts`、`server/test/agent.test.ts`、`server/test/prompt.test.ts`、`app/test/item_times_test.dart`。
- `docs/product.md`、`docs/architecture.md`：术语与字段同步；预算 product 5400→5600、architecture 1800→1850（新增两个时间字段与术语）。

## Order

1. 变更链与契约。
2. 服务端表、DTO、路由、Agent 工具与提示词 + 测试。
3. 客户端模型、通知、卡片、编辑弹窗 + 测试。
4. 文档、门禁、独立 review、提交。

## Proof

- 服务端：创建同时带两个时间的待办，两个字段都返回；只清执行时间时截止时间不变；`create_item` 工具的 `scheduledAt` 能落库；`finish` 的候选保留执行时间；提示词测试断言三条时间规则。
- 客户端：`notificationAt` 按类型取值；卡片同时显示「执行」「截止」；提醒只显示提醒时间。
- `make test-fast` 全绿；契约检查与文档门禁通过。
