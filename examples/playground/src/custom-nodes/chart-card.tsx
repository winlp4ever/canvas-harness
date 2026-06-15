/**
 * ChartCard — synthetic custom node for phase 5 demo.
 *
 * Demonstrates the two custom-node render paths used in phase 5:
 *   - view (React)        — rich card with title + fake bars (full zoom)
 *   - drawPlaceholder     — lo-fi colored rect with the title text (low zoom)
 *
 * No real data, no fetches, no animation. Just enough to stress the
 * overlay mount/unmount and the LOD ladder.
 */
import { type Node, defineNode } from '@canvas-harness/core'

export type ChartCardData = {
  title: string
  series: number[]
  fill: string
}

const CHART_FILL = '#fef3c7'
const CHART_STROKE = '#92400e'

/**
 * The React view component. Rendered into the overlay by useOverlayHost
 * when a chart-card is at full zoom. The view receives the live node and
 * is responsible for its own layout within `node.w × node.h`.
 */
export function ChartCardView({ node }: { node: Node }) {
  const data = (node.data as ChartCardData | undefined) ?? {
    title: 'Card',
    series: [3, 5, 2, 6],
    fill: CHART_FILL,
  }
  const max = Math.max(1, ...data.series)
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: data.fill,
        border: `1px solid ${CHART_STROKE}`,
        borderRadius: 4,
        padding: 6,
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 11,
        color: '#451a03',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontWeight: 600 }}>{data.title}</div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        {data.series.map((v, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: synthetic data, indices stable
            key={i}
            style={{
              flex: 1,
              height: `${(v / max) * 100}%`,
              background: CHART_STROKE,
              borderRadius: 1,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export const chartCardDef = defineNode({
  type: 'chart-card',
  view: ChartCardView,

  lod: {
    // Aggressive thresholds so the React view stays mounted across
    // almost the full zoom range — exercises the live-DOM-during-
    // pan/zoom policy. Consumers with heavier custom nodes can raise
    // these to favour the canvas placeholder sooner.
    minZoomForReact: 0.1,
    minZoomForPlaceholder: 0.05,
  },

  drawPlaceholder: (ctx, node) => {
    const data = node.data as ChartCardData | undefined
    const fill = data?.fill ?? CHART_FILL
    ctx.save()
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, node.w, node.h)
    ctx.strokeStyle = CHART_STROKE
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, node.w, node.h)
    ctx.restore()
  },
})
