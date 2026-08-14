'use client';
import { useEffect, useState } from 'react';

export function useAppConfig() {
  const [state, setState] = useState({ plaidEnabled: false, anthropicEnabled: false, loading: true });
  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((d) =>
      setState({ plaidEnabled: !!d.plaidEnabled, anthropicEnabled: !!d.anthropicEnabled, loading: false }),
    ).catch(() => setState((s) => ({ ...s, loading: false })));
  }, []);
  return state;
}
