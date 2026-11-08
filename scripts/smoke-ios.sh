#!/usr/bin/env bash
# iOS 冒烟：在已启动的模拟器上跑一次真实登录，验证「装进去能用」。
# 用法：make smoke-ios（需要后端已在 127.0.0.1:8080 运行）
# 可选环境变量：IOS_DEVICE（模拟器 UDID）、SMOKE_EMAIL、SMOKE_PASSWORD。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/env.sh" >/dev/null

if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  echo "后端未就绪：先运行 npm --prefix server start" >&2
  exit 1
fi

DEVICE="${IOS_DEVICE:-$(xcrun simctl list devices booted -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
ids = [device["udid"] for runtime in devices.values() for device in runtime]
print(ids[0] if ids else "")
')}"

if [ -z "$DEVICE" ]; then
  echo "没有已启动的模拟器：先 open -a Simulator 或 xcrun simctl boot <UDID>" >&2
  exit 1
fi

# 上一轮被杀掉的测试可能留下一个占着 VM service 的进程，先清干净再装。
xcrun simctl terminate "$DEVICE" com.nota.nota >/dev/null 2>&1 || true
xcrun simctl uninstall "$DEVICE" com.nota.nota >/dev/null 2>&1 || true

cd "$ROOT/app"
# 卡死时最多等 8 分钟，别让门禁无限挂着。
perl -e 'alarm 480; exec @ARGV' -- flutter test integration_test/login_smoke_test.dart -d "$DEVICE" \
  --dart-define=SMOKE_EMAIL="${SMOKE_EMAIL:-smoke@nota.app}" \
  --dart-define=SMOKE_PASSWORD="${SMOKE_PASSWORD:-nota-smoke-123}"
