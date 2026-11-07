#!/usr/bin/env bash
# 端到端：起服务、等健康检查、跑端到端命令，结束后收掉服务。
# 改成你的命令：设置 E2E_CMD，或直接改下面的 default。
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"
START_CMD="${START_CMD:-node server/src/server.js}"
E2E_CMD="${E2E_CMD:-}"

# 示例（Flutter + iOS 模拟器）：
# E2E_CMD='cd app && flutter drive --driver=test_driver/integration_test.dart \
#   --target=integration_test/app_test.dart -d "iPhone 16 Pro" \
#   --dart-define=API_BASE_URL='"${BASE}"

if [ -z "$E2E_CMD" ]; then
  echo "尚未配置端到端命令。在 scripts/e2e.sh 里设置 E2E_CMD，或导出同名环境变量。" >&2
  exit 1
fi

sh -c "$START_CMD" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -sf "${BASE}/api/health" >/dev/null 2>&1 && break
  sleep 0.1
done

if ! curl -sf "${BASE}/api/health" >/dev/null 2>&1; then
  echo "服务端未能在 ${BASE} 上启动（START_CMD=${START_CMD}）" >&2
  exit 1
fi

sh -c "$E2E_CMD"
