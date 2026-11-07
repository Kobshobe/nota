# Spec: finish 与消息落库原子化

## Behavior

- `finish` 只校验并暂存 payload，不直接写事项；`finishTurn` 在暂存后结束本轮。
- `runAgent` 返回暂存结果；`persistRun` 在单个事务里提交 staging 事项、assistant、tool_calls、thread 更新和 responseJson。
- 事务失败时用户消息删除、额度退回，事项和 assistant 都不留下。
- 工具轨迹的 `finish` result 标记为 `finished: true`。

## Alternatives considered

- **先写 assistant 再提交事项**：同样存在两个事务之间失败的不一致；不采用。
- **失败后补偿删除事项**：需要记录操作前状态，复杂且仍可能失败；不采用。
- **保持两段提交**：demo 可接受，但违背“失败不扣额度/不产生副作用”的承诺。

## Areas of concern

- `Staging.commitInTransaction` 必须只接受调用方事务，避免嵌套事务。
- 事务失败后 `staging` 不能标记 committed，否则重试会误判。
