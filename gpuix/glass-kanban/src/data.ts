import { join } from 'node:path'

export type ColumnId = 'backlog' | 'todo' | 'progress' | 'review' | 'done'
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export interface Person {
  id: string
  name: string
  role: string
}

export interface Comment {
  id: string
  author: string
  body: string
  at: string
}

export interface Card {
  id: string
  title: string
  description: string
  labels: string[]
  assignee: string | null
  priority: Priority
  estimate: number
  comments: Comment[]
}

export interface Board {
  version: 1
  nextNumber: number
  columnOrder: ColumnId[]
  lanes: Record<ColumnId, string[]>
  cards: Record<string, Card>
}

export const COLUMN_META: Record<ColumnId, { title: string; tint: string }> = {
  backlog: { title: 'Backlog', tint: '#8A93A3' },
  todo: { title: 'Todo', tint: '#C9D1DC' },
  progress: { title: 'In Progress', tint: '#F5B544' },
  review: { title: 'In Review', tint: '#4FA3F7' },
  done: { title: 'Done', tint: '#3CC48D' },
}

export const COLUMN_IDS: ColumnId[] = ['backlog', 'todo', 'progress', 'review', 'done']

export const PEOPLE: Person[] = [
  { id: 'maya', name: 'Maya Chen', role: 'Design lead' },
  { id: 'jonas', name: 'Jonas Weber', role: 'iOS' },
  { id: 'priya', name: 'Priya Shah', role: 'Backend' },
  { id: 'diego', name: 'Diego Ramos', role: 'Web' },
  { id: 'sofia', name: 'Sofia Lindqvist', role: 'Product' },
  { id: 'kenji', name: 'Kenji Tanaka', role: 'Infra' },
  { id: 'amara', name: 'Amara Okafor', role: 'Payments' },
  { id: 'liam', name: 'Liam Byrne', role: 'QA' },
]

export const LABELS: Record<string, string> = {
  Bug: '#F2665F',
  Feature: '#4FA3F7',
  Design: '#F08BB4',
  Infra: '#8A93A3',
  Performance: '#F5B544',
  iOS: '#5AC8D8',
  Web: '#3CC48D',
  API: '#E3894B',
  Payments: '#22B8A6',
  Docs: '#B7C0CC',
}

export const LABEL_NAMES = Object.keys(LABELS)

export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none']
export const PRIORITY_NAMES: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
}

export const ESTIMATES = [1, 2, 3, 5, 8]

export function avatarPath(personId: string) {
  return join(import.meta.dir, '..', 'assets', 'avatars', `${personId}.png`)
}

export function personName(id: string | null) {
  return PEOPLE.find((p) => p.id === id)?.name ?? 'Unassigned'
}

type SeedRow = [ColumnId, string, string[], string | null, Priority, number, string?, [string, string][]?]

