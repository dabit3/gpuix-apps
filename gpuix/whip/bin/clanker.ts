#!/usr/bin/env bun
import { runClanker } from '../src/clanker'

const args = process.argv.slice(2)
if (args[0] === '-h' || args[0] === '--help') {
  console.log('clanker [task]  a fake coding agent that streams pretend work; Esc interrupts it')
  process.exit(0)
}
runClanker(args.join(' ') || undefined)
