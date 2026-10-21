# `deploy/vps` — ملفات النشر على خادم واحد

الدليل الكامل (تحضير الخادم، قاعدة البيانات، النسخ الاحتياطي، Cloudflare، الفحص، الترقية
والتراجع) في **[`docs/DEPLOYMENT_VPS_AR.md`](../../docs/DEPLOYMENT_VPS_AR.md)**. هذا الملف
خريطةٌ سريعة لما يُنسخ إلى أين.

| الملف | الوجهة على الخادم | الدور |
|---|---|---|
| `nginx-erpcloud.conf` | `/etc/nginx/sites-available/erpcloud` | سبعة مضيفين: كتلة `server` مستقلة لكل سطح، 80 → 301، `default_server` بـ444 |
| `erp-proxy.conf` | `/etc/nginx/snippets/erp-proxy.conf` | ترويسات الوكيل المشتركة (`Host`, `X-Forwarded-*`, WS, مهلات) |
| `ecosystem.config.cjs` | يبقى داخل المستودع | سبع عمليات PM2: API، worker، وخمس واجهات — كلها على loopback |
| `deploy.sh` | يبقى داخل المستودع | نشرٌ واحد: تثبيت ← فحص بيئة ← بناء ← هجرات ← `startOrReload` ← فحص صحة |

## التركيب

```bash
# 1) Nginx — مرة واحدة (ثم بعد كل تعديل على الملف)
sudo cp deploy/vps/erp-proxy.conf      /etc/nginx/snippets/erp-proxy.conf
sudo cp deploy/vps/nginx-erpcloud.conf /etc/nginx/sites-available/erpcloud
sudo ln -sfn /etc/nginx/sites-available/erpcloud /etc/nginx/sites-enabled/erpcloud
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 2) العمليات — عند كل نشر
chmod +x deploy/vps/deploy.sh
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
