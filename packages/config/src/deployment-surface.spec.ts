import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

/**
 * 🚢 سطحُ النشر — كلّ واجهةٍ في المستودع يجب أن تكون منشورةً من طرفٍ إلى طرف، أو يُقال صراحةً
 * إنّها لا تُنشر.
 *
 * لماذا هذا السبيك هنا: `@erp/config` هو الحزمة التي تعرف «ما الذي يجب أن توفّره البيئة
 * للنشر» (مخطّط المتغيّرات، ورسائل أخطائه تشير إلى `docker-compose`)، فثبتُ سطح النشر بجانبه
 * أولى من تركه في ذاكرة من يُضيف تطبيقاً. والسبب العمليّ أنّ الفجوات وقعت فعلاً ولم يكشفها شيء:
 * ‏`customer-portal` أُضيف إلى المستودع ولم يُعلن في `deploy/k8s` (مسجّلةٌ فجوةً في تقرير
 * المرحلة 2)، و`bakery` أُعلن Deployment/Service في `web.yaml` **بلا مدخلٍ في `images:`** في
 * ‏`kustomization.yaml` — أي أنّ `kubectl apply -k deploy/k8s` كان سينشر قلنسوةً صورتها
 * ‏`erp-bakery:latest` ولا معيدَ تسميةٍ لها إلى GHCR (‏`ImagePullBackOff`)، وبلا نسخةٍ ثانية في
 * ‏`replicas:`. ولا Docker في بيئة التحقّق، فالتحقّق بنيويّ: قراءةُ الملفات ومطابقةُ الأسماء
 * والمنافذ بينها، لا ادّعاءُ نشرٍ لم يحدث.
 *
 * مصدرُ الحقيقة لسطح الويب `scripts/next-run.mjs` (‏`APP_META`): فهو الذي يقلع الواجهات محلياً
 * ويحمل منفذ كلّ واحدة، فأيّ واجهةٍ تُضاف هناك تُقاس هنا فوراً.
 */

const repoRoot = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, repoRoot), 'utf8');

type Container = {
  name?: string;
  image?: string;
  ports?: Array<{ containerPort?: number; name?: string }>;
  env?: Array<{ name?: string; value?: string }>;
  readinessProbe?: unknown;
  livenessProbe?: unknown;
  resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
};

type PodSpec = {
  securityContext?: { runAsNonRoot?: boolean; runAsUser?: number };
  containers?: Container[];
};

type Manifest = {
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: {
    selector?: { matchLabels?: Record<string, string> } | Record<string, string>;
    replicas?: number;
    template?: { metadata?: { labels?: Record<string, string> }; spec?: PodSpec };
    jobTemplate?: { spec?: { template?: { spec?: PodSpec } } };
    ports?: Array<{ port?: number; targetPort?: number | string; name?: string }>;
    tls?: Array<{ hosts?: string[]; secretName?: string }>;
    rules?: Array<{
      host?: string;
      http?: {
        paths?: Array<{ path?: string; backend?: { service?: { name?: string; port?: { number?: number } } } }>;
      };
    }>;
  };
  data?: Record<string, string>;
};

type Kustomization = {
  resources?: string[];
  images?: Array<{ name?: string; newName?: string; newTag?: string }>;
  replicas?: Array<{ name?: string; count?: number }>;
};

type ComposeService = {
  image?: string;
  build?: { context?: string; dockerfile?: string; args?: Record<string, string> };
  environment?: Record<string, string>;
  ports?: string[];
};

/** كلّ كائنات `deploy/k8s/*.yaml` — والقراءة بالمجلّد لا بقائمةٍ مكتوبة، فملفٌّ جديد يُقاس فوراً. */
function k8sManifests(): Array<{ file: string; manifest: Manifest }> {
  const files = readdirSync(new URL('deploy/k8s/', repoRoot)).filter((name) => name.endsWith('.yaml'));
  const out: Array<{ file: string; manifest: Manifest }> = [];
  for (const file of files) {
    for (const doc of parseAllDocuments(read(`deploy/k8s/${file}`), { merge: true })) {
      const value = doc.toJS() as Manifest | null;
      if (value && typeof value === 'object' && value.kind) out.push({ file, manifest: value });
    }
  }
  return out;
}

const kustomization = (): Kustomization =>
  parseAllDocuments(read('deploy/k8s/kustomization.yaml'), { merge: true })[0]?.toJS() as Kustomization;

const compose = (): Record<string, ComposeService> => {
  const parsed = parseAllDocuments(read('deploy/docker-compose.yml'), { merge: true })[0]?.toJS() as {
    services?: Record<string, ComposeService>;
  };
  return parsed?.services ?? {};
};

