#!/usr/bin/env bash
# CI 步骤的唯一实现。GitHub Actions 与本地容器都调用这个脚本，
# 避免「workflow 里一套、本地跑另一套」的漂移（F25）。
#
# 用法：
#   bash scripts/debug/ci-steps.sh          # 完整跑（装依赖 → 守护进程 → doctor → suite → smoke → contracts）
#   SKIP_INSTALL=1 bash scripts/debug/ci-steps.sh   # 依赖已就绪时跳过 pnpm install
#
# 浏览器：优先用 $CHROME；否则按 PATH 找 google-chrome / chromium。找不到就明确失败，
# 不静默跳过——「没跑」和「跑过了」必须能区分。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP_DIR"

if [ -z "${CHROME:-}" ]; then
  for bin in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$bin" >/dev/null 2>&1; then
      CHROME="$(command -v "$bin")"
      break
    fi
  done
fi
if [ -z "${CHROME:-}" ]; then
  # 再问引擎自己：CHROME_CANDIDATES 覆盖 Windows / macOS 的安装路径，
  # 脚本不重复维护一份（重复就会漂移——Windows 上明明装了 Chrome，脚本却报找不到）。
  CHROME="$(node -e 'import("./scripts/debug/engine.mjs").then((m)=>{const c=m.findChrome();if(!c)process.exit(1);process.stdout.write(c)})' 2>/dev/null || true)"
fi
if [ -z "${CHROME:-}" ]; then
  echo "no Chrome/Chromium found (looked for google-chrome, google-chrome-stable, chromium, chromium-browser)." >&2
  echo "install google-chrome-stable or chromium, or set CHROME=/path/to/binary." >&2
  exit 1
fi
export CHROME
echo "== browser =="
# Windows 上 `chrome.exe --version` 不打印版本，反而会真的拉起一个浏览器窗口；
# 那边只报路径，版本交给引擎自己用 CDP 拿。
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) echo "browser: $CHROME" ;;
  *) "$CHROME" --version ;;
esac

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  echo "== install =="
  pnpm install --frozen-lockfile
fi

# 无论后面哪一步失败，都要把守护进程和 next dev 收掉。
cleanup() {
  echo "== teardown =="
  node scripts/debug.mjs down || true
}
trap cleanup EXIT

echo "== up (next dev + headless chrome) =="
node scripts/debug.mjs up --serve

echo "== doctor =="
node scripts/debug.mjs doctor

# smoke 先跑：它逐路由访问一遍，把 Next dev 的按需编译预热掉；
# 冷 runner 上直接跑 suite 时，/3d 与 /love/play 的首次编译会把场景超时吃光。
echo "== smoke (warm-up) =="
node scripts/debug.mjs smoke

echo "== suite =="
node scripts/debug.mjs suite

echo "== contracts =="
node scripts/debug.mjs contracts

echo "== ok =="
