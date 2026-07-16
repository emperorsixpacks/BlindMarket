import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useTabParam — tab state that lives in the URL (?tab=...), so refresh,
 * back/forward, and shared links land on the tab the user was actually on.
 *
 * Drop-in for `useState`:
 *   const [tab, setTab] = useTabParam<MyTab>('details', TAB_IDS);
 *
 * `valid` guards against arbitrary query values; anything not in the list
 * falls back to `defaultTab`. The default tab keeps a clean URL (the param
 * is removed rather than written).
 */
export function useTabParam<T extends string>(defaultTab: T, valid: readonly T[]): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();

  const raw = params.get('tab');
  const tab = raw && (valid as readonly string[]).includes(raw) ? (raw as T) : defaultTab;

  const setTab = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === defaultTab) p.delete('tab');
          else p.set('tab', next);
          return p;
        },
        { replace: true }
      );
    },
    [setParams, defaultTab]
  );

  return [tab, setTab];
}
