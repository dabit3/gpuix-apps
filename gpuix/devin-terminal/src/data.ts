export type Status = 'running' | 'blocked' | 'finished' | 'failed' | 'sleeping'
export type AgentMode = 'normal' | 'fast' | 'ultra'

export type Step =
  | { kind: 'shell'; id: string; cmd: string; output: string; cwd: string; exit?: number; running?: boolean }
  | { kind: 'edit'; id: string; path: string; patch: string; additions: number; deletions: number }
  | { kind: 'browser'; id: string; url: string; title: string; note: string }
  | { kind: 'think'; id: string; text: string }

export type PlanItem = { text: string; done: boolean }

export type Check = { name: string; state: 'pass' | 'pending' | 'fail'; detail: string }

export type TranscriptEvent =
  | { kind: 'user'; id: string; text: string; at: string }
  | { kind: 'devin'; id: string; md: string; streaming?: boolean }
  | { kind: 'plan'; id: string; items: PlanItem[] }
  | { kind: 'work'; id: string; seconds: number; steps: Step[]; open: boolean; active?: boolean }
  | {
      kind: 'pr'
      id: string
      repo: string
      number: number
      title: string
      branch: string
      additions: number
      deletions: number
      files: number
      checks: Check[]
      state: 'open' | 'merged' | 'draft'
    }

export type Session = {
  id: string
  title: string
  repo: string
  branch: string
  status: Status
  group: 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older'
  updated: string
  acus: number
  mode: AgentMode
  events: TranscriptEvent[]
}

export const STATUS_COLOR: Record<Status, string> = {
  running: '#3ea6ff',
  blocked: '#f2b84b',
  finished: '#3fbf8a',
  failed: '#ef6461',
  sleeping: '#6b7079',
}

export const STATUS_LABEL: Record<Status, string> = {
  running: 'Working',
  blocked: 'Awaiting input',
  finished: 'Finished',
  failed: 'Failed',
  sleeping: 'Sleeping',
}

export const MODES: { value: AgentMode; label: string; description: string }[] = [
  { value: 'normal', label: 'Normal', description: 'Balanced speed and depth' },
  { value: 'fast', label: 'Fast', description: 'Quick edits, fewer checks' },
  { value: 'ultra', label: 'Ultra', description: 'Deep planning, parallel agents' },
]

const PATCH_RATE_LIMIT = `diff --git a/src/middleware/rateLimit.ts b/src/middleware/rateLimit.ts
--- a/src/middleware/rateLimit.ts
+++ b/src/middleware/rateLimit.ts
@@ -12,14 +12,22 @@ export function rateLimit(opts: RateLimitOptions) {
   const windowMs = opts.windowMs ?? 60_000
-  const hits = new Map<string, number>()
+  const store = opts.store ?? new RedisStore(redis, { prefix: 'rl:' })
 
   return async (req: Request, res: Response, next: NextFunction) => {
-    const key = req.ip
-    const count = (hits.get(key) ?? 0) + 1
-    hits.set(key, count)
-    if (count > opts.max) {
+    const key = opts.keyGenerator?.(req) ?? req.ip ?? 'anonymous'
+    const { count, resetAt } = await store.increment(key, windowMs)
+    res.setHeader('X-RateLimit-Limit', String(opts.max))
+    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, opts.max - count)))
+    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
+    if (count > opts.max) {
+      res.setHeader('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)))
       return res.status(429).json({ error: 'Too many requests' })
     }
     next()
   }
 }
`

