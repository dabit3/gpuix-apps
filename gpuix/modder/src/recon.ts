// recon: identify a game's engine and its modding route from the install directory alone.
// Adapters only look at file names and small text files; nothing is executed or modified.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

export type Risk = 'ok' | 'caution' | 'refuse'
export interface Recon {
  path: string
  name: string
  engine: string
  engineId: string
  version: string | null
  runtime: string
  framework: string
  route: string
  data: string[]
  saves: string[]
  evidence: string[]
  risk: Risk
  notes: string[]
  supported: boolean   // modder can run every step for this engine on this machine
  plan: string[]       // what setup-framework / write-mod would do
}

export interface Adapter { id: string; detect(ix: Index): Omit<Recon, 'path' | 'name' | 'risk' | 'notes'> & { notes?: string[] } | null }

export class Index {
  files: string[] = []
  constructor(public root: string, maxDepth = 4) {
    const walk = (d: string, depth: number) => {
      if (depth > maxDepth || this.files.length > 5000) return
      for (const n of readdirSync(d)) {
        if (n === 'node_modules' || n === '.git') continue
        const p = join(d, n)
        const st = statSync(p)
        const rel = relative(root, p)
        if (st.isDirectory()) { this.files.push(rel + '/'); walk(p, depth + 1) } else this.files.push(rel)
      }
    }
    walk(root, 0)
  }
  find(re: RegExp) { return this.files.filter((f) => re.test(f)) }
  has(re: RegExp) { return this.files.some((f) => re.test(f)) }
  read(rel: string) { try { return readFileSync(join(this.root, rel), 'utf8') } catch { return '' } }
}

const ev = (ix: Index, re: RegExp, why: string) => ix.find(re).slice(0, 2).map((f) => `${f} → ${why}`)

