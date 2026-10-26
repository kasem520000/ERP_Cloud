# `deploy/vps` — ملفات النشر على خادم واحد

الدليل الكامل (تحضير الخادم، قاعدة البيانات، النسخ الاحتياطي، Cloudflare، الفحص، الترقية
والتراجع) في **[`docs/DEPLOYMENT_VPS_AR.md`](../../docs/DEPLOYMENT_VPS_AR.md)**. هذا الملف
خريطةٌ سريعة لما يُنسخ إلى أين.

| الملف | الوجهة على الخادم | الدور |
|---|---|---|
| `nginx-erpcloud.conf` | `/etc/nginx/sites-available/erpcloud` | سبعة مضيفين: كتلة `server` مستقلة لكل سطح، 80 → 301، `default_server` بـ444 |
| `erp-proxy.conf` | `/etc/nginx/snippets/erp-proxy.conf` | ترويسات الوكيل المشتركة (`Host`, `X-Forwarded-*`, WS, مهلات) |
| `ecosystem.config.cjs` | يبقى داخل المستودع | سبع عمليات PM2 (`env` + `env_production`): API، worker، وخمس واجهات — كلها على loopback |
| `sync-host.sh` | يبقى داخل المستودع (`sudo`) | مزامنة Nginx وعزل PostgreSQL (`5432`) وRedis (`6379`) على `127.0.0.1` بخطوة واحدة آمنة |
| `deploy.sh` | يبقى داخل المستودع | نشرٌ متدرّج: تثبيت ← فحص بيئة ← بناء ← هجرات ← API/worker ← جهوزية ← الواجهات الخمس |
| `smoke.sh` | يبقى داخل المستودع | 20 فحصاً بعد النشر: الصحة، الأسطح الخمسة، الوكيل، التوجيه، العزل، worker، السقف |

## التركيب

```bash
# 1) إعدادات المضيف الجذرية (Nginx + عزل PostgreSQL/Redis على loopback) — مرة واحدة أو عند تغيّرها
chmod +x deploy/vps/sync-host.sh deploy/vps/deploy.sh deploy/vps/smoke.sh
sudo ./deploy/vps/sync-host.sh

# 2) العمليات — عند كل نشر
./deploy/vps/deploy.sh
```

## قبل التشغيل

- الشهادة في `/etc/nginx/ssl/origin.crt|.key` (‏Cloudflare Origin CA) ووضع SSL في
  Cloudflare = **Full (strict)**.
- `real_ip` مضبوط من `CF-Connecting-IP` في `/etc/nginx/conf.d/cloudflare-ips.conf`؛
  بدونه كل الزوار في دلو IP واحد فيصير سقف الطلبات تقييداً جماعياً.
- `.env` بصلاحية `600`، و`TRUST_PROXY=loopback`، و`API_HOST`/`WEB_HOST` = `127.0.0.1`.
- المنافذ `3000–3005` و`5432` مغلقة في جدار الحماية: لا وصول إلا عبر Nginx.

## عقودٌ مقفلة بالاختبار

`apps/api/test/deployment-artifacts.spec.ts` يقرأ هذه الملفات ويسقط على: `$` ساقطة في
إعادة التوجيه، `server_name` مكرَّر، واجهةٌ تُوكّل إلى منفذ سطحٍ آخر، غياب `erp-worker`،
`PORT` في واجهة (كان يقلب وكيل `/api/v1` إلى الواجهة نفسها)، أو خدمةٌ تستمع على
`0.0.0.0`. لا تعدّل ملفاً هنا دون تشغيله:

```bash
pnpm --filter @erp/api exec vitest run test/deployment-artifacts.spec.ts
```

## بعد كل نشر

```bash
./deploy/vps/smoke.sh                     # 20 فحصاً — يفشل برمز غير صفري إن كان سطحٌ ساقطاً
./deploy/vps/smoke.sh --with-rate-limit   # + سقف تسجيل الدخول (يستهلك دلو عنوانك)
```