const PATCH_FLAKY = `diff --git a/apps/web/e2e/checkout.spec.ts b/apps/web/e2e/checkout.spec.ts
--- a/apps/web/e2e/checkout.spec.ts
+++ b/apps/web/e2e/checkout.spec.ts
@@ -41,9 +41,11 @@ test('guest can complete checkout', async ({ page }) => {
   await page.getByRole('button', { name: 'Continue to payment' }).click()
-  await page.waitForTimeout(1500)
-  const frame = page.frameLocator('iframe[name^="__privateStripeFrame"]').first()
+  const frame = page.frameLocator('iframe[title="Secure card payment input frame"]')
+  await expect(frame.getByPlaceholder('Card number')).toBeVisible({ timeout: 15_000 })
   await frame.getByPlaceholder('Card number').fill('4242 4242 4242 4242')
   await frame.getByPlaceholder('MM / YY').fill('04 / 30')
   await frame.getByPlaceholder('CVC').fill('424')
-  await page.getByRole('button', { name: 'Pay now' }).click()
+  await Promise.all([
+    page.waitForURL('**/order/confirmed'),
+    page.getByRole('button', { name: 'Pay now' }).click(),
+  ])
`

const PATCH_MIGRATION = `diff --git a/db/migrations/20261021_add_invoice_index.sql b/db/migrations/20261021_add_invoice_index.sql
new file mode 100644
--- /dev/null
+++ b/db/migrations/20261021_add_invoice_index.sql
@@ -0,0 +1,6 @@
+-- Speeds up the billing dashboard query from 4.2s to 38ms on prod-sized data
+CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_org_created
+  ON invoices (organization_id, created_at DESC)
+  WHERE deleted_at IS NULL;
+
+ANALYZE invoices;
`

function shell(id: string, cmd: string, output: string, exit = 0, cwd = '~/repos'): Step {
  return { kind: 'shell', id, cmd, output, exit, cwd }
}

