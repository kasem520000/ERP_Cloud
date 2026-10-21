#!/usr/bin/env bash
#
# فحصُ ما بعد النشر — يُعاد بعد كل نشرة، وعلى الخادم نفسه.
#
#   ./deploy/vps/smoke.sh                     # الفحوص الأساسية (قراءة فقط)
#   ./deploy/vps/smoke.sh --with-rate-limit   # يضيف فحص سقف تسجيل الدخول (يستهلك دلو عنوانك)
#   SMOKE_DOMAIN=example.com ./deploy/vps/smoke.sh
#
#   # قبل تحويل DNS: افحص الأًصل نفسه، متجاوزاً Cloudflare
#   SMOKE_RESOLVE_IP=79.72.9.26 ./deploy/vps/smoke.sh
#
# لماذا سكربت: §8 في docs/DEPLOYMENT_VPS_AR.md سبعةُ فحوصٍ يدوية، وأكثرها يُنسى بعد
# النشرة الثالثة. والأسوأ من نسيانها أن تمرّ «ناجحة» وهي لا تفحص شيئاً: `curl` بلا
# `-f` يُرجع 502 بوصفه نجاحاً. هنا كل فحصٍ يُقارن برقمٍ متوقّع، والفشل يُحصى ويُخرج
# رمزاً غير صفري — فلا تُعلن نشرةٌ ناجحة وهي لا تخدم.
#
# الفحص لا يكتب شيئاً في قاعدة البيانات، لكنه يستهلك دلو سقف تسجيل الدخول لعنوانك،
# ولهذا فحص السقف اختياري (--with-rate-limit) ويُقفل بالمعامل لا بالنسيان.
#
set -uo pipefail

DOMAIN="${SMOKE_DOMAIN:-sahabaccounting.com}"
TIMEOUT="${SMOKE_TIMEOUT:-10}"
SCHEME="${SMOKE_SCHEME:-https}"
PORT="${SMOKE_PORT:-$([ "$SCHEME" = "https" ] && echo 443 || echo 80)}"
# لا نُثبّت المنفذ الافتراضي في الرابط، حتى يبقى `Host` مطابقاً لما في الشهادة.
if [ "$PORT" = "443" ] && [ "$SCHEME" = "https" ]; then SUFFIX=""; else SUFFIX=":$PORT"; fi

WITH_RATE_LIMIT=0
for arg in "$@"; do
  case "$arg" in
    --with-rate-limit) WITH_RATE_LIMIT=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "معامل غير معروف: $arg" >&2; exit 2 ;;
  esac
done

HOSTS=(staff marketing admin portal bakery)
pass=0
fail=0

ok() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; pass=$((pass + 1)); }
bad() { printf '  \033[1;31m✗\033[0m %s\n' "$*" >&2; fail=$((fail + 1)); }
section() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

# `--resolve` يُثبّت العنوان الذي نتّصل به دون تغيير `Host`/SNI — وهو ما تحتاجه للتحقّق
# من الأًصل قبل أن يُشير DNS إليه.
RESOLVE=()
curl_for() {
  local host="$1"
  shift
  if [ -n "${SMOKE_RESOLVE_IP:-}" ]; then
    curl "${RESOLVE[@]}" --resolve "$host:$PORT:$SMOKE_RESOLVE_IP" "$@"
  else
    curl "$@"
  fi
}

# رمزُ الحالة فقط. لا `|| echo 000`: ‏curl يطبع `000` بنفسه عند فشل الاتصال، والجمع
# بينهما يُنتج «000000» فيفشل كل فحصٍ برسالةٍ مضلّلة بدل «الخادم لا يستجيب».
code() {
  local host="$1" path="$2"
  shift 2
  local out
  out="$(curl_for "$host" -s -o /dev/null -m "$TIMEOUT" -w '%{http_code}' \
    "$SCHEME://$host$SUFFIX$path" "$@" 2>/dev/null)"
  printf '%s' "${out:-000}"
}

# ترويسةٌ من الردّ الأول (بلا تتبّع التحويلات: ما يهمّنا هو الـ3xx نفسها).
header() {
  local host="$1" path="$2" name="$3"
  curl_for "$host" -s -o /dev/null -m "$TIMEOUT" -D - "$SCHEME://$host$SUFFIX$path" 2>/dev/null |
    tr -d '\r' | awk -v want="$name" 'BEGIN{IGNORECASE=1} index(tolower($0), tolower(want)":")==1 {print substr($0, length(want)+3); exit}'
}

expect_code() {
  local label="$1" want="$2" host="$3" path="$4"
  local got
  got="$(code "$host" "$path")"
  if [ "$got" = "$want" ]; then
    ok "$label ($got)"
  else
    bad "$label: توقّعت $want ووجدت $got — $SCHEME://$host$SUFFIX$path"
  fi
}

# ── 01 — الـAPI حيّ وجاهز ────────────────────────────────────────────────────
section "01 — الـAPI"
live="$(curl_for "api.$DOMAIN" -s -m "$TIMEOUT" "$SCHEME://api.$DOMAIN$SUFFIX/health/live" 2>/dev/null || true)"
case "$live" in
  *'"status":"ok"'*) ok "/health/live يُعلن ok" ;;
  *) bad "/health/live لا يُعلن ok — الجسم: ${live:0:120}" ;;
esac
ready="$(curl_for "api.$DOMAIN" -s -m "$TIMEOUT" "$SCHEME://api.$DOMAIN$SUFFIX/health/ready" 2>/dev/null || true)"
case "$ready" in
  *'"database":"connected"'*) ok "/health/ready: القاعدة متّصلة" ;;
  *) bad "/health/ready لا يرى القاعدة — الجسم: ${ready:0:160}" ;;