export const ADAPTERS: Adapter[] = [
  { id: 'grovekeep', detect(ix) {
    if (!ix.has(/^modding\.json$/)) return null
    const m = JSON.parse(ix.read('modding.json') || '{}')
    if (!m.engine) return null
    return { engine: 'Grovekeep (TypeScript engine)', engineId: 'grovekeep', version: m.engineVersion ?? null, runtime: `${m.runtime ?? 'bun'} · ${m.language ?? 'typescript'}`, framework: `Official mod API v${m.modApi}`, route: 'Mod bundles in a profile folder: <profile>/mods/<id>/manifest.json + mod.js, hot-reloaded', data: ['assets/sprites.json'], saves: ['~/Library/Application Support/grovekeep'], evidence: [`modding.json → engine "${m.engine}", mod API v${m.modApi}`, ...ev(ix, /^engine\.ts$/, 'hook emit sites'), ...ev(ix, /^modapi\.ts$/, 'typed mod API')], supported: true, notes: m.network === false ? ['No network code, single-player only.'] : [], plan: ['recon.json', 'hooks.md from engine.ts emit() sites', 'mod project from a template', 'Bun.build bundle → profile/mods/<id>', 'launch with --profile, tail logs/latest.log'] }
  } },
  { id: 'unity-il2cpp', detect(ix) {
    if (!ix.has(/(^|\/)GameAssembly\.dll$/) || !ix.has(/global-metadata\.dat$/)) return null
    const ver = ix.read(ix.find(/UnityPlayer\.version$|unity_version\.txt$/)[0] ?? '').trim() || null
    return { engine: 'Unity (IL2CPP)', engineId: 'unity-il2cpp', version: ver, runtime: 'IL2CPP native', framework: 'BepInEx 6 (IL2CPP) or MelonLoader', route: 'Il2CppInterop proxies + Harmony patches in a BepInEx 6 plugin', data: ix.find(/_Data\/$/).slice(0, 1), saves: ['%USERPROFILE%/AppData/LocalLow/<Company>/<Game>'], evidence: [...ev(ix, /GameAssembly\.dll$/, 'IL2CPP build'), ...ev(ix, /global-metadata\.dat$/, 'IL2CPP metadata')], supported: false, plan: ['Copy the install to a mod profile', 'Install BepInEx 6 IL2CPP build into the copy', 'Run once to generate interop assemblies, check BepInEx/LogOutput.log', 'Scaffold a BepInEx 6 plugin csproj with Harmony patches', 'dotnet build → BepInEx/plugins/<id>.dll'] }
  } },
  { id: 'unity-mono', detect(ix) {
    if (!ix.has(/_Data\/Managed\/Assembly-CSharp\.dll$/)) return null
    return { engine: 'Unity (Mono)', engineId: 'unity-mono', version: null, runtime: 'Mono / .NET', framework: 'BepInEx 5 + Harmony', route: 'BepInEx 5 plugin with Harmony patches; decompile Assembly-CSharp locally with ilspycmd to find hooks', data: ix.find(/_Data\/$/).slice(0, 1), saves: ['%USERPROFILE%/AppData/LocalLow/<Company>/<Game>'], evidence: ev(ix, /Assembly-CSharp\.dll$/, 'Mono scripting backend'), supported: false, plan: ['Copy the install to a mod profile', 'Install BepInEx 5 (winhttp.dll doorstop) into the copy', 'Check BepInEx/LogOutput.log for "Chainloader started"', 'ilspycmd Assembly-CSharp.dll → workspace/decomp (gitignored), index player/stat/UI classes', 'Scaffold a BepInEx 5 plugin + Harmony patch, dotnet build → BepInEx/plugins'] }
  } },
  { id: 'unreal', detect(ix) {
    const pak = ix.find(/Content\/Paks\/[^/]+\.pak$/)
    const exe = ix.find(/-Win64-Shipping\.exe$/)
    if (!pak.length && !exe.length) return null
    const ue5 = ix.has(/\.utoc$/)
    return { engine: ue5 ? 'Unreal Engine 5' : 'Unreal Engine 4', engineId: 'unreal', version: ue5 ? '5.x (IoStore .utoc)' : '4.x', runtime: 'Native C++ / Blueprint', framework: 'UE4SS (Lua + Blueprint mods), pak mods', route: 'UE4SS Lua mod in Binaries/Win64/Mods/<id>/Scripts/main.lua, or a ~mods pak', data: pak.slice(0, 1), saves: ['%LOCALAPPDATA%/<Project>/Saved/SaveGames'], evidence: [...pak.slice(0, 1).map((f) => `${f} → pak archive`), ...exe.slice(0, 1).map((f) => `${f} → shipping build`)], supported: false, plan: ['Copy Binaries/Win64 to a mod profile', 'Install UE4SS, check UE4SS.log', 'Dump the object tree with UE4SS (live, local)', 'Write a Lua mod under Mods/<id>/Scripts/main.lua', 'Enable it in mods.txt'] }
  } },
  { id: 'tmodloader', detect(ix) {
    if (!ix.has(/(^|\/)Terraria\.exe$/)) return null
    return { engine: 'XNA / FNA (Terraria)', engineId: 'tmodloader', version: null, runtime: '.NET (FNA)', framework: 'tModLoader', route: 'tModLoader C# mod: ModItem / ModProjectile / ModNPC, built in-game', data: ['Content/'], saves: ['~/Documents/My Games/Terraria/tModLoader'], evidence: ev(ix, /Terraria\.exe$/, 'Terraria install → tModLoader route'), supported: false, plan: ['Install tModLoader from Steam (separate app, clean install untouched)', 'Mod Sources/<Id>: ModItem sword + ModProjectile + 32x32 sprite', 'Build + reload from the Workshop > Develop Mods menu', 'Add a debug command to spawn the item, check client.log'] }
  } },
  { id: 'monogame', detect(ix) {
    const f = ix.find(/(^|\/)(MonoGame\.Framework|FNA)\.dll$/)
    if (!f.length) return null
    return { engine: 'MonoGame / FNA', engineId: 'monogame', version: null, runtime: '.NET', framework: 'Harmony via a loader (game-specific), or the game\'s own mod folder', route: 'Check for an official mod folder first; otherwise a Harmony loader in a copy', data: ['Content/'], saves: [], evidence: f.slice(0, 1).map((x) => `${x} → XNA-style framework`), supported: false, plan: ['Look for an official mod loader', 'Decompile locally with ilspycmd to find hooks', 'Harmony patch DLL loaded by the community loader'] }
  } },
  { id: 'godot', detect(ix) {
    const pck = ix.find(/\.pck$/)
    if (!pck.length && !ix.has(/^project\.godot$/)) return null
    return { engine: 'Godot', engineId: 'godot', version: null, runtime: 'GDScript', framework: 'Godot Mod Loader (where supported) / GDRE tools for inspection', route: 'Mod pck or Godot Mod Loader script extension', data: pck.slice(0, 1), saves: ['~/Library/Application Support/Godot/app_userdata/<Game>'], evidence: pck.slice(0, 1).map((x) => `${x} → Godot pack`), supported: false, plan: ['Inspect the pck with GDRE tools (read-only, local)', 'Check whether the game ships Godot Mod Loader', 'Write a script-extension mod as a separate pck'] }
  } },
  { id: 'rpgmaker', detect(ix) {
    const mz = ix.find(/(^|\/)js\/rmmz_core\.js$/), mv = ix.find(/(^|\/)js\/rpg_core\.js$/)
    if (!mz.length && !mv.length) return null
    return { engine: mz.length ? 'RPG Maker MZ' : 'RPG Maker MV', engineId: 'rpgmaker', version: mz.length ? 'MZ' : 'MV', runtime: 'NW.js · JavaScript', framework: 'Plugin (js/plugins/*.js + plugins.js)', route: 'A JS plugin registered in js/plugins.js', data: ['data/*.json'], saves: ['save/'], evidence: [...mz, ...mv].slice(0, 1).map((x) => `${x} → RPG Maker core`), supported: false, plan: ['Copy www/ to a mod profile', 'Add js/plugins/<Id>.js and register it in plugins.js', 'Launch NW.js with the profile, check the dev console'] }
  } },
  { id: 'renpy', detect(ix) {
    if (!ix.has(/(^|\/)renpy\/$/) && !ix.has(/\.rpa$/)) return null
    return { engine: "Ren'Py", engineId: 'renpy', version: null, runtime: 'Python', framework: 'game/*.rpy overrides', route: 'A new .rpy file in game/ (loaded alongside the archives)', data: ix.find(/\.rpa$/).slice(0, 1), saves: ['~/Library/RenPy/<game>'], evidence: [...ev(ix, /renpy\/$/, "Ren'Py runtime"), ...ev(ix, /\.rpa$/, 'archive')], supported: false, plan: ['Write game/zz_<id>.rpy in a copy', 'Use config.label_overrides / screens for UI', 'Launch with the copy, check log.txt'] }
  } },
  { id: 'gamemaker', detect(ix) {
    if (!ix.has(/(^|\/)data\.win$/)) return null
    return { engine: 'GameMaker', engineId: 'gamemaker', version: null, runtime: 'GML bytecode / YYC', framework: 'UndertaleModTool (data.win patch in a copy)', route: 'Script patch applied to a copied data.win, never the original', data: ['data.win'], saves: ['%LOCALAPPDATA%/<Game>'], evidence: ev(ix, /data\.win$/, 'GameMaker runner data'), notes: ['No official loader: patches must stay in a copy.'], supported: false, plan: ['Copy the install', 'Open the copied data.win in UndertaleModTool (local)', 'Apply a scripted patch, run the copy'] }
  } },
  { id: 'source', detect(ix) {
    if (!ix.has(/(^|\/)gameinfo\.txt$/) && !ix.has(/\.vpk$/)) return null
    const gold = ix.has(/(^|\/)hl\.exe$/)
    return { engine: gold ? 'GoldSrc' : 'Source', engineId: 'source', version: null, runtime: 'Native C++', framework: gold ? 'Mod folder + liblist.gam' : 'Addon / custom folder (gameinfo.txt search paths)', route: 'Content in custom/<id>/ or a separate mod folder', data: ix.find(/\.vpk$/).slice(0, 1), saves: ['<game>/save'], evidence: [...ev(ix, /gameinfo\.txt$/, 'Source game info'), ...ev(ix, /\.vpk$/, 'VPK archive')], supported: false, plan: ['Create custom/<id>/ with scripts/materials', 'Launch with -console, check console.log'] }
  } },
  { id: 'aoe2de', detect(ix) {
    if (!ix.has(/(^|\/)AoE2DE_s\.exe$/)) return null
    return { engine: 'Age of Empires II DE (Genie, custom)', engineId: 'aoe2de', version: null, runtime: 'Native', framework: 'Official mods folder (data mods)', route: 'Local data mod in the user mods folder (resources/_common/dat via the official mod system)', data: ['resources/_common/dat/'], saves: ['%USERPROFILE%/Games/Age of Empires 2 DE/<id>/savegame'], evidence: ev(ix, /AoE2DE_s\.exe$/, 'AoE2 DE executable'), notes: ['Use data mods for single-player/scenario play only.'], supported: false, plan: ['Create mods/local/<id>/resources/_common/dat', 'Edit a copy of empires2_x2_p1.dat (new unit variant)', 'Enable the local mod in the in-game mod manager'] }
  } },
  { id: 'love2d', detect(ix) {
    if (!ix.has(/\.love$/) && !(ix.has(/^main\.lua$/) && ix.has(/^conf\.lua$/))) return null
    return { engine: 'LÖVE (Love2D)', engineId: 'love2d', version: null, runtime: 'Lua', framework: 'Source mod (Lua) in a copy, or the game\'s mod folder', route: 'Lua override loaded before main.lua in a copied .love', data: ix.find(/\.love$/).slice(0, 1), saves: ['~/Library/Application Support/LOVE/<game>'], evidence: [...ev(ix, /\.love$/, 'LÖVE archive'), ...ev(ix, /^main\.lua$/, 'LÖVE entry')], supported: false, plan: ['Unzip a copy of the .love', 'Add mods/<id>.lua required from main.lua', 'Run love on the copy'] }
  } },
]