export function initialSessions(): Session[] {
  return [
    {
      id: 's-rate-limit',
      title: 'Move API rate limiting to Redis',
      repo: 'acme-corp/payments-api',
      branch: 'devin/redis-rate-limit',
      status: 'finished',
      group: 'Today',
      updated: '12m',
      acus: 3.4,
      mode: 'normal',
      events: [
        {
          kind: 'user',
          id: 'e1',
          at: '11:42 AM',
          text: 'Our in-memory rate limiter breaks when we scale payments-api past one pod. Move it to Redis, keep the same limits, and add the standard X-RateLimit headers. Open a PR when tests pass.',
        },
        {
          kind: 'devin',
          id: 'e2',
          md: "On it. I'll swap the `Map` store in `src/middleware/rateLimit.ts` for the Redis client we already use for sessions, so limits are shared across pods.",
        },
        {
          kind: 'plan',
          id: 'e3',
          items: [
            { text: 'Read the current middleware and its tests', done: true },
            { text: 'Add a RedisStore with atomic INCR + PEXPIRE', done: true },
            { text: 'Emit X-RateLimit-* and Retry-After headers', done: true },
            { text: 'Run the test suite and open a PR', done: true },
          ],
        },
        {
          kind: 'work',
          id: 'e4',
          seconds: 412,
          open: true,
          steps: [
            shell('w1', 'git clone git@github.com:acme-corp/payments-api.git && cd payments-api', "Cloning into 'payments-api'...\nremote: Enumerating objects: 18422, done.\nReceiving objects: 100% (18422/18422), 9.81 MiB | 24.3 MiB/s, done.\nResolving deltas: 100% (12210/12210), done."),
            shell('w2', 'pnpm install --frozen-lockfile', 'Lockfile is up to date, resolution step is skipped\nPackages: +812\nProgress: resolved 812, reused 812, downloaded 0, added 812, done\nDone in 6.4s', 0, '~/repos/payments-api'),
            { kind: 'edit', id: 'w3', path: 'src/middleware/rateLimit.ts', patch: PATCH_RATE_LIMIT, additions: 10, deletions: 5 },
            shell('w4', 'pnpm test -- rateLimit', ' RUN  v2.1.4 ~/repos/payments-api\n\n ✓ src/middleware/rateLimit.test.ts (9 tests) 212ms\n   ✓ allows requests under the limit\n   ✓ returns 429 with Retry-After over the limit\n   ✓ shares counters across two app instances\n   ✓ sets X-RateLimit-Remaining\n\n Test Files  1 passed (1)\n      Tests  9 passed (9)\n   Duration  1.82s', 0, '~/repos/payments-api'),
            { kind: 'browser', id: 'w5', url: 'http://localhost:4000/v1/charges', title: 'payments-api · local', note: 'Fired 120 requests in 60s from two ports; request 101 returned 429 with Retry-After: 41.' },
          ],
        },
        {
          kind: 'devin',
          id: 'e5',
          md: "Done. Rate limiting now lives in Redis, so all pods share one counter.\n\n- `RedisStore.increment` uses `INCR` + `PEXPIRE` in a single `MULTI`, so the window can't drift\n- Responses include `X-RateLimit-Limit`, `-Remaining`, `-Reset` and `Retry-After` on 429\n- Added a test that runs two app instances against one Redis and checks they share the limit\n\nNo config changes are needed: it reuses `REDIS_URL`.",
        },
        {
          kind: 'pr',
          id: 'e6',
          repo: 'acme-corp/payments-api',
          number: 1284,
          title: 'Move rate limiting to Redis and add X-RateLimit headers',
          branch: 'devin/redis-rate-limit',
          additions: 148,
          deletions: 23,
          files: 4,
          state: 'open',
          checks: [
            { name: 'ci / test', state: 'pass', detail: '2m 14s' },
            { name: 'ci / lint', state: 'pass', detail: '38s' },
            { name: 'ci / typecheck', state: 'pass', detail: '51s' },
            { name: 'Devin Review', state: 'pass', detail: 'No issues' },
          ],
        },
      ],
    },
    {
      id: 's-flaky',
      title: 'Fix flaky checkout e2e test',
      repo: 'northwind/storefront',
      branch: 'devin/fix-checkout-flake',
      status: 'running',
      group: 'Today',
      updated: 'now',
      acus: 1.2,
      mode: 'fast',
      events: [
        { kind: 'user', id: 'f1', at: '12:31 PM', text: 'checkout.spec.ts fails about 1 in 6 runs on CI with "frame was detached". Can you make it deterministic?' },
        { kind: 'devin', id: 'f2', md: "Looking into it. The test waits a fixed 1.5s for the Stripe iframe, which is the usual cause of this. I'll rerun it 30 times to confirm before changing anything." },
        {
          kind: 'work',
          id: 'f3',
          seconds: 188,
          open: true,
          active: true,
          steps: [
            shell('f3a', 'pnpm playwright test e2e/checkout.spec.ts --repeat-each=30', 'Running 30 tests using 4 workers\n  ✘  7 [chromium] › checkout.spec.ts:38 › guest can complete checkout (repeat 7)\n     Error: frame was detached\n  ✘ 19 [chromium] › checkout.spec.ts:38 › guest can complete checkout (repeat 19)\n\n  2 failed\n  28 passed (1.4m)', 1, '~/repos/storefront/apps/web'),
            { kind: 'edit', id: 'f3b', path: 'apps/web/e2e/checkout.spec.ts', patch: PATCH_FLAKY, additions: 6, deletions: 3 },
          ],
        },
      ],
    },
    {
      id: 's-index',
      title: 'Slow billing dashboard query',
      repo: 'acme-corp/billing',
      branch: 'devin/invoice-index',
      status: 'blocked',
      group: 'Today',
      updated: '1h',
      acus: 2.1,
      mode: 'ultra',
      events: [
        { kind: 'user', id: 'g1', at: '10:05 AM', text: 'The billing dashboard takes 4+ seconds to load for big orgs. Find out why.' },
        {
          kind: 'work',
          id: 'g2',
          seconds: 524,
          open: false,
          steps: [
            shell('g2a', "psql $DATABASE_URL -c \"EXPLAIN ANALYZE SELECT * FROM invoices WHERE organization_id = 'org_8f2' ORDER BY created_at DESC LIMIT 50\"", 'Limit  (cost=0.00..18422.10 rows=50) (actual time=4211.3..4211.9 rows=50 loops=1)\n  ->  Seq Scan on invoices  (actual time=0.02..4198.7 rows=2140331 loops=1)\n        Filter: (organization_id = \'org_8f2\'::text)\nPlanning Time: 0.21 ms\nExecution Time: 4212.08 ms', 0, '~/repos/billing'),
            { kind: 'edit', id: 'g2b', path: 'db/migrations/20261021_add_invoice_index.sql', patch: PATCH_MIGRATION, additions: 6, deletions: 0 },
          ],
        },
        { kind: 'devin', id: 'g3', md: "Found it: the dashboard query does a **sequential scan over 2.1M invoices**. A partial index on `(organization_id, created_at DESC)` brings it from **4.2s to 38ms** on a prod-sized snapshot.\n\nThe migration uses `CREATE INDEX CONCURRENTLY`, so it won't lock writes. Should I run it against staging first, or open the PR directly?" },
      ],
    },
    session('s-ios', 'Add haptics to the onboarding flow', 'litehouse/ios-app', 'finished', 'Today', '3h', 'normal'),
    session('s-docs', 'Generate API reference from OpenAPI spec', 'acme-corp/developer-docs', 'finished', 'Yesterday', '1d', 'fast'),
    session('s-tf', 'Upgrade Terraform AWS provider to v6', 'northwind/infra', 'failed', 'Yesterday', '1d', 'ultra'),
    session('s-i18n', 'Extract hard-coded strings for i18n', 'northwind/storefront', 'finished', 'Yesterday', '1d', 'normal'),
    session('s-sentry', 'Triage top 5 Sentry errors this week', 'litehouse/web', 'sleeping', 'Previous 7 days', '3d', 'normal'),
    session('s-py', 'Migrate data pipeline to Python 3.13', 'quantlake/etl', 'finished', 'Previous 7 days', '4d', 'ultra'),
    session('s-auth', 'Add SSO login with Okta', 'acme-corp/dashboard', 'finished', 'Previous 7 days', '5d', 'normal'),
    session('s-rust', 'Port image resizer to Rust + WASM', 'litehouse/media-service', 'finished', 'Previous 7 days', '6d', 'ultra'),
    session('s-a11y', 'Fix color contrast issues from audit', 'acme-corp/design-system', 'finished', 'Older', 'Oct 9', 'fast'),
    session('s-k8s', 'Add HPA and PDB to worker deployments', 'northwind/infra', 'finished', 'Older', 'Oct 7', 'normal'),
  ]
}

