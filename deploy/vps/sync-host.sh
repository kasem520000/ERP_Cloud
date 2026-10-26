#!/usr/bin/env bash
#
# مزامنة إعدادات المضيف الجذرية (Nginx + عزل PostgreSQL وRedis على loopback).
#
#   sudo ./deploy/vps/sync-host.sh
#
# متى يُشغَّل:
#   • عند الإعداد الأول للخادم، أو كلما تغيّر `deploy/vps/nginx-erpcloud.conf` أو
#     `deploy/vps/erp-proxy.conf` (مثلاً إضافة `marketing.sahabaccounting.com` أو حجب `/api/docs`).
#   • حين يفشل البند 06 في `smoke.sh` بسبب استماع PostgreSQL (5432) أو Redis (6379) على `0.0.0.0`/`[::]`.
#
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "✗ شغّل هذا السكربت بصلاحية root: sudo ./deploy/vps/sync-host.sh" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1) مزامنة Nginx ──────────────────────────────────────────────────────────
if command -v nginx >/dev/null 2>&1; then
  say "مزامنة إعدادات Nginx"
  mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled

  NGINX_CHANGED=0
  BACKUP_SITE=""
  BACKUP_SNIPPET=""

  if [ ! -f /etc/nginx/snippets/erp-proxy.conf ] || ! cmp -s "$ROOT/deploy/vps/erp-proxy.conf" /etc/nginx/snippets/erp-proxy.conf; then
    if [ -f /etc/nginx/snippets/erp-proxy.conf ]; then
      BACKUP_SNIPPET="/etc/nginx/snippets/erp-proxy.conf.bak.$STAMP"
      cp -a /etc/nginx/snippets/erp-proxy.conf "$BACKUP_SNIPPET"
    fi
    cp "$ROOT/deploy/vps/erp-proxy.conf" /etc/nginx/snippets/erp-proxy.conf
    NGINX_CHANGED=1
    ok "تم تحديث /etc/nginx/snippets/erp-proxy.conf"
  else
    ok "/etc/nginx/snippets/erp-proxy.conf مطابق للمستودع"
  fi

  if [ ! -f /etc/nginx/sites-available/erpcloud ] || ! cmp -s "$ROOT/deploy/vps/nginx-erpcloud.conf" /etc/nginx/sites-available/erpcloud; then
    if [ -f /etc/nginx/sites-available/erpcloud ]; then
      BACKUP_SITE="/etc/nginx/sites-available/erpcloud.bak.$STAMP"
      cp -a /etc/nginx/sites-available/erpcloud "$BACKUP_SITE"
    fi
    cp "$ROOT/deploy/vps/nginx-erpcloud.conf" /etc/nginx/sites-available/erpcloud
    NGINX_CHANGED=1
    ok "تم تحديث /etc/nginx/sites-available/erpcloud"
  else
    ok "/etc/nginx/sites-available/erpcloud مطابق للمستودع"
  fi

  if [ ! -L /etc/nginx/sites-enabled/erpcloud ]; then
    ln -sf /etc/nginx/sites-available/erpcloud /etc/nginx/sites-enabled/erpcloud
    NGINX_CHANGED=1
  fi
  if [ -e /etc/nginx/sites-enabled/default ]; then
    rm -f /etc/nginx/sites-enabled/default
    NGINX_CHANGED=1
    ok "تمت إزالة /etc/nginx/sites-enabled/default المتعارض"
  fi

  if [ "$NGINX_CHANGED" -eq 1 ]; then
    if nginx -t; then
      systemctl reload nginx
      ok "nginx -t ناجح وتمت إعادة تحميل Nginx"
    else
      [ -n "$BACKUP_SITE" ] && cp -a "$BACKUP_SITE" /etc/nginx/sites-available/erpcloud
      [ -n "$BACKUP_SNIPPET" ] && cp -a "$BACKUP_SNIPPET" /etc/nginx/snippets/erp-proxy.conf
      fail "فشل nginx -t — أُعيدت النسخة الاحتياطية تلقائياً. تحقّق من /etc/nginx/ssl/origin.{crt,key}."
    fi
  fi
