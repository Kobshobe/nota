# 环境变量：所有命令前先 source 一次
# 用法：source scripts/env.sh
# 改这里：把你项目需要的工具链路径和缓存位置写进来。

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 示例（Flutter）：把 SDK 路径和 pub 缓存固定下来，避免落到家目录。
export FLUTTER="${FLUTTER:-$(command -v flutter || echo /usr/local/bin/flutter)}"
export PUB_CACHE="${PUB_CACHE:-${WORKSPACE_ROOT}/.cache/pub}"
export FLUTTER_SUPPRESS_ANALYTICS=true

export PORT="${PORT:-8080}"
export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${PORT}}"

echo "PORT=${PORT}  API_BASE_URL=${API_BASE_URL}"