function session(
  id: string,
  title: string,
  repo: string,
  status: Status,
  group: Session['group'],
  updated: string,
  mode: AgentMode,
): Session {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28).replace(/-$/, '')
  const number = 200 + ((id.length * 97 + title.length * 13) % 1800)
  const failed = status === 'failed'
  const pkg = repo.includes('infra') ? 'terraform' : repo.includes('etl') ? 'pytest' : 'pnpm test'
  const testOutput = failed
    ? 'Error: Unsupported argument\n  on modules/vpc/main.tf line 41, in resource "aws_eip" "nat":\n  41:   vpc = true\nAn argument named "vpc" is not expected here. Use domain = "vpc".'
    : pkg === 'pytest'
      ? '============ 214 passed, 3 skipped in 18.42s ============'
      : ' Test Files  38 passed (38)\n      Tests  412 passed (412)\n   Duration  14.07s'
  const events: TranscriptEvent[] = [
    { kind: 'user', id: `${id}-u`, at: 'Yesterday', text: `${title}. Keep the change focused and open a PR in ${repo}.` },
    {
      kind: 'work',
      id: `${id}-w`,
      seconds: 180 + (title.length * 17) % 900,
      open: false,
      steps: [
        shell(`${id}-w1`, `git clone git@github.com:${repo}.git`, `Cloning into '${repo.split('/')[1]}'...\nReceiving objects: 100% (9214/9214), done.`),
        shell(`${id}-w2`, pkg === 'terraform' ? 'terraform init -upgrade && terraform plan' : pkg, testOutput, failed ? 1 : 0, `~/repos/${repo.split('/')[1]}`),
      ],
    },
    {
      kind: 'devin',
      id: `${id}-d`,
      md: failed
        ? `I couldn't finish this one. Provider **v6** removed the \`vpc\` argument on \`aws_eip\`, and 14 modules still use it. I've pushed a partial branch; want me to rewrite all of them to \`domain = "vpc"\`?`
        : status === 'sleeping'
          ? 'I grouped the errors by fingerprint and fixed the two with clear root causes. The other three need product input, so I left notes on each issue and went to sleep. Message me to pick it back up.'
          : `Finished **${title}**. All checks pass and the PR is ready for review.`,
    },
  ]
  if (!failed && status !== 'sleeping') {
    events.push({
      kind: 'pr',
      id: `${id}-pr`,
      repo,
      number,
      title,
      branch: `devin/${slug}`,
      additions: 40 + (title.length * 7) % 400,
      deletions: 5 + (title.length * 3) % 90,
      files: 2 + (title.length % 9),
      state: group === 'Older' || group === 'Previous 7 days' ? 'merged' : 'open',
      checks: [
        { name: 'ci / test', state: 'pass', detail: '3m 02s' },
        { name: 'ci / lint', state: 'pass', detail: '41s' },
        { name: 'Devin Review', state: 'pass', detail: 'No issues' },
      ],
    })
  }
  return { id, title, repo, branch: `devin/${slug}`, status, group, updated, acus: Number((0.6 + (title.length % 40) / 10).toFixed(1)), mode, events }
}

