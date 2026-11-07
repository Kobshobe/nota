# Nota

AI 语音便签 MVP：按住说话或输入文字，AI 整理摘要与待办，并由 Agent 调工具创建待办、设置提醒、查询历史。

## 形态

- Flutter 客户端，一份代码构建 Web、iOS、Android。
- Node 22 + TypeScript + Fastify API，SQLite 存笔记、待办、工具轨迹与额度。
- 语音在端上用 `speech_to_text` 转文字，文本输入兜底；Agent 用 DeepSeek 的 function calling。
- 契约是唯一事实源：[`contract/openapi.yaml`](contract/openapi.yaml)；边界见 [`docs/architecture.md`](docs/architecture.md)。

## 状态

骨架与契约已定稿，服务端与客户端待实现；当前任务见 [`.changes/bootstrap-nota-mvp/`](.changes/bootstrap-nota-mvp/)。

## 常用命令

```sh
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
source scripts/env.sh
make check         # 文档门禁 + 契约破坏性
make check-all     # 加两端测试与运行时一致性
make baseline      # 发布时冻结契约基线
```