/** واجهات Next كما يعلنها المُقلِع المحلّي: الاسم، ومتغيّر المنفذ، والمنفذ الافتراضي. */
function webSurfaces(): Array<{ app: string; portEnv: string; port: number }> {
  const source = read('scripts/next-run.mjs');
  const pattern = /^\s*'?([a-z][a-z0-9-]*)'?:\s*\{\s*portEnv:\s*'([A-Z_]+)',\s*defaultPort:\s*'(\d+)'\s*\}/gm;
  const surfaces: Array<{ app: string; portEnv: string; port: number }> = [];
  for (const match of source.matchAll(pattern)) {
    surfaces.push({ app: match[1] as string, portEnv: match[2] as string, port: Number(match[3]) });
  }
  return surfaces;
}

const deployments = () => k8sManifests().filter(({ manifest }) => manifest.kind === 'Deployment');
const services = () => k8sManifests().filter(({ manifest }) => manifest.kind === 'Service');
const ingresses = () => k8sManifests().filter(({ manifest }) => manifest.kind === 'Ingress');

function podSpecOf(manifest: Manifest): PodSpec | undefined {
  return manifest.spec?.template?.spec ?? manifest.spec?.jobTemplate?.spec?.template?.spec;
}

/**
 * جملة bash كاملةً لا سطرها الأول: سطرٌ ينتهي بشرطةٍ مائلة (`\`) يكمل في التالي — وحلقة
 * الإقلاع في `local-start.sh` موزَّعة على سطرين، فقراءةُ السطر وحده تُسقط سطحين من الحكم.
 */
function bashStatement(source: string, marker: (line: string) => boolean): string {
  const lines = source.split('\n');
  const start = lines.findIndex(marker);
  expect(start, `scripts/local-start.sh must contain the statement (${marker.name || 'predicate'})`).toBeGreaterThanOrEqual(0);
  let text = lines[start] ?? '';
  let cursor = start;
  while (text.trimEnd().endsWith('\\') && cursor + 1 < lines.length) {
    cursor += 1;
    text = `${text.slice(0, -1)} ${lines[cursor] ?? ''}`;
  }
  return text;
}

/** عناصر مصفوفة bash (‏`SERVICES=(…)`) — بعدّ العناصر خارج علامات الاقتباس. */
function bashArrayElements(source: string, name: string): string[] {
  const line = source.split('\n').find((row) => row.trimStart().startsWith(`${name}=(`));
  expect(line, `${name}=(…) must exist in scripts/local-start.sh`).toBeTruthy();
  const body = (line as string).slice((line as string).indexOf('(') + 1, (line as string).lastIndexOf(')'));
  const elements: string[] = [];
  let current = '';
  let quoted = false;
  /**
   * عنصرٌ فارغٌ مكتوبٌ صراحةً (`PORTS=( "$API_PORT" "" …)`) **عنصرٌ لا فراغ**: بلا هذا العلم
   * يسقط من العدّ فتتساوى مصفوفتان مختلفتان ويخفى الخلل — وهو ما وقع في أوّل تشغيلٍ لهذا
   * السبيك (‏`PORTS` عُدّت 4 و`SERVICES` ‏5). والعامل الخلفي لا منفذ له، ففارغُه مقصود.
   */
  let started = false;
  for (const char of body) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (started || current !== '') elements.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started || current !== '') elements.push(current);
  return elements;
}