esac

# ── 02 — كل سطح يُقدّم صفحةً حقيقية ─────────────────────────────────────────
section "02 — الواجهات الخمس"
for host in "${HOSTS[@]}"; do
  expect_code "$host.$DOMAIN/" 200 "$host.$DOMAIN" "/"
done

# ── 03 — الوكيل same-origin يصل إلى الـAPI ──────────────────────────────────
section "03 — وكيل /api من داخل السطح (same-origin)"
for host in "${HOSTS[@]}"; do
  expect_code "$host/api/health/live" 200 "$host.$DOMAIN" "/api/health/live"
done

# ── 04 — التوجيه: http ⇒ https، والجذر ⇒ التسويق ─────────────────────────────
section "04 — التوجيه"
if [ "$SCHEME" = "https" ]; then
  location="$(header "staff.$DOMAIN" "/" "Location")"
  case "$location" in
    "") ok "لا حلقة إعادة توجيه على staff (الطلب https يُخدم مباشرة)" ;;
    "https://staff.$DOMAIN/"*) ok "http ⇒ https على staff" ;;
    *) bad "توجيه staff غير صحيح: '$location'" ;;
  esac
fi
case "$(code "$DOMAIN" "/")" in
  200|301|308) ok "الجذر يستجيب" ;;
  *) bad "الجذر لا يستجيب (متوقّع 200 أو 301)" ;;
esac
root_location="$(header "$DOMAIN" "/" "Location")"
case "$root_location" in
  "") ok "الجذر يُخدم مباشرة بلا تحويل" ;;
  "https://marketing.$DOMAIN"*) ok "الجذر ⇒ marketing" ;;
  *) bad "الجذر لا يوجّه إلى التسويق: '$root_location'" ;;
esac

# ── 05 — ما لا يجوز أن يكون عاماً ───────────────────────────────────────────
section "05 — الأسطح المغلقة"
expect_code "/metrics محجوب" 403 "api.$DOMAIN" "/metrics"
expect_code "/api/docs مغلق" 404 "api.$DOMAIN" "/api/docs"
# حرّاس الـAPI: بلا توكن يُرفض لا يُخدم.
expect_code "مسار محمي يرفض بلا توكن" 401 "api.$DOMAIN" "/api/v1/platform/health/detailed"

# ── 06 — العزل: لا استماع على واجهةٍ عامة ───────────────────────────────────
section "06 — العزل على الخادم"
if command -v ss >/dev/null; then
  exposed="$(ss -ltn 2>/dev/null | awk '$4 ~ /:(3000|3001|3002|3003|3004|3005|5432|6379)$/ && $4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/')"
  if [ -z "$exposed" ]; then
    ok "المنافذ الداخلية (3000–3005، 5432، 6379) على loopback وحدها"
  else
    bad "منافذ مستمعة على غير loopback:
$exposed"
  fi
else
  bad "‏ss غير موجود — لا يمكن إثبات العزل"
fi

# ── 07 — المستهلك يعمل ──────────────────────────────────────────────────────
section "07 — العمال (worker)"
if command -v pm2 >/dev/null; then
  state="$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s).find(p=>p.name==="erp-worker");process.stdout.write(a?a.pm2_env.status:"missing")}catch{process.stdout.write("unreadable")}})' 2>/dev/null || echo "unreadable")"
  case "$state" in
    online) ok "erp-worker يعمل" ;;
    *) bad "erp-worker: $state — راجع pm2 logs erp-worker" ;;
  esac
else
  echo "  – pm2 غير موجود على هذا المضيف؛ تخطّي فحص العمال"
fi

# ── 08 — سقف الطلبات (اختياري: يستهلك دلو عنوانك) ───────────────────────────
if [ "$WITH_RATE_LIMIT" -eq 1 ]; then
  section "08 — سقف تسجيل الدخول"
  limited_at=0
  retry_after=""
  for attempt in $(seq 1 15); do
    # الترويسات والرمز من الرد نفسه: `Retry-After` لا يظهر إلا على 429.
    response="$(curl_for "api.$DOMAIN" -s -m "$TIMEOUT" -D - -o /dev/null -X POST \
      "$SCHEME://api.$DOMAIN$SUFFIX/api/v1/auth/login" \
      -H 'content-type: application/json' \
      -d '{"email":"smoke-probe@example.test","password":"not-the-password-1234"}' 2>/dev/null || true)"
    status="$(printf '%s' "$response" | head -1 | awk '{print $2}')"
    if [ "$status" = "429" ]; then
      limited_at="$attempt"
      retry_after="$(printf '%s' "$response" | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^retry-after:/ {print $2; exit}')"
      break
    fi
  done
  if [ "$limited_at" -gt 0 ]; then
    ok "السقف فعّال (429 عند المحاولة $limited_at)"
    if [ -n "$retry_after" ]; then
      ok "Retry-After مُعلَن ($retry_after ثانية)"
    else
      bad "429 بلا Retry-After — الواجهة لا تعرف متى تُعيد المحاولة"
    fi
    [ "$limited_at" -lt 8 ] && echo "  ⚠ 429 مبكر: تحقّق من real_ip/CF-Connecting-IP — قد يكون الجميع في دلو واحد."
  else
    bad "لم يظهر 429 خلال 15 محاولة — السقف أو real_ip غير مضبوط"
  fi
fi

# ── الخلاصة ─────────────────────────────────────────────────────────────────
printf '\n\033[1mالنتيجة: %d ناجح، %d فاشل\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || { echo "لا تُعلن النشرة ناجحة وهذه الفحوص حمراء." >&2; exit 1; }
