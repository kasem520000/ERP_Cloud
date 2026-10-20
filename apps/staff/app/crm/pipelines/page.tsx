'use client';

import { FormGrid, Panel } from '@erp/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Notice } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { ApiError } from '../../../lib/api';
import {
  createDeal,
  listDeals,
  listPipelines,
  moveDeal,
  type CrmDeal,
  type CrmPipeline,
} from '../../../lib/crm';
import { listParties, type Party } from '../../../lib/lookups';

export default function CrmPipelinesPage() {
  const [pipelines, setPipelines] = useState<CrmPipeline[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('1000');
  const [probability, setProbability] = useState(50);
  const [partyId, setPartyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info' | 'warn'; text: string }>();

  const pipeline = pipelines[0];

  async function reload() {
    setBusy(true);
    try {
      const [nextPipelines, nextParties] = await Promise.all([listPipelines(), listParties('customer')]);
      setPipelines(nextPipelines);
      setParties(nextParties);
      setDeals(await listDeals(nextPipelines[0]?.id));
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function addDeal() {
    if (!pipeline) return;
    setBusy(true);
    try {
      await createDeal({
        pipelineId: pipeline.id,
        title,
        value,
        probability,
        partyId: partyId || undefined,
      });
      setTitle('');
      setNotice({ kind: 'ok', text: 'أُنشئت الصفقة في المرحلة الأولى.' });
      setDeals(await listDeals(pipeline.id));
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function shift(deal: CrmDeal, stageId: string) {
    if (!pipeline || deal.stageId === stageId || deal.status !== 'open') return;
    setBusy(true);
    try {
      await moveDeal(deal.id, stageId);
      setDeals(await listDeals(pipeline.id));
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="مسار المبيعات"
      subtitle="أربع مراحل افتراضية: عميل محتمل، تواصل، عرض سعر، إغلاق. الصفقة تُنشأ في الأولى وتُنقل مرحلة بمرحلة."
      crumbs={['المبيعات', 'مسار المبيعات']}
      actions={
        <button className="btn" type="button" disabled={busy} onClick={() => void reload()}>
          تحديث
        </button>
      }
    >
      <Notice notice={notice} />
      <Panel title="صفقة جديدة" hint="تُنشأ الصفقة في المرحلة الأولى ثم تُنقل مرحلةً بمرحلة.">
        <FormGrid>
          <label className="field">
            <span>العنوان</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="توريد أجهزة"
            />
          </label>
          <label className="field">
            <span>القيمة</span>
            <input className="input" value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
          <label className="field">
            <span>الاحتمال %</span>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={probability}
              onChange={(event) => setProbability(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>العميل</span>
            <select className="input" value={partyId} onChange={(event) => setPartyId(event.target.value)}>
              <option value="">بدون عميل</option>
              {parties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                </option>
              ))}
            </select>
          </label>
        </FormGrid>
        <button
          className="btn primary"
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => void addDeal()}
        >
          إنشاء في المرحلة الأولى
        </button>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(pipeline?.stages ?? []).map((stage) => {
          const stageDeals = deals.filter((deal) => deal.stageId === stage.id);
          return (
            <div
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dealId = event.dataTransfer.getData('text/plain');
                const deal = deals.find((item) => item.id === dealId);
                if (deal) void shift(deal, stage.id);
              }}
            >
              <Panel
                title={
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-block',
                        inlineSize: 8,
                        blockSize: 8,
                        borderRadius: 999,
                        background: stage.color,
                      }}
                    />
                    {stage.name}
                  </span>
                }
                actions={<span className="badge">{stageDeals.length}</span>}
              >
                {stageDeals.length === 0 ? (
                  <p className="muted small m-0">لا صفقات في هذه المرحلة — اسحب بطاقة إلى هنا.</p>
                ) : (
                  stageDeals.map((deal) => (
                    <article
                      key={deal.id}
                      draggable={deal.status === 'open' && !busy}
                      onDragStart={(event) => event.dataTransfer.setData('text/plain', deal.id)}
                      style={{
                        display: 'grid',
                        gap: 2,
                        paddingBlock: 8,
                        borderBlockStart: '1px solid var(--line)',
                      }}
                    >
                      <Link href={`/crm/deals/${deal.id}`}>{deal.title}</Link>
                      <span className="muted small">
                        {deal.value} · {deal.probability}% ·{' '}
                        {deal.status === 'open' ? 'مفتوحة' : deal.status === 'won' ? 'رابحة' : 'خاسرة'}
                      </span>
                    </article>
                  ))
                )}
              </Panel>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}
