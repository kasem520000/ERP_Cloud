'use client';

import { useEffect, useState } from 'react';

import { ApiError, apiData, apiPost } from '../../../lib/api';
import { clearSyncedPunches, enqueuePunch, readPunchQueue, type OfflinePunch } from '../../../lib/employee-offline';

type TodayRow = { id: string; type: string; status: string; at: string };

function locate(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('الموقع غير متاح في هذا المتصفح'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => reject(new Error('تعذر قراءة الموقع. اسمح بالموقع ثم أعد المحاولة.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export default function AttendancePage() {
  const [today, setToday] = useState<TodayRow[]>([]);
  const [queued, setQueued] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    const rows = await apiData<TodayRow[]>('/employee/attendance/today');
    setToday(Array.isArray(rows) ? rows : []);
    setQueued(readPunchQueue().length);
  }

  useEffect(() => {
    void reload().catch(() => setQueued(readPunchQueue().length));
  }, []);

  async function punch(type: 'check_in' | 'check_out') {
    setBusy(true);
    setMessage('');
    const at = new Date().toISOString();
    const clientId = crypto.randomUUID();
    try {
      const point = await locate();
      const result = await apiPost<{ status: string; distanceMeters: number | null }>('/employee/attendance', {
        type,
        lat: point.lat,
        lng: point.lng,
        at,
        clientId,
      });
      setMessage(result.status === 'valid' ? 'سُجّل داخل نطاق الفرع.' : 'سُجّل خارج النطاق، وسيصل تنبيه للمدير.');
      await reload();
    } catch (error) {
      const offline: OfflinePunch = { clientId, type, lat: 0, lng: 0, at };
      try {
        const point = await locate().catch(() => null);
        if (point) {
          offline.lat = point.lat;
          offline.lng = point.lng;
        }
      } catch {
        // Keep the queued punch even if a second location read fails.
      }
      if (offline.lat === 0 && offline.lng === 0) {
        setMessage(error instanceof Error ? error.message : 'تعذر تسجيل الحضور');
      } else {
        enqueuePunch(offline);
        setQueued(readPunchQueue().length);
        setMessage('لا اتصال. حُفظ الحضور على الجهاز وسيُزامَن لاحقاً.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    const punches = readPunchQueue();
    if (punches.length === 0) return;
    setBusy(true);
    try {
      const result = await apiPost<{ applied: unknown[]; duplicates: string[] }>('/employee/attendance/sync', { punches });
      clearSyncedPunches([...punches.map((punch) => punch.clientId), ...(result.duplicates ?? [])]);
      setMessage('تمت مزامنة الحضور المحفوظ.');
      await reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'تعذرت المزامنة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="employee-card">
      <h1>الحضور</h1>
      <div className="employee-actions">
        <button className="btn primary punch" type="button" disabled={busy} onClick={() => void punch('check_in')}>حضور</button>
        <button className="btn punch" type="button" disabled={busy} onClick={() => void punch('check_out')}>انصراف</button>
      </div>
      {queued > 0 ? (
        <button className="btn" type="button" disabled={busy} onClick={() => void sync()}>مزامنة {queued} غير مرسل</button>
      ) : null}
      {message ? <p className="alert info">{message}</p> : null}
      <ul>
        {today.map((row) => (
          <li key={row.id}>{row.type === 'check_in' ? 'حضور' : 'انصراف'} — {row.status === 'valid' ? 'داخل النطاق' : 'خارج النطاق'}</li>
        ))}
      </ul>
    </section>
  );
}