export const REPOS = ['acme-corp/payments-api', 'northwind/storefront', 'acme-corp/billing', 'litehouse/web', 'northwind/infra']

export function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '')
  const words = clean.split(' ')
  const title = words.slice(0, 7).join(' ')
  const out = words.length > 7 ? `${title}…` : title
  return out.charAt(0).toUpperCase() + out.slice(1)
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
}

export type RunAction =
  | { at: number; type: 'status'; status: Status }
  | { at: number; type: 'event'; event: TranscriptEvent }
  | { at: number; type: 'stream'; id: string; md: string; done?: boolean }
  | { at: number; type: 'plan-done'; id: string; index: number }
  | { at: number; type: 'step'; workId: string; step: Step }
  | { at: number; type: 'shell-output'; workId: string; stepId: string; output: string; exit?: number }
  | { at: number; type: 'work-done'; workId: string }
  | { at: number; type: 'check'; prId: string; index: number; state: Check['state']; detail: string }

/** A realistic scripted Devin run for a new prompt. `at` is ms after submit. */
export function buildRun(prompt: string, repo: string, n: number): RunAction[] {
  const name = repo.split('/')[1]
  const cwd = `~/repos/${name}`
  const p = `r${n}`
  const lower = prompt.toLowerCase()
  const topic = lower.includes('dark') ? 'dark mode' : lower.includes('test') ? 'tests' : lower.includes('bug') || lower.includes('fix') ? 'the fix' : 'the change'
  const branch = `devin/${slugify(titleFromPrompt(prompt)).slice(0, 24)}`
  const intro = `Got it. I'll work in \`${repo}\` and keep ${topic} small and reviewable. Here's the plan:`
  const actions: RunAction[] = [
    { at: 0, type: 'status', status: 'running' },
    { at: 450, type: 'event', event: { kind: 'devin', id: `${p}-intro`, md: '', streaming: true } },
  ]
  const words = intro.split(' ')
  words.forEach((_, i) => {
    actions.push({ at: 500 + i * 45, type: 'stream', id: `${p}-intro`, md: words.slice(0, i + 1).join(' '), done: i === words.length - 1 })
  })
  let t = 500 + words.length * 45 + 200
  actions.push({
    at: t,
    type: 'event',
    event: {
      kind: 'plan',
      id: `${p}-plan`,
      items: [
        { text: `Clone ${repo} and install dependencies`, done: false },
        { text: 'Find the relevant code and reproduce', done: false },
        { text: 'Implement the change with tests', done: false },
        { text: 'Run the full suite and open a PR', done: false },
      ],
    },
  })
  t += 500
  actions.push({ at: t, type: 'event', event: { kind: 'work', id: `${p}-work`, seconds: 0, open: true, active: true, steps: [] } })
  const shellStep = (id: string, cmd: string, lines: string[], exit = 0, gap = 160) => {
    t += 300
    actions.push({ at: t, type: 'step', workId: `${p}-work`, step: { kind: 'shell', id, cmd, output: '', cwd, running: true } })
    lines.forEach((_, i) => {
      t += gap
      actions.push({ at: t, type: 'shell-output', workId: `${p}-work`, stepId: id, output: lines.slice(0, i + 1).join('\n'), exit: i === lines.length - 1 ? exit : undefined })
    })
  }
  shellStep(`${p}-s1`, `git clone git@github.com:${repo}.git && cd ${name}`, [
    `Cloning into '${name}'...`,
    'remote: Enumerating objects: 23104, done.',
    'Receiving objects: 100% (23104/23104), 14.2 MiB | 31.0 MiB/s, done.',
    'Resolving deltas: 100% (15872/15872), done.',
  ])
  actions.push({ at: t + 100, type: 'plan-done', id: `${p}-plan`, index: 0 })
  shellStep(`${p}-s2`, 'pnpm install --frozen-lockfile', [
    'Lockfile is up to date, resolution step is skipped',
    'Packages: +1094',
    'Progress: resolved 1094, reused 1094, downloaded 0, added 1094, done',
    'Done in 7.9s',
  ], 0, 220)
  shellStep(`${p}-s3`, `rg -n "theme|colorScheme" src --type ts | head`, [
    'src/theme/tokens.ts:4:export const colorScheme = "light"',
    'src/theme/ThemeProvider.tsx:12:  const [scheme] = useState(colorScheme)',
    'src/components/Header.tsx:31:  <ThemeToggle disabled />',
  ])
  actions.push({ at: t + 100, type: 'plan-done', id: `${p}-plan`, index: 1 })
  t += 500
  actions.push({
    at: t,
    type: 'step',
    workId: `${p}-work`,
    step: {
      kind: 'edit',
      id: `${p}-e1`,
      path: 'src/theme/ThemeProvider.tsx',
      additions: 9,
      deletions: 2,
      patch: `diff --git a/src/theme/ThemeProvider.tsx b/src/theme/ThemeProvider.tsx
--- a/src/theme/ThemeProvider.tsx
+++ b/src/theme/ThemeProvider.tsx
@@ -9,8 +9,15 @@ import { colorScheme } from './tokens'
 export function ThemeProvider({ children }: { children: ReactNode }) {
-  const [scheme] = useState(colorScheme)
-  return <ThemeContext.Provider value={scheme}>{children}</ThemeContext.Provider>
+  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
+  const [scheme, setScheme] = useLocalStorage<'light' | 'dark'>(
+    'theme',
+    prefersDark ? 'dark' : colorScheme,
+  )
+  useEffect(() => {
+    document.documentElement.dataset.theme = scheme
+  }, [scheme])
+  return <ThemeContext.Provider value={{ scheme, setScheme }}>{children}</ThemeContext.Provider>
 }
`,
    },
  })
  actions.push({ at: t + 200, type: 'plan-done', id: `${p}-plan`, index: 2 })
  shellStep(`${p}-s4`, 'pnpm test', [
    ' RUN  v2.1.4 ' + cwd,
    ' ✓ src/theme/ThemeProvider.test.tsx (6 tests) 88ms',
    ' ✓ src/components/Header.test.tsx (11 tests) 142ms',
    ' ✓ src/routes/settings.test.tsx (9 tests) 201ms',
    '',
    ' Test Files  27 passed (27)',
    '      Tests  318 passed (318)',
    '   Duration  9.41s',
  ], 0, 180)
  t += 400
  actions.push({
    at: t,
    type: 'step',
    workId: `${p}-work`,
    step: { kind: 'browser', id: `${p}-b1`, url: 'http://localhost:5173/settings', title: `${name} · Settings`, note: 'Toggled the theme, reloaded, and confirmed the choice persists and matches the OS setting on first visit.' },
  })
  t += 600
  actions.push({ at: t, type: 'plan-done', id: `${p}-plan`, index: 3 })
  actions.push({ at: t, type: 'work-done', workId: `${p}-work` })
  const outro = `Done: "${titleFromPrompt(prompt).replace(/…$/, '')}" is implemented on \`${branch}\`.\n\n- Reads the OS preference on first load, then remembers the user's choice\n- 318 tests pass, including 6 new ones for the provider\n- Verified in the browser at \`/settings\``
  actions.push({ at: t + 200, type: 'event', event: { kind: 'devin', id: `${p}-outro`, md: '', streaming: true } })
  const outroWords = outro.split(' ')
  outroWords.forEach((_, i) => {
    actions.push({ at: t + 250 + i * 35, type: 'stream', id: `${p}-outro`, md: outroWords.slice(0, i + 1).join(' '), done: i === outroWords.length - 1 })
  })
  t += 250 + outroWords.length * 35 + 300
  actions.push({
    at: t,
    type: 'event',
    event: {
      kind: 'pr',
      id: `${p}-pr`,
      repo,
      number: 1300 + n,
      title: titleFromPrompt(prompt).replace(/…$/, ''),
      branch,
      additions: 87,
      deletions: 12,
      files: 5,
      state: 'open',
      checks: [
        { name: 'ci / test', state: 'pending', detail: 'Running' },
        { name: 'ci / lint', state: 'pending', detail: 'Queued' },
        { name: 'Devin Review', state: 'pending', detail: 'Reviewing' },
      ],
    },
  })
  actions.push({ at: t + 900, type: 'check', prId: `${p}-pr`, index: 1, state: 'pass', detail: '36s' })
  actions.push({ at: t + 1600, type: 'check', prId: `${p}-pr`, index: 2, state: 'pass', detail: 'No issues' })
  actions.push({ at: t + 2300, type: 'check', prId: `${p}-pr`, index: 0, state: 'pass', detail: '2m 48s' })
  actions.push({ at: t + 2400, type: 'status', status: 'finished' })
  return actions
}

