#!/bin/bash
# 发布：跑测试 → 把 main 推到 release 分支。以虎 One 跟踪 release(见 yh-app.json 的 deploy)，
# 当前是 manual 模式: 平台提示有新版本，管理员在控制台点「发布」后构建上线，失败自动回滚。
#   ./release.sh
# 规则：只在 main 上开发，release 只由本脚本更新（不要直接往 release 提交）。
set -uo pipefail
# 不依赖数据库的检查: 后端单元测试(activity.test.js 要写库, 除外) + 前端单元测试 + 前端构建。
# 集成测试(backend/test/integration)要连着数据库跑起来的后端, 发布前在本地另跑: cd backend && npm test
TEST_CMD='cd backend && node --test $(ls test/lib/*.test.js | grep -v activity.test.js) && cd ../frontend && npm test && npx vite build --outDir "$(mktemp -d)" --emptyOutDir'

cd "$(dirname "$0")" || exit 1
die() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "请切到 main 分支再发布"
[ -z "$(git status --porcelain)" ] || die "有未提交的改动，先提交或暂存"
git fetch -q origin || die "git fetch 失败"
git merge-base --is-ancestor origin/main HEAD || die "远端 main 有你本地没有的提交，先 git pull --rebase"
if git rev-parse -q --verify origin/release >/dev/null; then
  git merge-base --is-ancestor origin/release HEAD || die "release 上有 main 没有的提交（有人直接改了 release？），先合回 main"
  [ "$(git rev-parse origin/release)" != "$(git rev-parse HEAD)" ] || die "没有新提交，release 已是最新"
  echo "本次发布："; git log --oneline --no-merges origin/release..HEAD | sed 's/^/  /'
else
  echo "首次创建 release 分支：$(git log -1 --oneline)"
fi

printf '\033[36m▶ 测试：%s\033[0m\n' "$TEST_CMD"
bash -c "$TEST_CMD" || die "测试未通过，停止发布"

git push -q origin HEAD:main && git push -q origin HEAD:release || die "推送失败"
printf '\033[32m✅ 已推送 %s 到 release。到以虎 One 控制台「管理 → 应用」点「发布」上线（服务器上 yh history 看记录）\033[0m\n' "$(git rev-parse --short=7 HEAD)"
