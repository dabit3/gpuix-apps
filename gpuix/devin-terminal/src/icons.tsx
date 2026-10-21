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
}

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color: string }) {
  return <svg source={ICONS[name]} style={{ width: size, height: size, flexShrink: 0, color, pointerEvents: 'none' }} />
}