/** Short follow-up run when a message is sent inside an existing session. */
export function buildFollowUp(prompt: string, s: Session, n: number): RunAction[] {
  const p = `f${n}`
  const name = s.repo.split('/')[1]
  const reply = `Sure. I'll ${prompt.replace(/[.?!]+$/, '').toLowerCase().startsWith('can you') ? prompt.replace(/^can you /i, '').replace(/[.?!]+$/, '') : 'take care of that'} on \`${s.branch}\` and push to the same PR.`
  const actions: RunAction[] = [
    { at: 0, type: 'status', status: 'running' },
    { at: 400, type: 'event', event: { kind: 'devin', id: `${p}-r`, md: '', streaming: true } },
  ]
  const words = reply.split(' ')
  words.forEach((_, i) => actions.push({ at: 450 + i * 45, type: 'stream', id: `${p}-r`, md: words.slice(0, i + 1).join(' '), done: i === words.length - 1 }))
  let t = 450 + words.length * 45 + 300
  actions.push({ at: t, type: 'event', event: { kind: 'work', id: `${p}-w`, seconds: 0, open: true, active: true, steps: [] } })
  const lines = [' RUN  v2.1.4 ~/repos/' + name, ' ✓ 41 test files', '', ' Tests  412 passed (412)', '   Duration  11.2s']
  t += 300
  actions.push({ at: t, type: 'step', workId: `${p}-w`, step: { kind: 'shell', id: `${p}-s`, cmd: 'pnpm test && git push', output: '', cwd: `~/repos/${name}`, running: true } })
  lines.forEach((_, i) => {
    t += 220
    actions.push({ at: t, type: 'shell-output', workId: `${p}-w`, stepId: `${p}-s`, output: lines.slice(0, i + 1).join('\n'), exit: i === lines.length - 1 ? 0 : undefined })
  })
  t += 400
  actions.push({ at: t, type: 'work-done', workId: `${p}-w` })
  actions.push({ at: t + 100, type: 'event', event: { kind: 'devin', id: `${p}-d`, md: 'Pushed. All checks are green again.' } })
  actions.push({ at: t + 200, type: 'status', status: 'finished' })
  return actions
}
