#!/usr/bin/env bash
#
# نشرٌ واحد على VPS: تثبيت ← فحص بيئة ← بناء ← هجرات ← إعادة تشغيل ← فحص صحة.
#
#   ./deploy/vps/deploy.sh            # نشر كامل
#   ./deploy/vps/deploy.sh --no-build # أعِد التشغيل فقط (بعد تعديل .env مثلاً)
#
# لماذا سكربت وليس خطوات في الرأس:
#   • الترتيب ليس تفصيلاً — هجرةٌ بعد إعادة التشغيل تعني دقائق من 500، وبناءٌ بلا
#     `API_PROXY_TARGET` يُثبّت في `routes-manifest.json` عنواناً خاطئاً لا يُصلحه
#     إعادةُ التشغيل (يحتاج بناءً جديداً).
#   • قفلٌ واحد: نشران متزامنان يتراكمان على نفس الهجرات والبناء.
#   • الفحص في النهاية: نشرةٌ «نجحت» ولا تُجيب 200 ليست نشرة.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0) قفلٌ واحد في كل مرة ───────────────────────────────────────────────────
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || fail "نشرٌ آخر يعمل الآن (‎.deploy.lock). انتظر أو أزل القفل يدوياً بعد التأكد."

[ -f .env ] || fail "لا يوجد .env — انسخ .env.example واملأه، أو شغّل pnpm env:setup."
command -v pnpm >/dev/null || fail "pnpm غير مثبّت (corepack enable && corepack prepare pnpm@9.15.0 --activate)."
command -v pm2  >/dev/null || fail "pm2 غير مثبّت (npm i -g pm2)."

# ── 1) الاعتماديات والبيئة ───────────────────────────────────────────────────
say "تثبيت الاعتماديات (frozen lockfile)"
pnpm install --frozen-lockfile

say "فحص متغيّرات البيئة"
pnpm run env:check

# القيم التي تُخبز في البناء: تغييرها لا يكفي مع `pm2 reload`، يلزم بناءٌ جديد.
export API_PROXY_TARGET="${API_PROXY_TARGET:-http://127.0.0.1:3000}"
export NODE_ENV="${NODE_ENV:-production}"

# ── 2) البناء ────────────────────────────────────────────────────────────────
if [ "$BUILD" -eq 1 ]; then
  # `pnpm -r` يبني الحزم المشتركة أولاً بالترتيب الطوبولوجي، ثم التطبيقات.
  say "بناء الحزم والتطبيقات (API + خمس واجهات)"
  pnpm run build
else
  say "تخطّي البناء (‏--no-build)"
fi

# ── 3) الهجرات قبل إعادة التشغيل ─────────────────────────────────────────────
say "تطبيق الهجرات"
pnpm run db:migrate

# ── 4) إعادة التشغيل ────────────────────────────────────────────────────────
say "تشغيل/تحديث عمليات PM2"
mkdir -p logs
pm2 startOrReload deploy/vps/ecosystem.config.cjs --env production
pm2 save

# ── 5) الفحص: لا نُعلن نجاحاً قبل أن يُجيب الخادم ───────────────────────────
say "فحص الصحة"
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/health/ready >/dev/null; then
    echo "  ✓ api ready"
    break
  fi
  [ "$attempt" -eq 30 ] && fail "الـAPI لم يُجب على /health/ready بعد 60 ثانية — راجع pm2 logs erp-api"
  sleep 2
done

for entry in "staff 3001" "marketing 3002" "platform-admin 3003" "customer-portal 3004" "bakery 3005"; do
  set -- $entry
  if curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:$2/"; then
    echo "  ✓ $1 (:$2)"
  else
    fail "$1 لا يُجيب على :$2 — راجع pm2 logs erp-$1"
  fi
done

# الفحص الداخلي أعلاه يُثبت أن العمليات تسمع. أما أن المضيفات تُخدم فعلاً عبر Nginx
# وشهادة Cloudflare فتلك طبقةٌ أخرى تسقط وحدها. يُشغَّل بطلبٍ صريح حتى لا يفشل النشر
# على خادمٍ لم يُوجَّه إليه DNS بعد.
if [ "${SMOKE_AFTER_DEPLOY:-0}" = "1" ]; then
  say "الفحص الخارجي (smoke.sh)"
  ./deploy/vps/smoke.sh
else
  say "تمّ النشر. الفحص الخارجي: ./deploy/vps/smoke.sh"
fi
