# نشر Sahab Accounting على VPS واحد

**الهدف:** تشغيل سبعة مضيفين (واجهات خمس + API + الجذر) على خادمٍ واحد بصلاحيات
محدودة، قاعدة بيانات معزولة، ونسخ احتياطي مُختبَر — لا «يعمل عندي».

الملفات المرجعية في هذا المستودع، وهي القابلة للنسخ حرفياً:

| الملف | يُوضع في |
|---|---|
| `deploy/vps/nginx-erpcloud.conf` | `/etc/nginx/sites-available/erpcloud` |
| `deploy/vps/erp-proxy.conf` | `/etc/nginx/snippets/erp-proxy.conf` |
| `deploy/vps/ecosystem.config.cjs` | `~/ERP_Cloud/deploy/vps/` (داخل المستودع) |
| `deploy/vps/deploy.sh` | `~/ERP_Cloud/deploy/vps/` |
| `deploy/vps/smoke.sh` | `~/ERP_Cloud/deploy/vps/` |

خريطةُ نقلٍ سريعة (ماذا يُنسخ إلى أين) في [`deploy/vps/README.md`](../deploy/vps/README.md).

---

## 0. ما هو خطأ في إعدادك الحالي — قبل أي شيء

هذه ليست ملاحظاتِ تنسيق؛ كلُّ واحدةٍ منها تُعطّل شيئاً بعينه:

| # | في ملفك | الأثر | التصحيح |
|---|---|---|---|
| 1 | `return 301 https://hostrequest_uri;` (في الكتل السبع) | `$` سقطت من `$host` و`$request_uri` ⇒ التوجيه يقود إلى `https://hostrequest_uri` وهو مضيف غير موجود ⇒ **كل طلب http يفشل** | `return 301 https://$host$request_uri;` |
| 2 | كتلة `staff` تحمل `server_name sahabaccounting.com` | يتعارض مع كتلة التسويق التي تحمل الاسم نفسه؛ nginx يُحمّل أولهما ويُهمل الثاني بصمت ⇒ **أحد المضيفين لا يعمل** | `server_name staff.sahabaccounting.com;` |
| 3 | لا كتلة لـ`sahabaccounting.com`/`www` | الجذر بلا خدمة (أو يقع على أول كتلة) | إعادة توجيه إلى `marketing.` (مضمّنة في الملف المرجعي) |
| 4 | لا `real_ip` مع Cloudflare (سجلاتك «Proxied») | `$remote_addr` = حافة Cloudflare لا الزائر ⇒ سقف الطلبات يصبح دلوًا واحدًا للعالم (تقييد جماعي)، وسجلّ التدقيق يسجّل عناوين Cloudflare | `set_real_ip_from` لنطاقات Cloudflare + `real_ip_header CF-Connecting-IP` (‏§6) |
| 5 | `ecosystem.config.js` بلا عملية `erp-worker` | الـAPI يخدم HTTP فقط. البريد، الإشعارات، إعادة محاولات ZATCA، الحملات، والتقارير الأسبوعية تُستهلك في عملية `WORKER=1`. بلاها **تدخل الصفوف الطابور ولا تخرج**: «تم الإرسال» ولا بريد | إضافة `erp-worker` (‏`deploy/vps/ecosystem.config.cjs`) |
| 6 | `env: { PORT: 3001 }` لكل واجهة | `next.config.mjs` كان يبني هدف وكيل `/api/v1` من `PORT` ⇒ **كل واجهة توكّل إلى نفسها**، فيفشل كل نداء API بـ404 محلي | أُصلح في الكود: الهدف الآن `API_PROXY_TARGET` والافتراضي 3000. المنافذ عبر `STAFF_PORT`… كما في `scripts/next-run.mjs` |
| 7 | المنافذ `3000–3005` مفتوحة على `0.0.0.0` | أي أحد يتجاوز Nginx ويدخل مباشرة ⇒ ترويسات الأمان والعنوان الحقيقي وسقف IP بلا معنى | `API_HOST=127.0.0.1`، `WEB_HOST=127.0.0.1`، وجدار ناري يمنع 3000–3005 (‏§7) |
| 8 | لا `client_max_body_size` صريح | الافتراضي 1m ≈ سقف الـAPI، لكن رفع توقيعٍ أو استيراد قد يُقطع بـ413 من Nginx برسالة HTML لا يفهمها التطبيق | `client_max_body_size 2m;` (في الملف المرجعي) |

> **مهم:** البند 6 أُصلح في المستودع ضمن هذه الحزمة. لو نشرت نسخة قديمة، أضف
> `API_PROXY_TARGET=http://127.0.0.1:3000` إلى `.env` **قبل البناء** (‏§5).

