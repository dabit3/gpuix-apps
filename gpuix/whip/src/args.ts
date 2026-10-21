export interface CliArgs {
  mode: 'gui' | 'leash' | 'help' | 'version'
  command: string[]
  targets: string[]
  armed: boolean
  polite?: boolean
  sound?: boolean
  length?: number
  intro: boolean
}

export const HELP = `whip — a physics whip for terminal coding agents, painted inside Ghostty

usage
  whip                     open the whip in this pane (kitty or Ghostty)
  whip -- <agent command>  run an agent on a leash so whip panes can nudge it
  whip --target <path>     also nudge a leash socket or append to a file

options
  -a, --armed              start armed (default: disarmed, cracks send nothing)
  --spicy                  "FASTER" messages instead of polite ones
  --mute                   no crack sound
  -l, --length <px>        whip length (default 420)
  --intro                  show the first-run explanation again
  -h, --help               this help

keys (in the whip)
  a arm/disarm · p polite/spicy · s sound · [ ] length · t next target
  l event log · ctrl-c quit

When armed, a crack sends exactly Esc, one message and Enter to a leashed agent,
at most once every 2 seconds. Nothing else, nowhere else. Local only, no network.`

export function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { mode: 'gui', command: [], targets: [], armed: false, intro: false }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === '--') {
      a.mode = 'leash'
      a.command = argv.slice(i + 1)
      break
    }
    if (v === 'leash') {
      a.mode = 'leash'
      a.command = argv.slice(argv[i + 1] === '--' ? i + 2 : i + 1)
      break
    }
    if (v === '-h' || v === '--help') a.mode = 'help'
    else if (v === '-v' || v === '--version') a.mode = 'version'
    else if (v === '-a' || v === '--armed') a.armed = true
    else if (v === '--spicy') a.polite = false
    else if (v === '--polite') a.polite = true
    else if (v === '--mute') a.sound = false
    else if (v === '--intro') a.intro = true
    else if (v === '-t' || v === '--target') a.targets.push(argv[++i] ?? '')
    else if (v === '-l' || v === '--length') a.length = Number(argv[++i])
    else if (!v.startsWith('-')) {
      // Bun strips the first `--`, so `whip -- claude` arrives as `claude`.
      a.mode = 'leash'
      a.command = argv.slice(i)
      break
    } else a.mode = 'help'
  }
  a.targets = a.targets.filter(Boolean)
  if (a.length !== undefined && !(a.length > 0)) a.length = undefined
  return a
}
