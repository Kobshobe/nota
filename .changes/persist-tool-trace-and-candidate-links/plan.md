# Plan: 持久化工具轨迹与候选事项关联

## Files

- `contract/openapi.yaml`、`contract/baseline/openapi.yaml`：`Message.toolCalls`、`Item.sourceMessageId/candidateIndex`、`CreateItemRequest` 同名字段、`UpdateItemRequest.dueAt` 可空，版本 0.4.0。
- `server/src/db/schema.ts`、`server/drizzle/0001_*.sql`：items 增加 source_message_id/candidate_index 与候选唯一索引。
- `server/src/lib/dto.ts`、`server/src/threads.ts`、`server/src/items.ts`：DTO、工具轨迹回填、来源字段校验/落库、dueAt 清空。
- `server/test/threads.test.ts`、`server/test/items.test.ts`、`server/test/agent.test.ts`：刷新后有 toolCalls；候选来源与重复创建；dueAt null。
- `app/lib/features/chat/models.dart`、`chat_controller.dart`、`core/api.dart`、`features/items/models.dart`、`items_controller.dart`、`item_edit_dialog.dart`：解析 toolCalls、加载候选状态、传来源字段、清空时间。
- `app/test/`：候选重开后已加入、dueAt 清除。
- `docs/architecture.md`、`docs/engineering.md`：数据与行为同步。

## Order

1. 契约 + 变更链。
2. 服务端 schema/迁移 → DTO/threads/items → 测试。
3. 客户端模型/API/controller/UI → 测试。
4. baseline、`make check-all`、真实 e2e、iOS 构建、push。

## Proof

- `cd server && npm test`：工具轨迹回填、候选来源、重复候选 400、dueAt null。
- `cd app && flutter test`：候选状态从事项恢复、清除时间。
- `make check-all` 全绿；真实 DeepSeek e2e 仍通过。
- 手工刷新 thread，工具轨迹仍在；重新打开会议，候选显示已加入。
