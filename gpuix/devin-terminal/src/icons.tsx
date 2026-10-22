/** @jsxImportSource #zoom */
import iconCompose from '../assets/icons/square-pen.svg' with { type: 'text' }
import iconSearch from '../assets/icons/search.svg' with { type: 'text' }
import iconPanelRight from '../assets/icons/panel-right.svg' with { type: 'text' }
import iconFolder from '../assets/icons/folder.svg' with { type: 'text' }
import iconSettings from '../assets/icons/settings.svg' with { type: 'text' }
import iconGitBranch from '../assets/icons/git-branch.svg' with { type: 'text' }
import iconLaptop from '../assets/icons/laptop.svg' with { type: 'text' }
import iconList from '../assets/icons/list.svg' with { type: 'text' }
import iconZap from '../assets/icons/zap.svg' with { type: 'text' }
import iconPencil from '../assets/icons/pencil.svg' with { type: 'text' }
import iconChevronDown from '../assets/icons/chevron-down.svg' with { type: 'text' }
import iconChevronRight from '../assets/icons/chevron-right.svg' with { type: 'text' }
import iconSparkle from '../assets/icons/sparkle.svg' with { type: 'text' }
import iconWrench from '../assets/icons/wrench.svg' with { type: 'text' }
import iconSend from '../assets/icons/arrow-up.svg' with { type: 'text' }
import iconCheck from '../assets/icons/check.svg' with { type: 'text' }
import iconShare from '../assets/icons/share.svg' with { type: 'text' }
import iconMore from '../assets/icons/ellipsis.svg' with { type: 'text' }
import iconLibrary from '../assets/icons/library.svg' with { type: 'text' }
import iconSliders from '../assets/icons/sliders-horizontal.svg' with { type: 'text' }
import iconArrowLeft from '../assets/icons/arrow-left.svg' with { type: 'text' }
import iconArrowRight from '../assets/icons/arrow-right.svg' with { type: 'text' }
import iconRetry from '../assets/icons/rotate-ccw.svg' with { type: 'text' }
import icon_plus from '../assets/icons/plus.svg' with { type: 'text' }
import icon_clock from '../assets/icons/clock-3.svg' with { type: 'text' }
import icon_shield from '../assets/icons/shield-check.svg' with { type: 'text' }
import icon_pr from '../assets/icons/git-pull-request.svg' with { type: 'text' }
import icon_shapes from '../assets/icons/shapes.svg' with { type: 'text' }
import icon_bell from '../assets/icons/bell.svg' with { type: 'text' }
import icon_help from '../assets/icons/circle-help.svg' with { type: 'text' }
import icon_mic from '../assets/icons/mic.svg' with { type: 'text' }
import icon_wave from '../assets/icons/audio-lines.svg' with { type: 'text' }
import icon_slash from '../assets/icons/square-slash.svg' with { type: 'text' }
import icon_settings2 from '../assets/icons/settings-2.svg' with { type: 'text' }
import icon_sun from '../assets/icons/sun.svg' with { type: 'text' }
import icon_moon from '../assets/icons/moon.svg' with { type: 'text' }
import icon_listChecks from '../assets/icons/list-checks.svg' with { type: 'text' }
import icon_listFilter from '../assets/icons/list-filter.svg' with { type: 'text' }
import icon_panelLeft from '../assets/icons/panel-left.svg' with { type: 'text' }
import icon_merge from '../assets/icons/git-merge.svg' with { type: 'text' }
import icon_link from '../assets/icons/link.svg' with { type: 'text' }
import icon_monitor from '../assets/icons/monitor.svg' with { type: 'text' }
import icon_devin from '../assets/icons/devin-mark.svg' with { type: 'text' }

const ICONS = {
  compose: iconCompose,
  search: iconSearch,
  panelRight: iconPanelRight,
  folder: iconFolder,
  settings: iconSettings,
  gitBranch: iconGitBranch,
  laptop: iconLaptop,
  list: iconList,
  zap: iconZap,
  pencil: iconPencil,
  chevronDown: iconChevronDown,
  chevronRight: iconChevronRight,
  sparkle: iconSparkle,
  wrench: iconWrench,
  send: iconSend,
  check: iconCheck,
  share: iconShare,
  more: iconMore,
  library: iconLibrary,
  sliders: iconSliders,
  arrowLeft: iconArrowLeft,
  arrowRight: iconArrowRight,
  retry: iconRetry,
  plus: icon_plus,
  clock: icon_clock,
  shield: icon_shield,
  pr: icon_pr,
  shapes: icon_shapes,
  bell: icon_bell,
  help: icon_help,
  mic: icon_mic,
  wave: icon_wave,
  slash: icon_slash,
  settings2: icon_settings2,
  sun: icon_sun,
  moon: icon_moon,
  listChecks: icon_listChecks,
  listFilter: icon_listFilter,
  panelLeft: icon_panelLeft,
  merge: icon_merge,
  link: icon_link,
  monitor: icon_monitor,
  devin: icon_devin,
}

export type IconName = keyof typeof ICONS

// The Devin mark is the official artwork (raster, from the brand lockups); pick the variant that contrasts with its background.
const MARK_WHITE = new URL('../assets/icons/devin-mark-white.png', import.meta.url).pathname
const MARK_BLACK = new URL('../assets/icons/devin-mark-black.png', import.meta.url).pathname
function isLight(hex: string) {
  const m = /^#?([0-9a-f]{6})/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1]!, 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 140
}

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color: string }) {
  if (name === 'devin') return <img src={isLight(color) ? MARK_WHITE : MARK_BLACK} objectFit="contain" style={{ width: size, height: size, flexShrink: 0, pointerEvents: 'none' }} />
  return <svg source={ICONS[name]} style={{ width: size, height: size, flexShrink: 0, color, pointerEvents: 'none' }} />
}
