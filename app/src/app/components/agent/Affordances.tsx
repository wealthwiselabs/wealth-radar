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
      <div className="rounded border p-3 space-y-2 text-left">
        <div className="font-medium">{a.title}</div>
        <div className="text-sm opacity-80">{diff.summary}</div>
        {(diff.before !== undefined || diff.after !== undefined) && (
          <div className="text-xs font-mono space-y-1">
            {diff.before !== undefined && <div className="text-red-600 dark:text-red-400">- {diff.before}</div>}
            {diff.after !== undefined && <div className="text-green-600 dark:text-green-400">+ {diff.after}</div>}
          </div>
        )}
        {diff.affected !== undefined && (
          <div className="text-xs opacity-70">{diff.affected} affected</div>
        )}
        <div className="flex gap-2 pt-1">
          <button
            className="rounded px-3 py-1 bg-black/80 text-white disabled:opacity-50"
            disabled={disabled}
            onClick={() => respond(a.token, 'approve')}
          >
            {a.confirmLabel}
          </button>
          <button
            className="rounded px-3 py-1 border disabled:opacity-50"
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
      <div className="rounded border p-3 space-y-2 text-left">
        <div className="font-medium">{a.title}</div>
        <ul className="text-sm opacity-80 space-y-1 list-disc pl-4">
          {a.items.map((it, idx) => (
            <li key={idx}>{it.summary}</li>
          ))}
        </ul>
        <div className="flex gap-2 pt-1">
          <button
            className="rounded px-3 py-1 bg-black/80 text-white disabled:opacity-50"
            disabled={disabled}
            onClick={() => respond(a.token, 'approve')}
          >
            {a.confirmLabel}
          </button>
          <button
            className="rounded px-3 py-1 border disabled:opacity-50"
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
      <div className="rounded border p-3 space-y-2 text-left">
        <div className="text-sm opacity-80">{a.prompt}</div>
        <div className="flex flex-wrap gap-2">
          {a.options.map((o) => (
            <button
              key={o.value}
              className="rounded px-3 py-1 border disabled:opacity-50"
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
      <div className="rounded border p-3 space-y-2 text-left">
        <div className="text-sm opacity-80">{a.prompt}</div>
        <div className="flex flex-wrap gap-2">
          {a.accounts.map((acc) => (
            <button
              key={acc.id}
              className="rounded px-3 py-1 border disabled:opacity-50"
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
          className="rounded px-3 py-1 border text-sm disabled:opacity-50"
          disabled={disabled}
          onClick={() => respond('', 'approve', o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
