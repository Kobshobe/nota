# Spec: 待办区分执行时间和截止时间

## Behavior

- `Item` 增加可选字段 `scheduledAt`；`dueAt` 在提醒里仍是通知时间，在待办里是截止时间。
- 创建待办可以只给 `scheduledAt`、只给 `dueAt`、两个都给，或都不给；创建提醒仍必须有 `dueAt`。
- 更新事项可以单独设置或清空 `scheduledAt`（传 `null`），不影响 `dueAt`；反之亦然。
- 只有日期没有钟点的截止时间由 Agent 换算成当天 `23:59:00+08:00`，并在 `evidence` 或 `reply` 里说明「按当天结束算」。
- 执行时间只在原文/用户明确说了「什么时候做」时出现，必须带钟点；没有就说没有。
- 会议候选 `actions` 支持 `scheduledAt`，规则同上；`dueAt` 照常抽。
- 通知：提醒按 `dueAt` 排；待办按 `scheduledAt` 排；只设了截止时间的待办不发通知。
- 事项卡片：提醒显示「提醒 11月14日 12:00」；待办分别显示「执行 …」和「截止 …」，截止过期标红。
- 编辑弹窗：待办有两个时间字段（执行时间、截止时间），各自可设置和清除；提醒只有一个提醒时间。
- 契约：`Item`、`CreateItemRequest`、`UpdateItemRequest`、`CandidateAction` 增加 `scheduledAt`，`UpdateItemRequest` 允许 `null`。

## Alternatives considered

- **只改提示词、不拆字段**：能让「周五之前」进 `dueAt`，但「打算什么时候做」仍然无处安放，且提醒/待办继续共用一个字段。
- **用 `dueAt` 同时表示两者**：用户分不清「几点做」和「几点前必须完成」，通知也会发错时间。
- **给执行时间也允许只有日期**：执行时间的作用是到点提醒，没有钟点就没有通知时刻，等于没设。
- **待办按截止时间提前若干小时通知**：需要额外的提前量规则和用户预期，v1 不做。

## Areas of concern

- 两个时间都空、只有截止时间、只有执行时间，三种组合都要在卡片和通知里说得清，不能出现空白行。
- 旧数据 `scheduled_at` 为空，卡片只显示截止时间，行为与以前一致。
- Agent 可能把「周五之前」同时塞进 `scheduledAt` 和 `dueAt`；提示词明确禁止，测试覆盖候选两条时间的解析。
- 空 body 的 `POST /complete`、`DELETE` 在 Dio 默认 `application/json` 下会被 Fastify 判 400，这次一并修掉。
