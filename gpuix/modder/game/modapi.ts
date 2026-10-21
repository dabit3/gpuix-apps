// The Grovekeep mod API. Mods are single ES modules that export `default (api: ModApi) => void`.
// They load from <profile>/mods/<id>/manifest.json, never from the game's own files.

export interface ProjectileDef {
  speed: number      // px/s
  count: number      // projectiles per swing
  spread: number     // degrees between projectiles
  color: string      // #rrggbb core colour
  glow: number       // glow radius in px
  trail: number      // trail length in samples
  pierce: number     // enemies a projectile passes through
  life: number       // seconds
  damage: number
}

export interface WeaponDef {
  id: string
  name: string
  damage: number
  cooldown: number   // seconds between swings
  arc?: string       // swing arc colour
  sprite?: { rows: string[]; keys: Record<string, string> }
  projectile?: ProjectileDef
}

export interface EnemyDef {
  id: string
  name: string
  hp: number
  speed: number      // hop strength multiplier, 1 = base slime
  size: number       // 1 = base slime, 2 = double
  weight: number     // spawn weight against the base slime (1)
  colors: { body: string; shade: string; light: string }
}

export interface GameView {
  readonly time: number
  readonly kills: number
  readonly enemies: number
  readonly projectiles: number
  readonly player: { x: number; y: number; hp: number; weapon: string }
}

export type HookName = 'init' | 'tick' | 'swing' | 'hit' | 'kill' | 'spawn' | 'key' | 'faint'

export interface ModApi {
  readonly id: string
  readonly game: GameView
  tune: { playerSpeed: number; spawnInterval: number; maxEnemies: number }
  log(msg: string): void
  on(hook: HookName, fn: (payload: any) => void): void
  registerWeapon(def: WeaponDef): void
  registerEnemy(def: EnemyDef): void
  give(weaponId: string): void
  spawn(enemyId: string, count?: number): void
  setHud(lines: string[]): void
}