describe('deployment surface — every Next surface is deployable end to end', () => {
  const surfaces = webSurfaces();

  it('reads the web surfaces from the local runner, not from a list written here', () => {
    // خمسة أسطحٍ اليوم: staff · marketing · platform-admin · customer-portal · bakery. ولو أُضيف
    // سادسٌ في `next-run.mjs` دخل في كل حكمٍ أدناه بلا تعديلٍ في هذا الملف.
    expect(surfaces.map((surface) => surface.app).sort()).toEqual([
      'bakery',
      'customer-portal',
      'marketing',
      'platform-admin',
      'staff',
    ]);
    expect(surfaces.every((surface) => Number.isInteger(surface.port) && surface.port > 0)).toBe(true);
  });

  it('declares every surface in docker-compose with its own port and the in-cluster API proxy', () => {
    const declared = compose();
    for (const { app, port } of surfaces) {
      const service = declared[app];
      expect(service, `docker-compose.yml must declare a "${app}" service`).toBeTruthy();
      expect(service?.image, `${app} image`).toBe(`erp-${app}:local`);
      expect(service?.build?.dockerfile, `${app} dockerfile`).toBe('deploy/Dockerfile.web');
      expect(service?.build?.args?.APP, `${app} build arg APP`).toBe(app);
      expect(service?.build?.args?.PORT, `${app} build arg PORT`).toBe(String(port));
      expect(service?.environment?.PORT, `${app} runtime PORT`).toBe(String(port));
      expect(service?.environment?.API_PROXY_TARGET, `${app} proxy target`).toBe('http://api:3000');
      expect(service?.ports ?? [], `${app} published port`).toContain(`${port}:${port}`);
    }
  });

  it('declares every surface as a k8s Deployment and Service on the same port, hardened', () => {
    for (const { app, port } of surfaces) {
      const deployment = deployments().find(({ manifest }) => manifest.metadata?.name === app);
      expect(deployment, `deploy/k8s must declare a Deployment named "${app}"`).toBeTruthy();
      const pod = podSpecOf(deployment?.manifest as Manifest);
      const container = pod?.containers?.[0];
      expect(container?.image, `${app} image`).toBe(`erp-${app}:latest`);
      expect(container?.ports?.[0]?.containerPort, `${app} containerPort`).toBe(port);
      expect(container?.env?.find((entry) => entry.name === 'PORT')?.value, `${app} env PORT`).toBe(String(port));
      // الخادم المُصغَّر (Next standalone) لا يستمع على 0.0.0.0 إلا بـHOSTNAME صريح.
      expect(container?.env?.find((entry) => entry.name === 'HOSTNAME')?.value, `${app} env HOSTNAME`).toBe('0.0.0.0');
      expect(container?.readinessProbe, `${app} readinessProbe`).toBeTruthy();
      expect(container?.resources?.requests, `${app} resource requests`).toBeTruthy();
      expect(container?.resources?.limits, `${app} resource limits`).toBeTruthy();
      expect(pod?.securityContext?.runAsNonRoot, `${app} must run as non-root`).toBe(true);

      const service = services().find((entry) => entry.manifest.metadata?.name === `erp-${app}`);
      expect(service, `deploy/k8s must declare a Service named "erp-${app}"`).toBeTruthy();
      expect(service?.manifest.spec?.selector, `erp-${app} selector`).toEqual({ app });
      expect(service?.manifest.spec?.ports?.[0]?.port, `erp-${app} port`).toBe(port);
      expect(service?.manifest.spec?.ports?.[0]?.targetPort, `erp-${app} targetPort`).toBe(port);
    }
  });

  it('pins every erp-* image in kustomization, so `apply -k` cannot reference an unbuilt name', () => {
    const pinned = new Set((kustomization().images ?? []).map((entry) => entry.name));
    for (const entry of pinned) {
      expect(entry, 'kustomization images entries need a name').toBeTruthy();
    }
    const referenced = new Set<string>();
    for (const { manifest } of k8sManifests()) {
      for (const container of podSpecOf(manifest)?.containers ?? []) {
        const image = container.image ?? '';
        if (image.startsWith('erp-')) referenced.add(image.split(':')[0] as string);
      }
    }
    // كلُّ صورةٍ مرجعيّة لها معيدُ تسميةٍ إلى GHCR بوسم.
    for (const image of referenced) {
      expect(pinned.has(image), `kustomization.yaml images: must pin "${image}"`).toBe(true);
      const entry = (kustomization().images ?? []).find((candidate) => candidate.name === image);
      expect(entry?.newName, `${image} newName`).toMatch(/^ghcr\.io\/.+/);
      expect(entry?.newTag, `${image} newTag`).toBeTruthy();
    }
    // وكلُّ واجهة ويب لها مدخلها (لا relies on the cross-check alone).
    for (const { app } of surfaces) expect(pinned.has(`erp-${app}`), `images: erp-${app}`).toBe(true);
  });

  it('scales the API and every web surface to at least two replicas in production', () => {
    const counts = new Map((kustomization().replicas ?? []).map((entry) => [entry.name, entry.count]));
    for (const { app } of surfaces) {
      expect(counts.get(app) ?? 0, `kustomization replicas for "${app}"`).toBeGreaterThanOrEqual(2);
    }
    expect(counts.get('api') ?? 0, 'kustomization replicas for "api"').toBeGreaterThanOrEqual(2);
  });

  it('routes every surface through the ingress and issues a certificate for the host it serves', () => {
    for (const { app, port } of surfaces) {
      const route = ingresses()
        .flatMap(({ manifest }) =>
          (manifest.spec?.rules ?? []).map((rule) => ({
            host: rule.host ?? '',
            tls: (manifest.spec?.tls ?? []).flatMap((entry) => entry.hosts ?? []),
            backend: rule.http?.paths?.[0]?.backend?.service,
          })),
        )
        .find((entry) => entry.backend?.name === `erp-${app}`);
      expect(route, `ingress must route a host to "erp-${app}"`).toBeTruthy();
      expect(route?.backend?.port?.number, `ingress port for erp-${app}`).toBe(port);
      expect(route?.host, `ingress host for erp-${app}`).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      // ‏cert-manager لا يُصدر لشبكةٍ غير معلنة في `tls.hosts` — فيبقى النطاق بلا شهادة.
      expect(route?.tls ?? [], `tls.hosts must include the host serving erp-${app}`).toContain(route?.host);
    }
  });

  it('routes every documented *_PUBLIC_URL host through the ingress', () => {
    const config = k8sManifests().find(({ manifest }) => manifest.kind === 'ConfigMap' && manifest.metadata?.name === 'erp-config');
    const data = config?.manifest.data ?? {};
    const publicUrls = Object.entries(data).filter(([key]) => key.endsWith('_PUBLIC_URL') || key === 'PUBLIC_APP_URL');
    expect(publicUrls.length, 'config.yaml must keep documenting the public URLs').toBeGreaterThan(0);
    const ingressHosts = ingresses().flatMap(({ manifest }) => (manifest.spec?.rules ?? []).map((rule) => rule.host ?? ''));
    for (const [key, value] of publicUrls) {
      const host = new URL(value).hostname;
      expect(ingressHosts, `${key}=${value} must be routed by an ingress host`).toContain(host);
    }
  });

  it('starts every surface from scripts/local-start.sh with the port variable the runner reads', () => {
    const source = read('scripts/local-start.sh');
    const declaredServices = bashArrayElements(source, 'SERVICES');
    const ports = bashArrayElements(source, 'PORTS');
    const probes = bashArrayElements(source, 'PROBES');
    const labels = bashArrayElements(source, 'LABELS');
    // ‏`set -u` مع مصفوفاتٍ غير متساوية الطول = فشلٌ في `status()` وانتظار الجهوزية، لا نقصٌ تجميلي.
    expect(ports.length, 'PORTS must align with SERVICES').toBe(declaredServices.length);
    expect(probes.length, 'PROBES must align with SERVICES').toBe(declaredServices.length);
    expect(labels.length, 'LABELS must align with SERVICES').toBe(declaredServices.length);

    const startLoop = bashStatement(source, (line) => line.includes('for pair in'));
    const buildLoop = bashStatement(source, (line) => /^\s*for app in /.test(line));
    for (const { app, portEnv, port } of surfaces) {
      expect(declaredServices, `local-start SERVICES must include "${app}"`).toContain(app);
      expect(startLoop, `local-start must start "${app}"`).toContain(`"${app}:$`);
      expect(buildLoop, `local-start must build "${app}" in production mode`).toContain(app);
      // متغيّر المنفذ نفسه الذي يقرؤه `next-run.mjs` — فلا منفذَين لسطحٍ واحد.
      expect(source, `local-start must read ${portEnv}`).toContain(portEnv);
      expect(source, `local-start must default ${portEnv} to ${port}`).toContain(`:-${port}`);
    }
    expect(declaredServices, 'local-start must also run the API and its worker').toEqual(
      expect.arrayContaining(['api', 'worker']),
    );
  });

  it('has no dangling reference between the k8s manifests', () => {
    const serviceNames = new Map(services().map(({ manifest }) => [manifest.metadata?.name, manifest]));
    // 1) كلّ خلفٍ في المدخل خدمةٌ معلنة، ومنفذه منفذُها.
    for (const { manifest } of ingresses()) {
      for (const rule of manifest.spec?.rules ?? []) {
        for (const path of rule.http?.paths ?? []) {
          const backend = path.backend?.service;
          if (!backend?.name) continue;
          const service = serviceNames.get(backend.name);
          expect(service, `ingress backend "${backend.name}" must be a declared Service`).toBeTruthy();
          expect(service?.spec?.ports?.[0]?.port, `ingress backend port for "${backend.name}"`).toBe(
            backend.port?.number,
          );
        }
      }
    }
    // 2) كلّ واصف خدمةٍ يطابق حملَ عملٍ واحد على الأقل (وإلا فالخدمة بلا نقاط نهاية).
    const workloadLabels = k8sManifests()
      .map(({ manifest }) => podSpecOf(manifest)?.template?.metadata?.labels ?? manifest.spec?.template?.metadata?.labels)
      .filter((labels): labels is Record<string, string> => Boolean(labels))
      .map((labels) => (labels as Record<string, string>).app)
      .filter(Boolean);
    for (const { manifest } of services()) {
      const selector = manifest.spec?.selector as Record<string, string> | undefined;
      const app = selector?.app;
      expect(app, `Service "${manifest.metadata?.name}" must select an app label`).toBeTruthy();
      expect(workloadLabels, `Service "${manifest.metadata?.name}" selects app="${app}" which no workload carries`).toContain(app);
    }
    // 3) ملفات `kustomization.yaml` المعلنة موجودة فعلاً.
    for (const resource of kustomization().resources ?? []) {
      expect(
        readdirSync(new URL('deploy/k8s/', repoRoot)),
        `kustomization resource "${resource}" must exist`,
      ).toContain(resource);
    }
  });
});
