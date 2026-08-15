'use client';

import { useEffect } from 'react';
import {
  DARK_MEDIA_QUERY,
  applyThemePreference,
  getStoredThemePreference,
} from '@/lib/theme';

/**
 * Renders nothing; keeps the `system` theme preference honest.
 *
 * The inline script in layout.tsx resolves `system` once, before first paint.
 * That is enough for a page load but not for a session: the OS can flip to dark
 * at sunset with the app already open, and because globals.css keys off the
 * `data-theme` attribute rather than the media query, nothing would notice.
 * This listens so it does.
 *
 * The stored preference is re-read on each change rather than captured, so an
 * explicit Light or Dark choice keeps ignoring the OS, as it should.
 */
export default function ThemeSync() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = () => {
      if (getStoredThemePreference() === 'system') applyThemePreference('system');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return null;
}