const SEED: SeedRow[] = [
  ['backlog', 'Offline mode for transaction history', ['Feature', 'iOS'], 'jonas', 'medium', 8,
    '## Goal\nCache the last **90 days** of transactions so the list renders instantly without a network.\n\n- Store pages in SQLite\n- Background refresh on app foreground\n- Show a subtle *Updated 2m ago* label'],
  ['backlog', 'Export statements as CSV and OFX', ['Feature', 'Web'], 'diego', 'low', 5],
  ['backlog', 'Evaluate passkeys for web sign-in', ['Feature', 'Web', 'API'], null, 'medium', 3,
    'Spike: compare WebAuthn libraries and the account-recovery story.\n\n1. Browser support matrix\n2. Recovery codes vs. email magic link\n3. Rollout plan behind a flag'],
  ['backlog', 'Dark mode pass on onboarding screens', ['Design', 'iOS'], 'maya', 'low', 2],
  ['backlog', 'Split notification settings by channel', ['Feature'], 'sofia', 'low', 3],
  ['backlog', 'Rate-limit dashboard for partner API keys', ['API', 'Infra'], 'priya', 'medium', 5],
  ['backlog', 'Accessibility audit: VoiceOver on card screens', ['iOS', 'Design'], 'liam', 'high', 3],
  ['backlog', 'Recurring transfers: skip next occurrence', ['Feature', 'Payments'], 'amara', 'low', 3],
  ['backlog', 'Move image uploads to signed URLs', ['Infra', 'API'], 'kenji', 'medium', 3],
  ['backlog', 'Spending insights: merchant categories v2', ['Feature', 'Design'], 'maya', 'none', 8],
  ['backlog', 'Document webhook retry semantics', ['Docs', 'API'], 'priya', 'low', 1],
  ['backlog', 'Widget for balance on the home screen', ['Feature', 'iOS'], null, 'none', 5],
  ['backlog', 'Investigate cold start regression on Android 15', ['Performance'], null, 'medium', 3],
  ['backlog', 'Referral program landing page', ['Web', 'Design'], 'sofia', 'none', 3],
  ['todo', 'Card freeze toggle should confirm before locking', ['Payments', 'Design'], 'amara', 'high', 2,
    'Users freeze cards by accident from the quick actions row. Add a confirm sheet with a **2s undo** toast instead of a modal.', [['maya', 'Mock is in Figma under *Card / Freeze v3*.']]],
  ['todo', 'Shared vaults: invite flow', ['Feature', 'iOS', 'Web'], 'sofia', 'high', 8],
  ['todo', 'Replace polling with server-sent events for balances', ['Performance', 'API'], 'priya', 'medium', 5],
  ['todo', 'Settings search', ['Feature', 'Web'], 'diego', 'low', 3],
  ['todo', 'Crash when rotating during Face ID prompt', ['Bug', 'iOS'], 'jonas', 'urgent', 2,
    '### Repro\n1. Open *Send money*\n2. Confirm with Face ID\n3. Rotate the device while the prompt is up\n\n`EXC_BAD_ACCESS` in `BiometricGate.resume()`.', [['liam', 'Reproduced on iPhone 15 Pro, iOS 18.1.'], ['jonas', 'Looks like the continuation is resumed twice.']]],
  ['todo', 'Terraform module for the new read replicas', ['Infra'], 'kenji', 'medium', 3],
  ['todo', 'Empty states for Savings goals', ['Design'], 'maya', 'low', 2],
  ['todo', 'Card controls: per-merchant blocking', ['Feature', 'Payments'], 'amara', 'medium', 5],
  ['todo', 'Flaky e2e: transfer review step', ['Bug'], 'liam', 'medium', 2],
  ['todo', 'Localize currency formatting for es-MX', ['Web', 'iOS'], 'diego', 'low', 2],
  ['todo', 'Audit log for admin role changes', ['API', 'Infra'], 'priya', 'high', 3],
  ['progress', 'Instant transfers between linked accounts', ['Feature', 'Payments'], 'amara', 'urgent', 8,
    '## Scope\nTransfers under **$2,500** settle instantly between accounts the user owns.\n\n- [x] Ledger double-entry\n- [x] Risk checks\n- [ ] Push receipt\n- [ ] Support tooling', [['sofia', 'Legal signed off on the limit.'], ['amara', 'Ledger PR is up, risk checks next.']]],
  ['progress', 'Redesign the activity feed', ['Design', 'Web'], 'maya', 'high', 5],
  ['progress', 'Migrate auth service to Postgres 16', ['Infra'], 'kenji', 'high', 5],
  ['progress', 'Virtualize the transactions table', ['Performance', 'Web'], 'diego', 'medium', 3,
    'The list janks past ~2k rows. Window it and keep row height fixed at 44px.'],
  ['progress', 'Scheduled payments API', ['API', 'Payments'], 'priya', 'high', 5],
  ['progress', 'Haptics on successful payment', ['iOS', 'Design'], 'jonas', 'low', 1],
  ['progress', 'Regression suite for statement PDFs', ['Bug'], 'liam', 'medium', 3],
  ['progress', 'Pricing page copy for Plus tier', ['Docs'], 'sofia', 'medium', 2],
  ['progress', 'Duplicate push notifications after reinstall', ['Bug', 'iOS'], 'jonas', 'high', 2],
  ['progress', 'Cache exchange rates at the edge', ['Performance', 'Infra'], 'kenji', 'medium', 3],
  ['progress', 'Card art picker', ['Design', 'Feature'], 'maya', 'low', 3],
  ['progress', 'Dispute flow: attach receipts', ['Feature', 'Payments'], 'amara', 'medium', 5],
  ['review', 'Round-up savings rules', ['Feature', 'Payments'], 'amara', 'medium', 5,
    'Round each card purchase up to the next dollar and move the change into a goal.', [['priya', 'Left a note on idempotency keys, otherwise good.']]],
  ['review', 'Sign-in screen spacing and type scale', ['Design', 'iOS'], 'maya', 'low', 1],
  ['review', 'Fix timezone drift in monthly statements', ['Bug', 'API'], 'priya', 'high', 2],
  ['review', 'Prefetch account summary on hover', ['Performance', 'Web'], 'diego', 'low', 2],
  ['review', 'Alerting for payout queue depth', ['Infra'], 'kenji', 'medium', 2],
  ['review', 'Support macro for frozen cards', ['Docs'], 'sofia', 'low', 1],
  ['review', 'Keyboard shortcuts for the web dashboard', ['Feature', 'Web'], 'diego', 'medium', 3],
  ['review', 'Snapshot tests for receipt view', ['iOS'], 'liam', 'low', 2],
  ['done', 'Apple Pay provisioning from the card screen', ['Feature', 'iOS', 'Payments'], 'jonas', 'high', 5],
  ['done', 'Rotate KMS keys for document storage', ['Infra'], 'kenji', 'urgent', 2],
  ['done', 'New typography tokens', ['Design'], 'maya', 'medium', 2],
  ['done', 'Paginate /v2/transactions with cursors', ['API'], 'priya', 'medium', 3],
  ['done', 'Fix double charge on retry after timeout', ['Bug', 'Payments'], 'amara', 'urgent', 3,
    'Root cause: the client retried with a fresh idempotency key. Keys are now generated once per intent.'],
  ['done', 'Onboarding checklist', ['Feature', 'Web'], 'diego', 'medium', 5],
  ['done', 'QA plan for instant transfers', ['Docs'], 'liam', 'low', 1],
  ['done', 'Reduce JS bundle by 30%', ['Performance', 'Web'], 'diego', 'high', 3],
  ['done', 'Customer interviews: shared vaults', ['Design'], 'sofia', 'medium', 2],
  ['done', 'Launch blog post for Plus', ['Docs'], 'sofia', 'low', 1],
  ['done', 'Upgrade to Xcode 16 toolchain', ['iOS', 'Infra'], 'jonas', 'low', 2],
  ['done', 'Card PIN reveal with Face ID', ['Feature', 'iOS'], 'jonas', 'medium', 3],
  ['done', 'Blue/green deploys for the API', ['Infra'], 'kenji', 'medium', 5],
  ['done', 'Login rate limiting', ['API', 'Bug'], 'priya', 'high', 2],
  ['done', 'Activity feed skeleton loaders', ['Design', 'Web'], 'maya', 'low', 1],
]

export const KEY_PREFIX = 'FIN'

export function seedBoard(): Board {
  const lanes: Record<ColumnId, string[]> = { backlog: [], todo: [], progress: [], review: [], done: [] }
  const cards: Record<string, Card> = {}
  SEED.forEach(([col, title, labels, assignee, priority, estimate, description, comments], i) => {
    const id = `${KEY_PREFIX}-${101 + i}`
    cards[id] = {
      id,
      title,
      description: description ?? '',
      labels,
      assignee,
      priority,
      estimate,
      comments: (comments ?? []).map(([author, body], j) => ({
        id: `${id}-c${j}`,
        author,
        body,
        at: `${2 + j * 3}h ago`,
      })),
    }
    lanes[col].push(id)
  })
  return { version: 1, nextNumber: 101 + SEED.length, columnOrder: [...COLUMN_IDS], lanes, cards }
}

export const SEED_COUNT = SEED.length
