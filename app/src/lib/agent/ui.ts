export interface Option {
  label: string;
  value: string;
}

export interface DiffView {
  summary: string;
  before?: string;
  after?: string;
  affected?: number;
}

export type UIAffordance =
  | { kind: 'confirm'; token: string; title: string; diff: DiffView; confirmLabel: string }
  | { kind: 'select'; token: string; prompt: string; options: Option[] }
  | { kind: 'multiselect'; token: string; prompt: string; options: Option[] }
  | { kind: 'account_picker'; token: string; prompt: string; accounts: { id: string; label: string }[] }
  | { kind: 'suggestions'; options: Option[] };
