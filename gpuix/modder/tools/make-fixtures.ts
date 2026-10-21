// Creates the fake install folders under fixtures/ (empty files, names only). Re-run to refresh.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const FIXTURES: Record<string, { files: string[]; expect: string; risk?: string }> = {
  'unity-mono-indie': { expect: 'unity-mono', files: ['LanternKeeper.exe', 'LanternKeeper_Data/Managed/Assembly-CSharp.dll', 'LanternKeeper_Data/Managed/UnityEngine.dll', 'UnityPlayer.dll', 'steam_api64.dll'] },
  'unity-il2cpp-roguelite': { expect: 'unity-il2cpp', files: ['Rogue.exe', 'GameAssembly.dll', 'Rogue_Data/il2cpp_data/Metadata/global-metadata.dat', 'UnityPlayer.dll'] },
  'unreal-ue5-adventure': { expect: 'unreal', files: ['Adventure/Binaries/Win64/Adventure-Win64-Shipping.exe', 'Adventure/Content/Paks/Adventure-Windows.pak', 'Adventure/Content/Paks/Adventure-Windows.utoc'] },
  'terraria-xna': { expect: 'tmodloader', files: ['Terraria.exe', 'FNA.dll', 'Content/Images/Item_1.xnb'] },
  'monogame-farm': { expect: 'monogame', files: ['Farm.exe', 'MonoGame.Framework.dll', 'Content/sprites.xnb'] },
  'godot-platformer': { expect: 'godot', files: ['Platformer.exe', 'Platformer.pck'] },
  'rpgmaker-mz-quest': { expect: 'rpgmaker', files: ['Game.exe', 'js/rmmz_core.js', 'js/plugins.js', 'data/Actors.json'] },
  'renpy-novel': { expect: 'renpy', files: ['Novel.exe', 'renpy/__init__.py', 'game/archive.rpa'] },
  'gamemaker-runner': { expect: 'gamemaker', files: ['Runner.exe', 'data.win', 'options.ini'] },
  'source-hl2-mod': { expect: 'source', files: ['hl2.exe', 'hl2/gameinfo.txt', 'hl2/hl2_misc_dir.vpk'] },
  'aoe2de-custom': { expect: 'aoe2de', files: ['AoE2DE_s.exe', 'resources/_common/dat/empires2_x2_p1.dat'] },
  'love2d-jam': { expect: 'love2d', files: ['jam.love'] },
  'online-shooter-eac': { expect: 'unreal', risk: 'refuse', files: ['Shooter/Binaries/Win64/Shooter-Win64-Shipping.exe', 'Shooter/Content/Paks/Shooter.pak', 'EasyAntiCheat/EasyAntiCheat_Setup.exe'] },
}

export function makeFixtures(root: string) {
  for (const [name, f] of Object.entries(FIXTURES)) for (const rel of f.files) {
    const p = join(root, name, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, '')
  }
}

if (import.meta.main) { makeFixtures(join(import.meta.dir, '..', 'fixtures')); console.log('fixtures written') }
