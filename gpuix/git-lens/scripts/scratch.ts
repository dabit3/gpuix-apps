// Creates a throwaway repo with a merged branch and two unstaged hunks, for trying staging and commits.
// Usage: bun run scratch [dir]
import { resolve } from 'node:path'
import { makeScratchRepo } from '../test/scratch'

console.log(makeScratchRepo(process.argv[2] ? resolve(process.argv[2]) : undefined))
