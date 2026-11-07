# Intent: Bootstrap Nota MVP

## Problem

Nota 需要一个可真实体验的 MVP：用户按住说话或输入文字，AI 整理摘要与待办，并由 Agent 调工具创建待办、设置提醒、查询历史；Free 用户每天 10 次的额度必须在并发与重试下仍然准确。

## Expected outcome

- Flutter 客户端一份代码构建 Web、iOS、Android；Web 满足必交项，App 提供加分项。
- Node API 返回摘要、待办、工具轨迹和额度；额度超限返回 429。
- README 能让人从零跑通，演示视频覆盖核心链路。
- 硬件不在本期；以后用 Wokwi 或 ESP32 通过设备接口接入。

## Constraints

- 48 小时交付窗口；先服务端，后客户端。
- 后端 Node 22 + TypeScript + Fastify + SQLite；客户端 Flutter。
- 语音在端上用 `speech_to_text` 转写，文本输入兜底；DeepSeek 只负责文本理解与工具调用。
- 不引入登录、支付、真实硬件和水平扩展。

## Open questions

无。实现中遇到的新问题写进汇报，由协调者决定是否回填 spec。
