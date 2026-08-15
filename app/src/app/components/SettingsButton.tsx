'use client';

import { useEffect, useState } from 'react';
import { getStoredApiKey, setStoredApiKey } from '@/lib/apiKey';
import {
  applyThemePreference,
  getStoredThemePreference,
  setStoredThemePreference,
  type ThemePreference,
} from '@/lib/theme';
import Link from 'next/link';

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export default function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>('system');
  // The preference in force when the modal opened, so Cancel can put it back. A
  // theme picker is worth previewing live — you cannot judge one from a label —
  // but a live preview still has to honour Cancel like the key field does.
  const [themeOnOpen, setThemeOnOpen] = useState<ThemePreference>('system');

  useEffect(() => {
    setHasKey(!!getStoredApiKey());
  }, [isOpen]);

  const open = () => {
    const stored = getStoredThemePreference();
    setKeyInput(getStoredApiKey());
    setTheme(stored);
    setThemeOnOpen(stored);
    setIsOpen(true);
  };

  // Preview immediately; persisted only on Save.
  const previewTheme = (next: ThemePreference) => {
    setTheme(next);
    applyThemePreference(next);
  };

  const save = () => {
    setStoredApiKey(keyInput);
    setStoredThemePreference(theme);
    setHasKey(!!keyInput.trim());
    setIsOpen(false);
  };

  // Every dismissal path — Cancel, the ×, the backdrop — drops the preview.
  const cancel = () => {
    applyThemePreference(themeOnOpen);
    setTheme(themeOnOpen);
    setIsOpen(false);
  };

  const clear = () => {
    setStoredApiKey('');
    setKeyInput('');
    setHasKey(false);
  };

  return (
    <>
      <button
        onClick={open}
        className="origin-btn origin-btn-secondary flex items-center gap-[var(--space-2)]"
        title="Settings"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Settings
        {hasKey && (
          <span className="w-2 h-2 rounded-full bg-[var(--color-background-success-default)]" />
        )}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[var(--space-4)]"
          onClick={cancel}
        >
          <div
            className="origin-card-elevated w-full max-w-2xl max-h-[90vh] overflow-y-auto p-[var(--space-6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-[var(--space-4)]">
              <div>
                <h2 className="heading-xsmall text-[var(--color-text-base-default)]">Settings</h2>
                <p className="text-small text-[var(--color-text-base-subdued)] mt-[var(--space-1)]">
                  Stored in this browser only.
                </p>
              </div>
              <button
                onClick={cancel}
                className="text-[var(--color-text-base-subdued)] hover:text-[var(--color-text-base-default)] text-xl leading-none"
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <label className="text-small font-medium text-[var(--color-text-base-default)] block mb-[var(--space-2)]">
              Anthropic API key
            </label>
            <div className="flex gap-[var(--space-2)]">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                className="origin-input flex-1 font-mono text-small"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="origin-btn origin-btn-secondary"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xsmall text-[var(--color-text-base-subdued)] mt-[var(--space-2)]">
              Powers PDF classification, and is sent only to this app's classify endpoint. Get a
              key at{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                console.anthropic.com
              </a>
              . If a server-side key is set in <code>.env.local</code>, this overrides it.
            </p>

            <hr className="my-[var(--space-6)] border-[var(--color-border-base-subdued)]" />

            <fieldset>
              <legend className="text-small font-medium text-[var(--color-text-base-default)] mb-[var(--space-2)]">
                Theme
              </legend>
              {/* Radios rather than buttons: mutually exclusive values with one
                  selected is exactly what a radio group is, and it gets
                  arrow-key navigation and screen-reader semantics for free. */}
              <div className="flex gap-[var(--space-2)]">
                {THEMES.map(({ value, label }) => (
                  <label
                    key={value}
                    // The radio itself is sr-only, so the focus ring has to be
                    // borrowed by the label — matching .origin-input:focus.
                    className={`origin-btn cursor-pointer focus-within:shadow-[0_0_0_2px_var(--color-focus-ring)] ${
                      theme === value ? 'origin-btn-primary' : 'origin-btn-secondary'
                    }`}
                  >
                    <input
                      type="radio"
                      name="theme"
                      value={value}
                      checked={theme === value}
                      onChange={() => previewTheme(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-xsmall text-[var(--color-text-base-subdued)] mt-[var(--space-2)]">
                System follows your device's appearance setting, and keeps following it if
                that changes. Previewed as you pick; applied on Save.
              </p>
            </fieldset>

            <hr className="my-[var(--space-6)] border-[var(--color-border-base-subdued)]" />

            <p className="text-small text-[var(--color-text-base-subdued)]">
              Accounts moved to{' '}
              <Link href="/accounts" className="underline" onClick={() => setIsOpen(false)}>
                Accounts &amp; data
              </Link>
              , where the table has room to breathe.
            </p>

            <div className="flex items-center justify-between mt-[var(--space-6)]">
              <button
                onClick={clear}
                className="origin-btn origin-btn-secondary"
                disabled={!hasKey && !keyInput}
              >
                Clear
              </button>
              <div className="flex gap-[var(--space-2)]">
                <button onClick={cancel} className="origin-btn origin-btn-secondary">
                  Cancel
                </button>
                <button onClick={save} className="origin-btn origin-btn-primary">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
