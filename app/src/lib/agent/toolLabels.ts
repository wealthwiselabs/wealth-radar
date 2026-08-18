// Human-friendly status labels for the agent's tools, shown live in the chat
// while a step runs ("Searching your transactions…"). Falls back to a
// de-underscored tool name for anything unmapped.
const TOOL_LABELS: Record<string, string> = {
  search_transactions: 'Searching your transactions',
  query_spending: 'Analyzing your spending',
  investment_summary: 'Reviewing your investments',
  list_investment_transactions: 'Reviewing investment activity',
  query_investment_returns: 'Calculating returns',
  query_reserve: 'Checking your reserve',
  web_search: 'Searching the web',
  web_fetch: 'Reading a page',
  load_knowledge: 'Consulting knowledge',
  save_memory: 'Saving a note',
  spawn_task: 'Running a sub-task',
  deep_research: 'Researching',
  import_statement: 'Importing the statement',
  edit_transaction_metadata: 'Updating a transaction',
  update_matching_rule: 'Creating a rule',
  reconcile_transactions: 'Reconciling transactions',
  merge_accounts: 'Merging accounts',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Using ${name.replace(/_/g, ' ')}`;
}