---

## 1. تحضير الخادم (Ubuntu 24.04 LTS)

```bash
# ── مستخدم تشغيل بلا جذر ────────────────────────────────────────────────
adduser --disabled-password --gecos "" erp
usermod -aG sudo erp
rsync -a ~/.ssh/ /home/erp/.ssh/ && chown -R erp:erp /home/erp/.ssh
# من الآن: ssh erp@79.72.9.26

sudo timedatectl set-timezone Asia/Riyadh

# ── تحديثات أمنية تلقائية ───────────────────────────────────────────────
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# ── أدوات ───────────────────────────────────────────────────────────────
sudo apt -y install curl git build-essential nginx fail2ban ufw \
                    postgresql-client-16 jq unzip rclone

# ── Node 22 LTS + pnpm 9.15 (الإصدار المثبّت في packageManager) ─────────
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
sudo corepack enable
corepack prepare pnpm@9.15.0 --activate
node -v && pnpm -v

# ── PM2 ─────────────────────────────────────────────────────────────────
sudo npm i -g pm2
```

**مفتاحا JWT.** الـAPI يوقّع RS256 بمفتاح خاص ويتحقق بالعام:

```bash
mkdir -p ~/secrets && chmod 700 ~/secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out ~/secrets/jwt-private.pem
openssl rsa -in ~/secrets/jwt-private.pem -pubout -out ~/secrets/jwt-public.pem
chmod 600 ~/secrets/jwt-private.pem
```

ثم في `.env` (سطر واحد لكل مفتاح، بترميز `\n` أو كما يقبل المحمّل):

```dotenv
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"
```

---

## 2. خريطة العمليات والمنافذ

| العملية | المنفذ | الواجهة | المضيف |
|---|---|---|---|
| `erp-api` | 3000 | `127.0.0.1` | `api.sahabaccounting.com` |
| `erp-worker` | — | بلا HTTP | — (طابور فقط) |
| `erp-staff` | 3001 | `127.0.0.1` | `staff.sahabaccounting.com` |
| `erp-marketing` | 3002 | `127.0.0.1` | `marketing.sahabaccounting.com` + الجذر |
| `erp-platform-admin` | 3003 | `127.0.0.1` | `admin.sahabaccounting.com` |
| `erp-customer-portal` | 3004 | `127.0.0.1` | `portal.sahabaccounting.com` |
| `erp-bakery` | 3005 | `127.0.0.1` | `bakery.sahabaccounting.com` |
| Nginx | 80/443 | `0.0.0.0` | كل المضيفات |
| PostgreSQL | 5432 | `127.0.0.1` | — |

**عزل المسارات** على ثلاث طبقات، وكل طبقة تُغلق ثغرةً لا تُغلقها الأخرى:

1. **مضيف ← تطبيق واحد.** كل `server` في Nginx يخدم منفذاً واحداً؛ لا `location`
   يُوصل إلى تطبيقين. عطلُ المخابز لا يُسقط الموظفين، وسجلٌّ لكل سطح.
2. **same-origin داخل كل سطح.** المتصفّح يكلّم `staff.sahabaccounting.com/api/v1/*`
   فقط، وNext.js يُمرّرها داخلياً إلى `127.0.0.1:3000`. لا CORS، ولا توكن يعبر
   مضيفاً آخر، ولا `api.` مكشوفاً لحاجة الواجهة.
3. **الـAPI لا يُرى من الخارج.** `API_HOST=127.0.0.1` + `ufw deny 3000:3005`. حتى لو
   سُرّبت ترويسة، لا يوجد منفذ يسمع لها.

---

## 3. قاعدة البيانات — القرار والتنفيذ

### 3.1 أيّهما: مُدارة أم محلية؟

| | مُدارة (Neon / RDS / Supabase) | محلية على نفس VPS |
|---|---|---|
| النسخ الاحتياطي و PITR | جاهزة (نافذة استعادة دقائق) | مسؤوليتك: `pgBackRest` + تخزين خارجي |
| الفصل عن نقطة الفشل | نعم (عطل الخادم لا يمسّ البيانات) | لا: تلف القرص يفقد الاثنين |
| الكمون | 1–5ms داخل نفس المنطقة | ~0.1ms |
| الكلفة | ~$20–40/شهر لنسخة صغيرة | مجاناً |
| النسخ الاحتياطي المُدار | لا تحتاجه | **إلزامي، ومُختبَر** |

