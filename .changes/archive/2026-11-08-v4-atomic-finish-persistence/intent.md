# Intent: finish 与消息落库原子化

## Problem

`finish` 先提交事项，随后才写 assistant 消息和幂等响应。若第二步失败，用户收到 500、额度被退回，但事项已经留在库里，失败路径不一致。

## Outcome

事项、assistant 消息、工具轨迹、thread 更新和幂等响应在同一个 SQLite 事务里提交；任一步失败都回滚并退额度。

## Constraints

- 不改变契约和工具名。
- 不改变正常路径的响应结构。
- 旧数据不需要迁移。
