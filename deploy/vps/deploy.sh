#!/usr/bin/env bash
#
# نشرٌ واحد على VPS: تثبيت ← فحص بيئة ← بناء ← هجرات ← إعادة تشغيل متدرّجة ← فحص صحة.
#
#   ./deploy/vps/deploy.sh            # نشر كامل
#   ./deploy/vps/deploy.sh --no-build # أعِد التشغيل فقط (بعد تعديل .env مثلاً)
#
# لماذا سكربت وليس خطوات في الرأس:
#   • الترتيب ليس تفصيلاً — هجرةٌ بعد إعادة التشغيل تعني دقائق من 500، وبناءٌ بلا
#     `API_PROXY_TARGET` يُثبّت في `routes-manifest.json` عنواناً خاطئاً لا يُصلحه
#     إعادةُ التشغيل (يحتاج بناءً جديداً).
#   • إعادة تشغيل متدرّجة: `erp-api` و`erp-worker` أولاً، وانتظار جهوزية الـAPI،
#     ثم الواجهات الخمس — فلا تصطدم طلبات الواجهات بـ`ECONNREFUSED 127.0.0.1:3000` أثناء الإقلاع.
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
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '  \033[1;33m⚠ %s\033[0m\n' "$*"; }
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

# ── 4) إعادة التشغيل المتدرّجة وفحص الصحة ────────────────────────────────────
say "تشغيل/تحديث الـAPI والعامل الخلفي أولاً"
mkdir -p logs
pm2 startOrReload deploy/vps/ecosystem.config.cjs --only erp-api,erp-worker --env production --update-env

say "فحص جهوزية الـAPI قبل إعادة تشغيل الواجهات"
for attempt in $(seq 1 30); do
  # بلا `-S` أثناء انتظار الإقلاع حتى لا يطبع curl رسائل `Failed to connect` المربكة في المحاولات الأولى.
  if curl -fs --max-time 3 http://127.0.0.1:3000/health/ready >/dev/null 2>&1; then
    echo "  ✓ api ready"
    break
  fi
  [ "$attempt" -eq 30 ] && fail "الـAPI لم يُجب على /health/ready بعد 60 ثانية — راجع pm2 logs erp-api"
  sleep 2
done

say "تشغيل/تحديث الواجهات الخمس"
pm2 startOrReload deploy/vps/ecosystem.config.cjs \
  --only erp-staff,erp-marketing,erp-platform-admin,erp-customer-portal,erp-bakery \
  --env production --update-env
pm2 save

say "فحص صحة الواجهات الخمس"
for entry in "staff 3001" "marketing 3002" "platform-admin 3003" "customer-portal 3004" "bakery 3005"; do
  set -- $entry
  surface_ok=0
  for attempt in $(seq 1 15); do
    if curl -fs --max-time 5 -o /dev/null "http://127.0.0.1:$2/" 2>/dev/null; then
      echo "  ✓ $1 (:$2)"
      surface_ok=1
      break
    fi
    sleep 1
  done
  [ "$surface_ok" -eq 1 ] || fail "$1 لا يُجيب على :$2 — راجع pm2 logs erp-$1"
done

# ── 5) رصد انحراف إعدادات المضيف (Nginx / عزل 5432 و6379) ────────────────────
HOST_DRIFT=0
if [ -f /etc/nginx/sites-available/erpcloud ] && ! cmp -s "$ROOT/deploy/vps/nginx-erpcloud.conf" /etc/nginx/sites-available/erpcloud; then
  warn "/etc/nginx/sites-available/erpcloud يختلف عن deploy/vps/nginx-erpcloud.conf"
  HOST_DRIFT=1
fi
if [ -f /etc/nginx/snippets/erp-proxy.conf ] && ! cmp -s "$ROOT/deploy/vps/erp-proxy.conf" /etc/nginx/snippets/erp-proxy.conf; then
  warn "/etc/nginx/snippets/erp-proxy.conf يختلف عن deploy/vps/erp-proxy.conf"
  HOST_DRIFT=1
fi
if command -v ss >/dev/null 2>&1; then
  exposed_ports="$(ss -ltn 2>/dev/null | awk '$4 ~ /:(3000|3001|3002|3003|3004|3005|5432|6379)$/ && $4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/')"
  if [ -n "$exposed_ports" ]; then
    warn "منافذ داخلية مستمعة على غير loopback (5432/6379 أو 3000–3005)"
    HOST_DRIFT=1
  fi
fi
if [ "$HOST_DRIFT" -eq 1 ]; then
  warn "لمزامنة Nginx وعزل PostgreSQL/Redis على loopback شغّل مرة واحدة: sudo ./deploy/vps/sync-host.sh"
fi

# الفحص الداخلي أعلاه يُثبت أن العمليات تسمع. أما أن المضيفات تُخدم فعلاً عبر Nginx
# وشهادة Cloudflare فتلك طبقةٌ أخرى تسقط وحدها. يُشغَّل بطلبٍ صريح حتى لا يفشل النشر
# على خادمٍ لم يُوجَّه إليه DNS بعد.
if [ "${SMOKE_AFTER_DEPLOY:-0}" = "1" ]; then
  say "الفحص الخارجي (smoke.sh)"
  ./deploy/vps/smoke.sh
else
  say "تمّ النشر. الفحص الخارجي: ./deploy/vps/smoke.sh"
fi