**التوصية العملية لمشروعك:** ابدأ **محلياً** للفترة الأولى (الأداء والكلفة)، بشرط
تنفيذ §3.4 حرفياً من اليوم الأول — ومتى تجاوز عدد المنشآت ما يتحمّله خادمٌ واحد،
انتقل إلى مُدارة عبر `pg_dump | pg_restore` مع ساعة توقّف معلنة. الخطوة نفسها لاحقاً
أصعب بكثير لو أهملت النسخ الاحتياطي.

> **لا** تُشغّل PostgreSQL في Docker على نفس الخادم مع `volume` محلي ثم تظنّ أنك
> محمي: هذا يعطي عزل إصدار فحسب، لا عزل فشل.

### 3.2 إعداد الخادم

```bash
sudo apt -y install postgresql-16 postgresql-contrib-16
sudo sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" \
  /etc/postgresql/16/main/postgresql.conf
sudo systemctl restart postgresql
```

`listen_addresses = 'localhost'` يعني أن القاعدة **غير موجودة** على الشبكة العامة —
حتى لو أخطأ جدارٌ ناري، لا مقبس يسمع.

### 3.3 الأدوار: مالك النظام، المهاجر، والتطبيق

المستودع يعرّف دورين للتطبيق في `0000_platform_identity.sql`، والثالث مالكُ القاعدة:

| الدور | يستخدمه | الصلاحيات |
|---|---|---|
| `erp_dba` | الهجرات و`pnpm db:roles` فقط | `SUPERUSER` (لازمة، انظر أدناه) |
| `erp_migrator` | سكربتات الصيانة والقياس | `LOGIN BYPASSRLS` |
| `erp_api` | الـAPI والـworker | `LOGIN NOBYPASSRLS` ⇒ **RLS مُفعَّل عليه** |

> **لماذا superuser للهجرات؟** الملف `0000_platform_identity.sql` ينتهي بـ
> `ALTER ROLE erp_api NOBYPASSRLS`، وهذا السطر — وكذلك `CREATE ROLE … BYPASSRLS` —
> لا يقبله PostgreSQL إلا من `SUPERUSER`. لذلك الهجرات تعمل بـ`erp_dba`، والتطبيق
> يعمل بـ`erp_api` المحدود. الفصل بينهما هو ما يجعل «صفٌّ من مستأجر آخر» غير مرئي
> للتطبيق أصلاً، لا مجرد مُرشَّح في الكود.

```bash
# ١) دور النشر (superuser) — كلمة سرّ قوية، ومستخدمة عبر loopback فقط
sudo -u postgres psql <<'SQL'
CREATE ROLE erp_dba LOGIN SUPERUSER PASSWORD 'ضع-كلمة-سر-قوية-هنا';
SQL

# ٢) القاعدة
sudo -u postgres createdb -O postgres app

# ٣) الهجرات (تُنشئ erp_api و erp_migrator بحالة NOLOGIN)
cd ~/ERP_Cloud
# .env: DATABASE_MIGRATOR_URL=postgres://erp_dba:…@127.0.0.1:5432/app
pnpm run db:migrate

# ٤) منح LOGIN وكلمات السر — نفس اتصال erp_dba
pnpm run db:roles      # يقرأ DATABASE_APP_PASSWORD و DATABASE_MIGRATOR_PASSWORD

# ٥) البيانات الأولية — مرة واحدة فقط
pnpm run db:seed
```

`pg_hba.conf` الافتراضي في Ubuntu يسمح بـ`scram-sha-256` من `127.0.0.1` لكل
الأدوار؛ لا تفتح سطراً لـ`0.0.0.0/0`. ولأن `erp_dba` هو الوحيد ذو الصلاحية العليا
ومستخدمٌ في `.env` (صلاحية `600`)، اجعل كلمته مختلفة عن أي كلمة أخرى، ولا تستخدمها
في أي أداة إدارة عن بُعد.

**.env في الإنتاج:**

```dotenv
NODE_ENV=production

# التطبيق: دور محدود ⇒ RLS فعّال. لا تضع erp_dba هنا.
DATABASE_URL=postgres://erp_api:…@127.0.0.1:5432/app
# الهجرات والنشر: erp_dba (superuser، loopback فقط)
DATABASE_MIGRATOR_URL=postgres://erp_dba:…@127.0.0.1:5432/app

# ميزانية الاتصالات: 10 لكل عملية × (API + worker) = 20، والقاعدة تسمح 100.
DATABASE_POOL_MAX=10

REDIS_URL=redis://127.0.0.1:6379
```

### 3.4 النسخ الاحتياطي — الشرط الذي لا يُتنازل عنه

