import { describe, expect, test } from 'bun:test'
import * as G from '../src/git'
import { buildGraph } from '../src/graph'
import { buildTree, filterCommits, toSplitRows } from '../src/format'
import { makeScratchRepo, sh } from './scratch'

describe('git layer', () => {
  test('reads history, merge lanes, details and blame from a real repo', async () => {
    const repo = makeScratchRepo()
    const commits = await G.log(repo, 'HEAD')
    expect(commits.map((c) => c.subject)).toEqual(['Merge branch feature/search', 'Add search helper', 'Document the scratch repo', 'Initial commit'])
    expect(commits[0].parents).toHaveLength(2)
    const graph = buildGraph(commits)
    expect(graph.width).toBe(2)
    expect(graph.rows[0].bottom.some((e) => e.from !== e.to)).toBe(true)
    expect(graph.rows[2].bottom.some((e) => e.from !== e.to)).toBe(true)
    expect(filterCommits(commits, 'search').map((i) => commits[i].subject)).toEqual(['Merge branch feature/search', 'Add search helper'])
    expect(filterCommits(commits, commits[2].sha.slice(0, 7))).toEqual([2])
    expect(filterCommits(commits, 'ADA')).toHaveLength(4)

    const detail = await G.commitDetail(repo, commits[1].sha)
    expect(detail.files).toEqual([{ path: 'src/search.ts', oldPath: undefined, status: 'A', additions: 1, deletions: 0, binary: false }])
    const patch = await G.commitFileDiff(repo, detail, detail.files[0])
    expect(patch).toContain('+export const search')
    expect(toSplitRows(patch).filter((r) => r.right?.type === 'add')).toHaveLength(1)
    expect(buildTree(detail.files, new Set()).map((r) => r.name)).toEqual(['src', 'search.ts'])

    const blame = await G.blame(repo, 'HEAD', 'README.md')
    expect(blame.map((l) => l.summary)).toEqual(['Initial commit', 'Initial commit', 'Initial commit', 'Document the scratch repo', 'Document the scratch repo'])
  })

  test('stages a single hunk, unstages it, then commits', async () => {
    const repo = makeScratchRepo()
    const [entry] = await G.status(repo)
    expect(entry).toMatchObject({ path: 'src/app.ts', staged: null, unstaged: 'M' })
    const parsed = G.splitPatch(await G.workingDiff(repo, entry, false))
    expect(parsed.hunks).toHaveLength(2)

    await G.applyHunk(repo, parsed, parsed.hunks[1], false)
    expect(sh(repo, 'diff', '--cached')).toContain('second hunk')
    expect(sh(repo, 'diff', '--cached')).not.toContain('first hunk')
    expect(sh(repo, 'diff')).toContain('first hunk')

    const stagedPatch = G.splitPatch(await G.workingDiff(repo, (await G.status(repo))[0], true))
    await G.applyHunk(repo, stagedPatch, stagedPatch.hunks[0], true)
    expect(sh(repo, 'diff', '--cached')).toBe('')

    await G.stageFile(repo, 'src/app.ts')
    const sha = await G.commit(repo, 'Tune values')
    expect(sh(repo, 'log', '-1', '--format=%H %s').trim()).toBe(`${sha} Tune values`)
    expect(await G.status(repo)).toEqual([])
  })
})
