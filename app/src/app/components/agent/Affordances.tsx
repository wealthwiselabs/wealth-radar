'use client';
import type { UIAffordance } from '@/lib/agent/ui';

export type RespondFn = (token: string, decision: 'approve' | 'deny', value?: unknown) => void;

export default function Affordances({
  affordances,
  respond,
  disabled,
}: {
  affordances: UIAffordance[];
  respond: RespondFn;
  disabled?: boolean;
}) {
  if (!affordances.length) return null;
  return (
    <div className="space-y-2">
      {affordances.map((a, i) => (
        <Affordance key={i} affordance={a} respond={respond} disabled={disabled} />
      ))}
    </div>
  );
}

function Affordance({
  affordance: a,
  respond,
  disabled,
}: {
  affordance: UIAffordance;
  respond: RespondFn;
  disabled?: boolean;
}) {
  if (a.kind === 'confirm') {
    const { diff } = a;
    return (
      <div className="origin-card p-[var(--space-3)] space-y-[var(--space-2)] text-left">
        <div className="text-small font-medium text-[var(--color-text-base-default)]">{a.title}</div>
        <div className="text-small text-[var(--color-text-base-subdued)]">{diff.summary}</div>
        {(diff.before !== undefined || diff.after !== undefined) && (
          <div className="text-xsmall font-mono space-y-1">
            {diff.before !== undefined && (
              <div className="text-[var(--color-text-critical)]">- {diff.before}</div>
            )}
            {diff.after !== undefined && (
              <div className="text-[var(--color-text-success)]">+ {diff.after}</div>
            )}
          </div>
        )}
        {diff.affected !== undefined && (
          <div className="text-xsmall text-[var(--color-text-base-subdued)]">{diff.affected} affected</div>
        )}
        <div className="flex gap-2 pt-1">
          <button
            className="origin-btn origin-btn-primary"
            disabled={disabled}
            onClick={() => respond(a.token, 'approve')}
          >
            {a.confirmLabel}
          </button>
          <button
            className="origin-btn origin-btn-secondary"
            disabled={disabled}
            onClick={() => respond(a.token, 'deny')}
          >
            Deny
          </button>
        </div>
      </div>
    );
  }

  if (a.kind === 'confirm_batch') {
    return (
      <div className="origin-card p-[var(--space-3)] space-y-[var(--space-2)] text-left">
        <div className="text-small font-medium text-[var(--color-text-base-default)]">{a.title}</div>
        <ul className="text-small text-[var(--color-text-base-subdued)] space-y-1 list-disc pl-4">
          {a.items.map((it, idx) => (
            <li key={idx}>{it.summary}</li>
          ))}
        </ul>
        <div className="flex gap-2 pt-1">
          <button
            className="origin-btn origin-btn-primary"
            disabled={disabled}
            onClick={() => respond(a.token, 'approve')}
          >
            {a.confirmLabel}
          </button>
          <button
            className="origin-btn origin-btn-secondary"
            disabled={disabled}
            onClick={() => respond(a.token, 'deny')}
          >
            Deny
          </button>
        </div>
      </div>
    );
  }

  if (a.kind === 'select' || a.kind === 'multiselect') {
    return (
      <div className="origin-card p-[var(--space-3)] space-y-[var(--space-2)] text-left">
        <div className="text-small text-[var(--color-text-base-subdued)]">{a.prompt}</div>
        <div className="flex flex-wrap gap-2">
          {a.options.map((o) => (
            <button
              key={o.value}
              className="origin-btn origin-btn-secondary"
              disabled={disabled}
              onClick={() => respond(a.token, 'approve', o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (a.kind === 'account_picker') {
    return (
      <div className="origin-card p-[var(--space-3)] space-y-[var(--space-2)] text-left">
        <div className="text-small text-[var(--color-text-base-subdued)]">{a.prompt}</div>
        <div className="flex flex-wrap gap-2">
          {a.accounts.map((acc) => (
            <button
              key={acc.id}
              className="origin-btn origin-btn-secondary"
              disabled={disabled}
              onClick={() => respond(a.token, 'approve', acc.id)}
            >
              {acc.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // suggestions: no token — clicking replays the option value as a new prompt
  // via the `deny`-less convention (the hook maps it to send()).
  return (
    <div className="flex flex-wrap gap-2">
      {a.options.map((o) => (
        <button
          key={o.value}
          className="origin-btn origin-btn-secondary"
          disabled={disabled}
          onClick={() => respond('', 'approve', o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
