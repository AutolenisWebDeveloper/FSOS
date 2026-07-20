// Production Operations dashboard widget library (Impeccable · Product register).
// One unified, server-safe design language shared by the Cross-Sell, Life Win-Back,
// and Life Conversion command centers. Compose pages from these — do not hand-roll.

export {
  Panel,
  PanelLink,
  DeltaPill,
  Sparkline,
  MetricCard,
  MetricGrid,
  ProgressMeter,
  MiniStat,
  EmptyNote,
  toneBar,
  toneText,
  type Tone,
} from './primitives'

export { FunnelChart, BarList, DonutChart, HeatGrid } from './charts'
export type { FunnelStage, BarItem, DonutSegment, HeatCell } from './charts'

export { Leaderboard, ActivityFeed, QueueList, ListCaption } from './lists'
export type { LeaderRow, FeedItem, QueueItem } from './lists'
