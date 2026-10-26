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
  ROLLBACK_DIR="/etc/nginx/.erpcloud-backup-$STAMP"
  mkdir -p "$ROLLBACK_DIR/sites-enabled" "$ROLLBACK_DIR/sites-available" "$ROLLBACK_DIR/snippets"

  cp -a /etc/nginx/sites-enabled/. "$ROLLBACK_DIR/sites-enabled/" 2>/dev/null || true
  [ -f /etc/nginx/sites-available/erpcloud ] && cp -a /etc/nginx/sites-available/erpcloud "$ROLLBACK_DIR/sites-available/erpcloud"
  [ -f /etc/nginx/snippets/erp-proxy.conf ] && cp -a /etc/nginx/snippets/erp-proxy.conf "$ROLLBACK_DIR/snippets/erp-proxy.conf"

  # اكتشاف شهادة TLS الحالية على الخادم إن كانت في مسار غير `/etc/nginx/ssl/origin.{crt,key}` (مثل Let's Encrypt)
  DETECTED_CERT=""
  DETECTED_KEY=""
  if [ ! -f /etc/nginx/ssl/origin.crt ] || [ ! -f /etc/nginx/ssl/origin.key ]; then
    for cand in /etc/nginx/sites-enabled/* /etc/nginx/sites-available/*; do
      [ -f "$cand" ] || continue
      case "$cand" in *.bak.*) continue ;; esac
      c_cert="$(awk '/^[[:space:]]*ssl_certificate[[:space:]]+/ { gsub(/;/, "", $2); print $2; exit }' "$cand" || true)"
      c_key="$(awk '/^[[:space:]]*ssl_certificate_key[[:space:]]+/ { gsub(/;/, "", $2); print $2; exit }' "$cand" || true)"
      if [ -n "$c_cert" ] && [ -n "$c_key" ] && [ -f "$c_cert" ] && [ -f "$c_key" ]; then
        DETECTED_CERT="$c_cert"
        DETECTED_KEY="$c_key"
        break
      fi
    done
  fi

  RENDERED_SITE="$(mktemp)"
  cp "$ROOT/deploy/vps/nginx-erpcloud.conf" "$RENDERED_SITE"

  if [ -n "$DETECTED_CERT" ] && [ -n "$DETECTED_KEY" ]; then
    sed -i \
      -e "s|/etc/nginx/ssl/origin.crt|$DETECTED_CERT|g" \
      -e "s|/etc/nginx/ssl/origin.key|$DETECTED_KEY|g" \
      "$RENDERED_SITE"
    ok "استُخدمت شهادة TLS الموجودة على الخادم: $DETECTED_CERT"
  fi

  # توافق تلقائي مع إصدارات Nginx الأقدم من 1.25.1 التي لا تدعم توجيه `http2 on;` المستقل
  NGINX_VER="$(nginx -v 2>&1 | sed -nE 's/.*nginx\/([0-9]+\.[0-9]+\.[0-9]+).*/\1/p')"
  if [ -n "$NGINX_VER" ]; then
    IFS=. read -r N_MAJ N_MIN N_PAT <<< "$NGINX_VER"
    if [ "$N_MAJ" -eq 1 ] && { [ "$N_MIN" -lt 25 ] || { [ "$N_MIN" -eq 25 ] && [ "$N_PAT" -lt 1 ]; }; }; then
      sed -i \
        -e '/^[[:space:]]*http2 on;/d' \
        -e 's/listen 443 ssl default_server;/listen 443 ssl http2 default_server;/g' \
        -e 's/listen \[::\]:443 ssl default_server;/listen [::]:443 ssl http2 default_server;/g' \
        -e 's/listen 443 ssl;/listen 443 ssl http2;/g' \
        -e 's/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/g' \
        "$RENDERED_SITE"
    fi
  fi

  if [ -e /etc/nginx/sites-enabled/default ] || [ -L /etc/nginx/sites-enabled/default ]; then
    rm -f /etc/nginx/sites-enabled/default
    ok "تمت إزالة /etc/nginx/sites-enabled/default المتعارض"
  fi

  # تعطيل أي ملف آخر في sites-enabled يعرّف نفس نطاق sahabaccounting.com منعاً لتعارض server_name
  for enabled in /etc/nginx/sites-enabled/*; do
    [ -e "$enabled" ] || continue
    [ "$(basename "$enabled")" = "erpcloud" ] && continue
    if grep -q "sahabaccounting\.com" "$enabled" 2>/dev/null; then
      rm -f "$enabled"
      ok "تم تعطيل ملف الموقع القديم المتعارض: $enabled"
    fi
  done

  # إذا كان على الخادم موقعٌ آخر مستقل يحجز default_server مسبقاً على 80 أو 443، نرفع وسم default_server منعاً لخطأ duplicate default server
  for other in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -f "$other" ] || continue
    [ "$(basename "$other")" = "erpcloud" ] && continue
    if grep -Eq '^[[:space:]]*listen[[:space:]].*\b80\b.*default_server' "$other" 2>/dev/null; then
      sed -i -E 's/(listen[[:space:]]+(\[::\]:)?80)[[:space:]]+default_server;/\1;/g' "$RENDERED_SITE"
      warn "موقع آخر ($other) يحجز default_server على 80 — تم تجنّب التكرار تلقائياً"
    fi
    if grep -Eq '^[[:space:]]*listen[[:space:]].*\b443\b.*default_server' "$other" 2>/dev/null; then
      sed -i -E 's/(listen[[:space:]]+(\[::\]:)?443[[:space:]]+ssl([[:space:]]+http2)?)[[:space:]]+default_server;/\1;/g' "$RENDERED_SITE"
      warn "موقع آخر ($other) يحجز default_server على 443 — تم تجنّب التكرار تلقائياً"
    fi
  done

  cp "$ROOT/deploy/vps/erp-proxy.conf" /etc/nginx/snippets/erp-proxy.conf
  ok "تم تحديث /etc/nginx/snippets/erp-proxy.conf"

  cp "$RENDERED_SITE" /etc/nginx/sites-available/erpcloud
  chmod 644 /etc/nginx/sites-available/erpcloud
  rm -f "$RENDERED_SITE"
  ok "تم تحديث /etc/nginx/sites-available/erpcloud"

  ln -sf /etc/nginx/sites-available/erpcloud /etc/nginx/sites-enabled/erpcloud

  if nginx -t; then
    systemctl reload nginx
    rm -rf "$ROLLBACK_DIR"
    ok "nginx -t ناجح وتمت إعادة تحميل Nginx بلا أخطاء"
  else
    rm -f /etc/nginx/sites-enabled/*
    cp -a "$ROLLBACK_DIR/sites-enabled/." /etc/nginx/sites-enabled/ 2>/dev/null || true
    if [ -f "$ROLLBACK_DIR/sites-available/erpcloud" ]; then
      cp -a "$ROLLBACK_DIR/sites-available/erpcloud" /etc/nginx/sites-available/erpcloud
    else
      rm -f /etc/nginx/sites-available/erpcloud
    fi
    if [ -f "$ROLLBACK_DIR/snippets/erp-proxy.conf" ]; then
      cp -a "$ROLLBACK_DIR/snippets/erp-proxy.conf" /etc/nginx/snippets/erp-proxy.conf
    fi
    rm -rf "$ROLLBACK_DIR"
    fail "فشل nginx -t — أُعيدت الإعدادات السابقة كاملةً تلقائياً."
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

# ── 4) عزل حاويات Docker (erp-postgres / erp-redis) إن كانت مستضافة عبر Docker ─
DOCKER_REBOUND=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker container inspect erp-postgres >/dev/null 2>&1; then
    pg_ports="$(docker port erp-postgres 5432/tcp 2>/dev/null || true)"
    if printf '%s\n' "$pg_ports" | grep -Eq '^(0\.0\.0\.0|\[::\]|:::):5432$'; then
      say "تقييد حاوية Docker (erp-postgres) على 127.0.0.1:5432 مع الحفاظ على البيانات"
      PG_PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' erp-postgres 2>/dev/null || true)"
      PG_VOL="$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/var/lib/postgresql/data" }}{{ .Name }}{{ end }}{{ end }}' erp-postgres 2>/dev/null || true)"
      if [ -n "$PG_PROJECT" ] && [ "$PG_VOL" = "${PG_PROJECT}_postgres_data" ] && [ -f "$ROOT/infrastructure/docker-compose.yml" ]; then
        docker compose -p "$PG_PROJECT" -f "$ROOT/infrastructure/docker-compose.yml" up -d postgres
        for _ in $(seq 1 30); do
          if docker exec erp-postgres pg_isready -U app >/dev/null 2>&1; then
            break
          fi
          sleep 1
        done
        DOCKER_REBOUND=1
        ok "أُعيد ربط erp-postgres على 127.0.0.1:5432 مع الحفاظ على الحجم الدائم ($PG_VOL)"
      else
        warn "تعذّر التعرّف الآلي على مشروع Compose لحاوية erp-postgres (project='$PG_PROJECT'، volume='$PG_VOL') — لم تُمسّ الحاوية حفاظاً على البيانات"
      fi
    else
      ok "حاوية erp-postgres مقصورة مسبقاً على 127.0.0.1:5432"
    fi
  fi

  if docker container inspect erp-redis >/dev/null 2>&1; then
    redis_ports="$(docker port erp-redis 6379/tcp 2>/dev/null || true)"
    if printf '%s\n' "$redis_ports" | grep -Eq '^(0\.0\.0\.0|\[::\]|:::):6379$'; then
      say "تقييد حاوية Docker (erp-redis) على 127.0.0.1:6379 مع الحفاظ على البيانات"
      REDIS_PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' erp-redis 2>/dev/null || true)"
      REDIS_VOL="$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/data" }}{{ .Name }}{{ end }}{{ end }}' erp-redis 2>/dev/null || true)"
      if [ -n "$REDIS_PROJECT" ] && { [ -z "$REDIS_VOL" ] || [ "$REDIS_VOL" = "${REDIS_PROJECT}_redis_data" ]; } && [ -f "$ROOT/infrastructure/docker-compose.yml" ]; then
        docker compose -p "$REDIS_PROJECT" -f "$ROOT/infrastructure/docker-compose.yml" up -d redis
        for _ in $(seq 1 15); do
          if docker exec erp-redis redis-cli ping 2>/dev/null | grep -q PONG; then
            break
          fi
          sleep 1
        done
        DOCKER_REBOUND=1
        ok "أُعيد ربط erp-redis على 127.0.0.1:6379 مع الحفاظ على الحجم الدائم (${REDIS_VOL:-redis_data})"
      else
        warn "تعذّر التعرّف الآلي على مشروع Compose لحاوية erp-redis (project='$REDIS_PROJECT'، volume='$REDIS_VOL') — لم تُمسّ الحاوية"
      fi
    else
      ok "حاوية erp-redis مقصورة مسبقاً على 127.0.0.1:6379"
    fi
  fi
fi

# إذا أُعيد ربط حاويات القاعدة/Redis، نعيد تحميل erp-api وerp-worker لتجديد اتصالات المجمّع فوراً
if [ "$DOCKER_REBOUND" -eq 1 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  if su - "$SUDO_USER" -c 'command -v pm2 >/dev/null 2>&1'; then
    su - "$SUDO_USER" -c 'pm2 reload erp-api erp-worker >/dev/null 2>&1' || true
    for _ in $(seq 1 30); do
      if curl -fsS http://127.0.0.1:3000/health/ready >/dev/null 2>&1; then
        ok "تم تجديد اتصال erp-api وerp-worker بقاعدة البيانات وRedis بنجاح"
        break
      fi
      sleep 1
    done
  fi
fi

# ── 5) تحقّق نهائي من المنافذ المستمعة ───────────────────────────────────────
if command -v ss >/dev/null 2>&1; then
  exposed="$(ss -ltn 2>/dev/null | awk '$4 ~ /:(3000|3001|3002|3003|3004|3005|5432|6379)$/ && $4 !~ /^127\.0\.0\.1:/ && $4 !~ /^\[::1\]:/')"
  if [ -z "$exposed" ]; then
    ok "جميع المنافذ الداخلية (3000–3005، 5432، 6379) مستمعة على loopback فقط"
  else
    warn "لا تزال هناك منافذ مستمعة على غير loopback:"
    printf '%s\n' "$exposed"
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      docker ps --format '  • container={{.Names}} image={{.Image}} ports={{.Ports}}' | grep -E ':(5432|6379)->' || true
    fi
  fi
fi
