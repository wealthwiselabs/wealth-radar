import { describe, it, expect } from 'vitest';
import {
  normalizeThemePreference,
  resolveTheme,
  getStoredThemePreference,
  setStoredThemePreference,
  THEME_STORAGE_KEY,
  DEFAULT_THEME_PREFERENCE,
} from '@/lib/theme';

describe('normalizeThemePreference', () => {
  it('reads the three real preferences', () => {
    expect(normalizeThemePreference('light')).toBe('light');
    expect(normalizeThemePreference('dark')).toBe('dark');
    expect(normalizeThemePreference('system')).toBe('system');
  });

  it('defaults to system when nothing is stored', () => {
    expect(normalizeThemePreference(null)).toBe('system');
    expect(normalizeThemePreference('')).toBe('system');
  });

  // The stored value is user-writable (it's just localStorage) and outlives any
  // one build, so an unrecognized name resolves to the default rather than
  // reaching the DOM and leaving the page with no palette at all.
  it('falls back to system for an unrecognized value', () => {
    expect(normalizeThemePreference('DARK')).toBe('system');
    expect(normalizeThemePreference('solarized')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('honours an explicit choice regardless of the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  // Resolution is what the DOM gets, and the DOM has no third state: the
  // attribute is always one of the two real palettes.
  it('never resolves to system itself', () => {
    for (const prefersDark of [true, false]) {
      expect(['light', 'dark']).toContain(resolveTheme('system', prefersDark));
    }
  });
});

describe('theme storage', () => {
  // vitest runs these in the `node` environment: no window, no localStorage.
  // The helpers are imported by client components that also render on the
  // server, so they must no-op rather than throw there.
  it('reports the default preference with no window', () => {
    expect(getStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
  });

  it('does not throw when storing with no window', () => {
    expect(() => setStoredThemePreference('dark')).not.toThrow();
  });

  it('namespaces its storage key like the other browser-stored settings', () => {
    expect(THEME_STORAGE_KEY).toBe('expense-tracker:theme');
  });
});