else
  warn "nginx غير مثبّت على هذا المضيف؛ تم تخطّي مزامنة Nginx"
fi

# ── 2) عزل PostgreSQL على loopback (127.0.0.1 / ::1) ─────────────────────────
say "التحقّق من عزل PostgreSQL (5432) على loopback"
PG_UPDATED=0
for pgconf in /etc/postgresql/*/main/postgresql.conf; do
  [ -f "$pgconf" ] || continue
  if ! grep -Eq "^[[:space:]]*listen_addresses[[:space:]]*=[[:space:]]*'(localhost|127\.0\.0\.1)'" "$pgconf"; then
    cp -a "$pgconf" "$pgconf.bak.$STAMP"
    if grep -Eq "^[[:space:]]*#?[[:space:]]*listen_addresses[[:space:]]*=" "$pgconf"; then
      sed -i -E "s|^[[:space:]]*#?[[:space:]]*listen_addresses[[:space:]]*=.*|listen_addresses = 'localhost'|" "$pgconf"
    else
      printf "\nlisten_addresses = 'localhost'\n" >> "$pgconf"
    fi
    PG_UPDATED=1
    ok "ضُبطت listen_addresses = 'localhost' في $pgconf"
  else
    ok "$pgconf مقصور مسبقاً على localhost"
  fi
done
if [ "$PG_UPDATED" -eq 1 ] && command -v systemctl >/dev/null 2>&1; then
  systemctl restart postgresql
  ok "أُعيد تشغيل خدمة postgresql على loopback"
fi

# ── 3) عزل Redis على loopback (127.0.0.1 / ::1) ──────────────────────────────
say "التحقّق من عزل Redis (6379) على loopback"
REDIS_UPDATED=0
for rconf in /etc/redis/redis.conf; do
  [ -f "$rconf" ] || continue
  if ! grep -Eq "^[[:space:]]*bind[[:space:]]+127\.0\.0\.1([[:space:]]+(::1|-::1))?[[:space:]]*$" "$rconf"; then
    cp -a "$rconf" "$rconf.bak.$STAMP"
    if grep -Eq "^[[:space:]]*#?[[:space:]]*bind[[:space:]]+" "$rconf"; then
      sed -i -E "s|^[[:space:]]*#?[[:space:]]*bind[[:space:]]+.*|bind 127.0.0.1 ::1|" "$rconf"
    else
      printf "\nbind 127.0.0.1 ::1\n" >> "$rconf"
    fi
    if grep -Eq "^[[:space:]]*protected-mode[[:space:]]+no" "$rconf"; then
      sed -i -E "s|^[[:space:]]*protected-mode[[:space:]]+no|protected-mode yes|" "$rconf"
    fi
    REDIS_UPDATED=1
    ok "ضُبط bind 127.0.0.1 ::1 في $rconf"
  else
    ok "$rconf مقصور مسبقاً على loopback"
  fi
done
if [ "$REDIS_UPDATED" -eq 1 ] && command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files | grep -q '^redis-server\.service'; then
    systemctl restart redis-server
    ok "أُعيد تشغيل خدمة redis-server على loopback"
  elif systemctl list-unit-files | grep -q '^redis\.service'; then
    systemctl restart redis
    ok "أُعيد تشغيل خدمة redis على loopback"
  fi
fi

# ── 4) تحقّق نهائي من المنافذ المستمعة ───────────────────────────────────────
if command -v ss >/dev/null 2>&1; then
  exposed="$(ss -ltn 2>/dev/null | awk '$4 ~ /:(3000|3001|3002|3003|3004|3005|5432|6379)$/ && $4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/')"
  if [ -z "$exposed" ]; then
    ok "جميع المنافذ الداخلية (3000–3005، 5432، 6379) مستمعة على loopback فقط"
  else
    warn "لا تزال هناك منافذ مستمعة على غير loopback (إن كانت من Docker فأعد إنشاء الحاويات بعد تحديث docker-compose.yml):"
    printf '%s\n' "$exposed"
  fi
fi
