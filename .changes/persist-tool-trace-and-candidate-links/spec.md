# Spec: 持久化工具轨迹与候选事项关联

## Behavior

- `Message` 增加可选 `toolCalls`；`GET /threads/{id}` 从 `tool_calls` 表按 message_id 回填，按创建顺序返回。
- `Item` 增加可选 `sourceMessageId`、`candidateIndex`；`POST /items` 接受这两个字段并落库；旧事项保持为空。
- `PATCH /items/{id}` 的 `dueAt` 允许显式 `null`；传 `null` 时清空时间，省略则保持不变。
- 客户端加载 thread 时同时加载该 thread 的事项，用 `sourceMessageId:candidateIndex` 推导已加入的候选；按钮创建时带上两个字段。
- 客户端编辑事项时提供“清除时间”，对应 `dueAt: null`。
- 契约版本升到 0.4.0；不改变额度、鉴权和 Agent 工具语义。

## Alternatives considered

- **只把候选状态存在客户端本地**：跨设备/清缓存即丢，不能解决重复创建；不采用。
- **新建 candidate_actions 表**：要维护候选生命周期和状态，超出 demo 需要；用事项上的来源字段更直接。
- **工具轨迹只保留在发送响应里**：刷新即丢，用户无法回看 Agent 行为；补 `Message.toolCalls` 成本更低。
- **用 `dueAt: ""` 表示清空**：类型含糊；用 JSON null 表达空值。

## Areas of concern

- 来源字段是自由字符串，服务端只校验来源消息属于当前用户和 thread；旧数据不迁移。
- 同一候选的并发重复点击仍可能创建两条；唯一索引会阻止同候选重复，但需要处理冲突错误。
- 任务轨迹可能增大 thread 响应；v1 只保留最近的 thread 消息，量级可接受。
