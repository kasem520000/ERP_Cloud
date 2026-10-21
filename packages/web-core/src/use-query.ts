'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiErrorText } from './api';

export type QueryState<T> = {
  status: 'loading' | 'success' | 'error' | 'forbidden';
  data?: T;
  error?: string;
  reload: () => void;
};

/**
 * سببُ فشلِ القراءة كما يُعرض تحت عنوانٍ عربيٍّ للشاشة.
 *
 * الشرط `\u0600-\u06FF` مقصود: تفاصيل القراءة تأتي من الخادم بالإنجليزيّة
 * («Sales invoice was not found»)، وعرضُها في واجهةٍ عربيّةٍ يبدو كنصٍّ متروكٍ من
 * الخادم لا كرسالة. والفرق عن `apiErrorText` في النماذج: هناك الرسالةُ نتيجةُ
 * إدخالٍ يجب أن تُقرأ كما وردت (وقد تكون إنجليزيّةً مشروعة)، وهنا الشاشةُ نفسها
 * تقول «تعذّر تحميل الفاتورة» — فلا يُضاف إليها سطرٌ بلغةٍ أخرى.
 */
function reasonOf(error: unknown): string | undefined {
  const reason =
    error instanceof ApiError
      ? apiErrorText(error, '')
      : error instanceof Error
        ? error.message
        : String(error);
  return /[\u0600-\u06FF]/.test(reason) ? reason : undefined;
}

/** Minimal data hook — no cache, explicit states, forbidden separated from error. */
export function useQuery<T>(loader: () => Promise<T>, deps: unknown[] = []): QueryState<T> {
  const [state, setState] = useState<{ status: QueryState<T>['status']; data?: T; error?: string }>({
    status: 'loading',
  });
  const [nonce, setNonce] = useState(0);

  // The loader identity changes on every render by design; the caller controls
  // re-running through `deps`.
  const run = useCallback(loader, deps);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    run()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.isForbidden) {
          setState({ status: 'forbidden', error: reasonOf(error) });
          return;
        }
        setState({ status: 'error', error: reasonOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [run, nonce]);

  return { ...state, reload: () => setNonce((value) => value + 1) };
}