```bash
sudo apt -y install pgbackrest
# /etc/pgbackrest/pgbackrest.conf → [global] repo1-path=/var/lib/pgbackrest
#                                     [app] pg1-path=/var/lib/postgresql/16/main

# أرشفة WAL: بدون هذين السطرين تبقى «الاستعادة إلى أي ثانية» وعداً بلا تنفيذ.
sudo sed -i "s/^#\?archive_mode.*/archive_mode = on/; s|^#\?archive_command.*|archive_command = 'pgbackrest --stanza=app archive-push %p'|" \
  /etc/postgresql/16/main/postgresql.conf
sudo systemctl restart postgresql

sudo -u postgres pgbackrest --stanza=app stanza-create
sudo -u postgres pgbackrest --stanza=app check
# نسخة كاملة أسبوعية + WAL مستمر ⇒ استعادة إلى أي ثانية داخل النافذة
sudo -u postgres pgbackrest --stanza=app --type=full backup
```

**ثم اسحب النسخة خارج الخادم** — نسخةٌ على القرص نفسه ليست نسخة:

```bash
# إعداد الوجهة البعيدة مرة واحدة: `rclone config` ثم اختبارها بـ`rclone lsd remote:`
# يومياً 02:30 — dump مضغوط إلى تخزين خارجي (S3 / Backblaze / أي وجهة بعيدة)
30 2 * * * cd /home/erp/ERP_Cloud && pnpm run db:backup && \
  rclone copy backups/ remote:erp-backups/$(date +\%F)/ --include "*.gz"
```

التمرين هو الدليل، لا الملف:

```bash
pnpm run db:verify    # فحص الأرشيف وسلامته
pnpm run db:drill     # استعادة في قاعدة مؤقتة + عدّ الجداول والصفوف
```

> جرّب التمرين **الآن**، قبل أن يكون عندك مستأجرٌ واحد. الاستعادة التي لم تُجرَّب
> ليست نسخة احتياطية، بل أمل.

### 3.5 الصيانة والمراقبة

```sql
-- شهرياً: تحليل بعد التحميلات الكبيرة
ANALYZE;

-- راقب الاستعلامات البطيئة
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

- `autovacuum` مفتوح افتراضياً — لا تُغلقه.
- `log_min_duration_statement = 500ms` مؤقتاً لاصطياد ما يبطؤ.
- **ميزانية الاتصالات:** `DATABASE_POOL_MAX` × عدد العمليات ≤ 80% من `max_connections`.
  عند تجاوز ذلك: `PgBouncer` في وضع `transaction` على 6432، وتُوجَّه `DATABASE_URL` إليه.

---

## 4. الأسرار والبيئة

```bash
cd ~/ERP_Cloud
pnpm run env:setup   # ينشئ .env بوضع 0600 ويولّد المفاتيح وكلمات المرور وعناوين sahabaccounting.com
pnpm run env:check   # يتحقق من اكتمال الإعداد دون طباعة أي سر
```

**عناوين الأسطح العامة المُولَّدة تلقائياً في `.env`:**

```dotenv
PUBLIC_APP_URL=https://sahabaccounting.com
NEXT_PUBLIC_STAFF_URL=https://staff.sahabaccounting.com
NEXT_PUBLIC_PORTAL_URL=https://portal.sahabaccounting.com
NEXT_PUBLIC_PLATFORM_URL=https://admin.sahabaccounting.com
NEXT_PUBLIC_MARKETING_URL=https://sahabaccounting.com
NEXT_PUBLIC_BAKERY_URL=https://bakery.sahabaccounting.com
NEXT_PUBLIC_SUPPORT_EMAIL=support@sahabaccounting.com
```

> للتطوير المحلي على منافذ `localhost` فقط يمكن تمرير `pnpm run env:setup -- --force --local`.

**قيم الإنتاج التي تُغيّر السلوك** (كلها موثّقة في `.env.example`):

```dotenv
NODE_ENV=production
API_HOST=127.0.0.1
API_PROXY_TARGET=http://127.0.0.1:3000
WEB_HOST=127.0.0.1
# الوكيل الوحيد الموثوق هو Nginx على loopback. لا تستخدم `true` هنا أبداً:
# يثق بكل X-Forwarded-For، فيتجاوز المهاجم سقف IP بعناوين وهمية.
TRUST_PROXY=loopback
CORS_ALLOWED_ORIGINS=https://sahabaccounting.com,https://staff.sahabaccounting.com,https://portal.sahabaccounting.com,https://admin.sahabaccounting.com,https://bakery.sahabaccounting.com
OPENAPI_ENABLED=false
SIGNUP_ENABLED=true           # تفعيل التسجيل الذاتي للمشتركين الجدد من الموقع التسويقي
PASSWORD_BREACH_CHECK=enforce
MAIL_TRANSPORT=smtp           # console يطبع الرسائل في السجل فقط
REDIS_URL=redis://127.0.0.1:6379
```

**Redis** يلزم لأمرين هنا: طابور المهام، و**عدّاد الطلبات المشترك** (`RATE_LIMIT_STORE=auto`).
على VPS واحد يمكن الاستغناء عن المشاركة بـ`RATE_LIMIT_STORE=memory`، لكن مع Redis
يستمرّ العدّاد عبر إعادة تشغيل الـAPI، ويظهر في مجسّ الصحة «مشترك عبر Redis».

```bash
sudo apt -y install redis-server
sudo sed -i 's/^bind .*/bind 127.0.0.1 ::1/; s/^# \?requirepass.*/requirepass '"$(openssl rand -base64 32)"'/' \
  /etc/redis/redis.conf
