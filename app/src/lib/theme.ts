// Browser-only helpers for the theme choice, stored in localStorage alongside
// the API key (see apiKey.ts for the same idiom).
//
// Two distinct types, and the difference matters:
//   - ThemePreference is what the USER picked, and includes 'system'.
//   - ResolvedTheme is what the DOM gets. There is no third palette, so
//     'system' is resolved against `prefers-color-scheme` before it ever
//     reaches the `data-theme` attribute.
//
// globals.css keys its palette off that attribute alone and never consults
// prefers-color-scheme itself. That keeps one rule for the dark palette instead
// of a duplicate under a media query — but it does mean JS owns resolution, so
// two things must hold: the inline script in layout.tsx sets the attribute
// before first paint (or a dark user gets a light flash), and ThemeSync keeps
// it current if the OS flips while the app is open.

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'expense-tracker:theme';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** The media query that decides 'system'. Shared so the init script can't drift. */
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * A stored (or absent, or junk) value as one of the preferences that exist.
 *
 * localStorage is user-writable and outlives any given build, so this never
 * trusts its input: anything unrecognized resolves to the default.
 */
export function normalizeThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : DEFAULT_THEME_PREFERENCE;
}

/** The palette to actually render, given the preference and the OS setting. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

/** Whether the OS asks for dark. False anywhere `matchMedia` is unavailable. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT_THEME_PREFERENCE;
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Private browsing / storage disabled — the app still works, it just
    // can't remember the choice across reloads.
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function setStoredThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // See getStoredThemePreference: not worth failing the user's click over.
  }
}

/** Point the live document at `preference`, resolving 'system' against the OS. */
export function applyThemePreference(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(preference, systemPrefersDark()));
}

/**
 * The script that runs before first paint, inlined into <head>.
 *
 * Kept here next to the key, the media query and the attribute it depends on,
 * so the four cannot drift apart. It is deliberately tiny and dependency-free:
 * it runs render-blocking, ahead of React.
 */
export const THEME_INIT_SCRIPT = `try{var p=localStorage.getItem('${THEME_STORAGE_KEY}');if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&window.matchMedia('${DARK_MEDIA_QUERY}').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')}catch(e){}`;