const ANTICHEAT = /(^|\/)(EasyAntiCheat|BattlEye|EAC|vgk|PunkBuster)[^/]*\/?$/i

export function recon(dir: string): Recon {
  const ix = new Index(dir)
  const name = basename(dir)
  const notes: string[] = []
  let risk: Risk = 'ok'
  const ac = ix.find(ANTICHEAT)
  if (ac.length) { risk = 'refuse'; notes.push(`Anti-cheat present (${ac[0]}). modder will not set up a loader for this install.`) }
  if (ix.has(/(^|\/)steam_api64?\.dll$/) && risk !== 'refuse') notes.push('Steam build: mod a copy or a mod profile, never the Steam folder.')
  for (const a of ADAPTERS) {
    const r = a.detect(ix)
    if (!r) continue
    if (risk === 'ok' && !r.supported) risk = 'caution'
    return { path: dir, name, risk, notes: [...(r.notes ?? []), ...notes], ...r, supported: r.supported && risk !== 'refuse', plan: risk === 'refuse' ? ['Refused: anti-cheat / online protection detected.'] : r.plan }
  }
  return { path: dir, name, engine: 'Unknown', engineId: 'unknown', version: null, runtime: 'unknown', framework: 'none found', route: 'No known modding route. Add an adapter in src/recon.ts.', data: [], saves: [], evidence: [`${ix.files.length} files scanned, no adapter matched`], risk: risk === 'refuse' ? 'refuse' : 'caution', notes, supported: false, plan: [] }
}

// A target can be a game folder, or a folder of game folders (e.g. fixtures/).
export function expandTargets(paths: string[]): string[] {
  const out: string[] = []
  for (const p of paths) {
    if (!existsSync(p) || !statSync(p).isDirectory()) continue
    const kids = readdirSync(p).map((n) => join(p, n)).filter((k) => statSync(k).isDirectory()).sort()
    const games = kids.filter((k) => { const r = recon(k); return r.engineId !== 'unknown' || r.risk === 'refuse' })
    if (games.length >= 2 && recon(p).engineId !== 'grovekeep') out.push(...games)
    else out.push(p)
  }
  return out
}