sudo systemctl restart redis-server
# ثم REDIS_URL=redis://:السر@127.0.0.1:6379
```

---

## 5. البناء والنشر

البناء يحتاج متغيّرات الوكيل **وقت البناء**، لأن `rewrites()` تُخزَّن في
`.next/routes-manifest.json`:

```bash
cd ~/ERP_Cloud
git pull --ff-only
pnpm install --frozen-lockfile
API_PROXY_TARGET=http://127.0.0.1:3000 NODE_ENV=production pnpm run build
pnpm run db:migrate
mkdir -p logs
pm2 start deploy/vps/ecosystem.config.cjs --env production
pm2 save && pm2 startup systemd -u erp --hp /home/erp
```

أو بخطوةٍ واحدة (تثبيت ← فحص بيئة ← بناء ← هجرات ← إعادة تشغيل ← فحص صحة):

```bash
./deploy/vps/deploy.sh
```

> **ملاحظة `next start`:** الواجهات تُبنى بـ`output: 'standalone'`، فيطبع `next start`
> تحذيراً بأنه «لا يعمل» مع هذا الوضع. تحقّقنا عملياً على هذه النسخة: الصفحة الجذر تُخدم
> `200` بمحتوى عربي كامل، و`/_next/static/*.js` تُخدم `200 application/javascript`،
> وإعادة كتابة `/api/health/*` تعمل. فإن ظهر التحذير في السجل فليس عطلاً. المسار المدعوم
> تماماً بديلاً هو `node .next/standalone/apps/<app>/server.js` بعد نسخ `.next/static`
> و`public` داخل مجلد `standalone`؛ ولا حاجة إليه ما دام الفحص أعلاه يمرّ.

> **لا تُشغّل الـAPI قبل الهجرات.** الـAPI يهاجر تلقائياً عند الإقلاع، لكن في نشرٍ
> مضبوط تكون الهجرة خطوةً صريحة أولاً؛ وبهذا يبقى زمن «كود جديد + قاعدة قديمة» صفراً.

---

## 6. Nginx + Cloudflare

### 6.1 الشهادة

سجلاتك «Proxied»، فالخادم لا يحتاج Let's Encrypt. استخدم **Cloudflare Origin CA**:

> Cloudflare → SSL/TLS → Origin Server → Create Certificate → المضيفان
> `*.sahabaccounting.com` و`sahabaccounting.com` → صلاحية 15 سنة.
> ضع `origin.crt` و`origin.key` في `/etc/nginx/ssl/` بصلاحية `600` للمفتاح،
> ثم **SSL/TLS mode = Full (strict)**.

(البديل: Let's Encrypt بشهادة DNS-01 عبر API — يحتاج إعداداً ويُجدَّد كل 90 يوماً.)

### 6.2 التركيب

```bash
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/vps/erp-proxy.conf        /etc/nginx/snippets/erp-proxy.conf
sudo cp deploy/vps/nginx-erpcloud.conf   /etc/nginx/sites-available/erpcloud
sudo ln -sfn /etc/nginx/sites-available/erpcloud /etc/nginx/sites-enabled/erpcloud
sudo rm -f /etc/nginx/sites-enabled/default

# نطاقات Cloudflare (لأن السجلات بروكسي) — الكتلة جاهزة في رأس الملف المرجعي
sudo tee /etc/nginx/conf.d/cloudflare-ips.conf >/dev/null <<'EOF'
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;
EOF

sudo nginx -t && sudo systemctl reload nginx
```

**لماذا `real_ip` إلزامي هنا:** بدونه كل الطلبات تأتي من عناوين Cloudflare، فتصير
`RATE_LIMIT_LOGIN_PER_MINUTE=10` دلوًا واحدًا للعالم كلّه (أول عشرة تسجيلات دخول
تُقفل الباب على الجميع)، ويسجّل التدقيق عنوان Cloudflare بدل المهاجم.

### 6.3 إعدادات Cloudflare الموصى بها

| الإعداد | القيمة | السبب |
|---|---|---|
| SSL/TLS mode | **Full (strict)** | يمنع «Flexible» الذي يُنشئ حلقة إعادة توجيه ويُضعف النقل |
| Always Use HTTPS | On | الطبقة الأولى من التحويل |
| Minimum TLS | 1.2 | إسقاط البروتوكولات القديمة |
| HSTS | On (max-age 6 أشهر للبداية) | لا رجعة عنه بعد التفعيل على نطاقٍ حقيقي |
| Bot Fight Mode | On | يقلّل الزحف والتخمين |
| WAF rate limit | `/api/v1/auth/login` 20/دقيقة لكل IP | طبقة حدٍّ ثانية قبل أن يصل الطلب لخادمك |
| Proxy status | Proxied | يخفي `79.72.9.26` |

---

## 7. العزل: الجدار الناري ومنع تجاوز الوكيل

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# لا 3000–3005 ولا 5432: كلها loopback. هذا هو الفرق بين «محمي» و«يعمل».
sudo ufw --force enable
sudo ufw status numbered
```

**إضافتان تمنعان الوصول المباشر إلى العنوان الأصلي (‏`79.72.9.26`) متجاوزاً Cloudflare:**

1. **Authenticated Origin Pulls** (Cloudflare → SSL/TLS → Origin Server): يُثبت أن
   الطلب جاء من Cloudflare فعلاً. اتبع خطوات Cloudflare لتحميل
   `origin-pull-ca.pem` وإضافة `ssl_client_certificate`/`ssl_verify_client on;`.
2. **سماح النطاقات فقط** — بديل أبسط إن لم تُرد 1:
   ```bash
   # اسمح فقط لنطاقات Cloudflare بالوصول إلى 443 (قائمة `cf_ips` من cloudflare.com/ips)
   for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
     sudo ufw allow from "$ip" to any port 443 proto tcp
   done
   sudo ufw delete allow 443/tcp
   ```
   وتذكّر أن تفتح **80** لعنوانك أنت إن كنت تستخدم تحقق HTTP-01 لشهادةٍ أخرى.

**fail2ban** لسجلّات Nginx:

```bash
sudo tee /etc/fail2ban/jail.d/erp.conf >/dev/null <<'EOF'
[sshd]
enabled = true
maxretry = 4
bantime  = 1h

[nginx-limit-req]
enabled  = true
filter   = nginx-limit-req
logpath  = /var/log/nginx/error.log
maxretry = 20
bantime  = 1h
EOF
sudo systemctl enable --now fail2ban
```

---

## 8. الفحص بعد النشر

الفحوص ليست قائمةً تُقرأ، بل سكربتٌ يفشل. `deploy/vps/smoke.sh` يُشغَّل على الخادم بعد كل
نشرة، ويقارن كل ردٍّ برقمٍ متوقّع (‏`curl` بلا مقارنة يعتبر 502 نجاحاً):

```bash
./deploy/vps/smoke.sh                     # 20 فحصاً، قراءة فقط
./deploy/vps/smoke.sh --with-rate-limit   # + فحص سقف الدخول (يستهلك دلو عنوانك)
SMOKE_RESOLVE_IP=79.72.9.26 ./deploy/vps/smoke.sh   # الأًصل مباشرة قبل تحويل DNS
SMOKE_AFTER_DEPLOY=1 ./deploy/vps/deploy.sh         # الفحص يُشغَّل تلقائياً بعد النشر
```

ماذا يُثبت:

| # | الفحص | الفشل يعني |
|---|---|---|
| 01 | `/health/live` و`/health/ready` | الـAPI ساقط أو لا يرى القاعدة |
| 02 | الجذر `200` لكل سطح من الخمسة | سطحٌ لم يُبنَ أو منفذه لا يسمع |
| 03 | `/api/health/live` **من داخل كل سطح** | وكيل Next يُشير إلى منفذٍ خاطئ (العطل الصامت: كل نداءات API تفشل) |
| 04 | التوجيه: لا حلقة، والجذر ⇒ التسويق | `$` ساقطة أو `server_name` مكرَّر |
| 05 | `/metrics` 403 و`/api/docs` 404 ومحميٌّ 401 | سطحٌ تشغيلي مكشوف أو حرّاس معطّلة |
| 06 | `ss -ltn`: لا استماع على 0.0.0.0 لـ3000–3005/5432/6379 | النشر يتجاوز Nginx |
| 07 | `erp-worker` في حالة `online` | الطابور بلا مستهلك: «تم الإرسال» ولا بريد |
| 08 | `429` + `Retry-After` (اختياري) | السقف معطّل أو `real_ip` ناقص |

الفحص اليدوي، إن أردت النظر بعينك:

```bash
curl -s https://api.sahabaccounting.com/health/ready | jq
ss -ltnp | grep -E ':(3000|3001|3002|3003|3004|3005|5432)\b'   # كلها 127.0.0.1
pm2 list
```

> إن ظهر `429` قبل المحاولة العاشرة على فحص السقف فغالباً `real_ip` ناقص (كل الزوار في
> دلو واحد)، أو أن Cloudflare WAF يحدّ منك أولاً.

## 9. الترقية والتراجع

```bash
# ترقية
cd ~/ERP_Cloud && git pull --ff-only && ./deploy/vps/deploy.sh

# تراجع عن هجرة (خطوة واحدة)
pnpm run db:migrate:down

# التراجع عن نشر: أعد الوسم السابق ثم أعد البناء والتشغيل
git checkout <commit-السابق> && ./deploy/vps/deploy.sh
```

نظام الهجرات يرفض ملفاً تغيّر بعد تطبيقه (checksum)، ولا يعيد تطبيق ما نجح. لذلك:

- **قبل كل نشر:** `pnpm run db:backup` (لقطة على القرص)، ثم نسخة خارجية في نهاية اليوم.
- **هجراتٌ لا رجعة فيها** (حذف عمود/جدول): انشرها في خطوتين — إهمال الاستخدام، ثم
  الحذف في الإصدار التالي. التراجع عن هجرةٍ أسقطت بياناتٍ لا يُعيدها `down`.

---

## 9.5 تطبيقا الأندرويد (المندوبون وإدارة المخابز)

التطبيقان سطحان فوق الـAPI نفسه: لا قاعدة محلية للحقيقة، ولا حساب ضريبةٍ على الجهاز.
وما يخصّ النشر فيهما أربعة أشياء:

**١) عنوان الـAPI.** التطبيق الأصلي لا يمرّ عبر Next.js، فلا وكيل ولا CORS (‏CORS سياسة
متصفّح). يُبنى التطبيق على:

```
API_BASE = https://api.sahabaccounting.com
```

ويُثبَّت في `BuildConfig`/`resValue` وقت البناء، لا في إعداداتٍ داخل التطبيق — وإلا صار
كل مندوبٍ قادراً على توجيه جهازه إلى خادمٍ آخر. `CORS_ALLOWED_ORIGINS` في `.env` لا
يخصّه؛ اتركه لمضيفي الويب فقط.

**٢) السقف صار لكل عميل لا لكل عنوان.** شبكات الجوّال تضع مئات المشتركين خلف عنوانٍ
واحد (‏CGNAT)، وبدلوٍ للعنوان كان الصباح يُقفل الدخول على شريحةٍ كاملة. الآن:

| الحالة | الدلو | السقف | متغيّر البيئة |
|---|---|---|---|
| تسجيل الدخول | (العنوان + الحساب) | 10/دقيقة للحساب | `RATE_LIMIT_LOGIN_PER_MINUTE` |
| تسجيل الدخول | العنوان (خشن) | 120/دقيقة | `RATE_LIMIT_LOGIN_IP_PER_MINUTE` |
| طلبٌ مصادَق | بصمة رمز الوصول | 600/دقيقة | `RATE_LIMIT_DEFAULT_PER_MINUTE` |
| طلبٌ مصادَق | العنوان (خشن) | 6000/دقيقة | `RATE_LIMIT_IP_CEILING_PER_MINUTE` |
| مجهول | العنوان | 600/دقيقة | `RATE_LIMIT_DEFAULT_PER_MINUTE` |

والمنشأة كلها 3000/دقيقة (`RATE_LIMIT_TENANT_PER_MINUTE`). فإن ظهر 429 على مندوبين
كثيرين في وقتٍ واحد فالمشكلة في السقف الخشن أو في `real_ip` الناقص، لا في التطبيق.

**٣) الطابور دون اتصال لا يُكرّر مستنداً.** كل كتابةٍ من التطبيقين تمرّ بـ
`Idempotency-Key` (مفتاحٌ ثابت للمحاولة نفسها، يُولَّد على الجهاز ويُحفظ مع العملية في
‏Room). إعادة الإرسال بعد انقطاعٍ تُرجع **النتيجة المخزَّنة** لا مستنداً ثانياً. والقاعدة:
المفتاح يُولَّد **قبل** الإرسال ويُحفظ مع الصف؛ مفتاحٌ جديد عند كل إعادة محاولة يعني
فواتيرَ مكرّرة لا يمكن تمييزها بعدها.

**٤) سحب جهازٍ مفقود.** التطبيقان يستخدمان `POST /auth/login` ثم `refresh` دوّاراً؛
وسحب الجهاز = `POST /auth/logout` بـ`refreshToken` (يُبطِل العائلة كلها)، أو
`POST /devices/:id/revoke` لسجلّ الأجهزة في المنشأة. ولا تعتمد على «مسح التطبيق من
الهاتف»: الرمز يبقى صالحاً على الخادم حتى يُبطَل.

**تثبيت الشهادة (‏pinning) — لا تفعله مع Cloudflare.** المتصفّح/التطبيق يرى شهادة حافة
Cloudflare لا `origin.crt`، وCloudflare يبدّلها دون إشعار (وقد يبدّل الجهة المُصدِرة).
تثبيت الشهادة هنا يعني تعطيل التطبيقين يوم التبديل. إن لزم التثبيت، ثبّت **المفتاح
العام** مع خطة تدوير، أو اكتفِ بـTLS العادي + ربط الجهاز بالمنشأة.

## 10. المراقبة

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 monit
```

- **`/metrics`** يقدّم Prometheus من الـAPI، وهو محجوبٌ في Nginx إلا من loopback.
  اجمعها بـ`node_exporter`/`prometheus` على الخادم نفسه، أو من VPS مراقبة عبر SSH tunnel.
- **مجسّات الصحة** (`GET /api/v1/platform/health/detailed`) تعرض قاعدة البيانات،
  Redis، الطابور، فحص كلمات المرور المسرّبة، وعدّاد الطلبات (مشترك/محلي).
- **تنبيهاتٌ بأربع حدود كافية للبداية:** `5xx` > 1% خلال 5 دقائق، طابور `dead` > 0،
  مساحة القرص > 80%، وفشل `/health/ready`.
- **سجلات PM2**: `~/.pm2/logs` أو `~/ERP_Cloud/logs`؛ سجّل `X-Request-Id` يربط
  رسالة الخطأ بالطلب في متصفّح المستخدم.

---

## 11. قائمة تحقق نهائية

- [ ] `pnpm run env:check` بلا نقص، و`.env` بصلاحية `600`.
- [ ] الأسرار المولَّدة **ليست** قيم `.env.example`.
- [ ] `DATABASE_URL` بدور `erp_api` (‏`NOBYPASSRLS`) و`DATABASE_MIGRATOR_URL` بدور `erp_dba`.
- [ ] `TRUST_PROXY=loopback` و`real_ip` مضبوط — والسقف يعمل لكل زائر على حدة.
- [ ] `ufw` يمنع 3000–3005 و5432 من الخارج، و`ss -ltn` يُظهرها على `127.0.0.1`.
- [ ] الشهادة Cloudflare Origin، ووضع SSL ‏`Full (strict)`.
- [ ] `erp-worker` يعمل (`pm2 list`) وصفوف الطابور تنزل (`SELECT status, count(*) FROM outbox_jobs GROUP BY 1`).
- [ ] نسخة احتياطية يومية تسحب خارج الخادم، و`pnpm run db:drill` نجح **بعد** النشر.
- [ ] `pm2 save` + `pm2 startup` ⇒ العمليات تعود بعد إعادة تشغيل الخادم.
- [ ] `unattended-upgrades` و`fail2ban` فعّالان.
- [ ] فحوص §8 السبعة تمرّ، وتُعاد بعد كل نشر.

---

## 12. عند العطل — أين تنظر أولاً

| العَرَض | أول فحص | السبب الشائع |
|---|---|---|
| 502 من Nginx | `pm2 list` | العملية ساقطة أو على منفذ آخر |
| 502 لواجهة واحدة فقط | `pm2 logs erp-staff` | بناء ناقص (`.next` غير موجود) |
| كل النداءات 404 داخل الواجهة | `cat .next/routes-manifest.json \| grep api` | بُني بـ`API_PROXY_TARGET` خاطئ ⇒ بناء جديد |
| «تم الإرسال» ولا بريد | `pm2 list` ثم `outbox_jobs` | `erp-worker` غير مشغّل |
| الجميع 429 معاً | `real_ip` + `TRUST_PROXY` | كل الزوار في دلو IP واحد |
| `ECONNREFUSED 127.0.0.1:5432` | `systemctl status postgresql` | القاعدة ساقطة أو `max_connections` ممتلئ |
| «Relation does not exist» | `pnpm db:migrate` | الهجرة لم تُطبَّق |
| صفحات تُعاد توجيهها إلى `https://hostrequest_uri` | `nginx -T \| grep hostrequest` | نسخة قديمة من الملف: `$` ساقطة |
| «النشر نجح» لكن سطحٌ لا يفتح | `./deploy/vps/smoke.sh` | أحد فحوص 01–05 أحمر: لا تُعلن النجاح قبله |
