import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useT } from '../lib/i18n';
import type { LeadArrival, PipelineResult, PipelineStation } from '../lib/pipeline';
import { secondsToClockTime } from '../lib/time';
import { seriesVar as slotVar } from '../lib/series';
import {
  assignLeadLanes,
  firstLeadOfSex,
  leadsForStation,
  sexGlyph,
  sexLabel,
} from '../lib/leadMarkers';

interface Props {
  result: PipelineResult;
}

function formatHm(seconds: number): string {
  return secondsToClockTime(seconds).slice(0, 5);
}

/**
 * The row at 1.0x — deliberately the compact one.
 *
 * A hundred-point timing map at the old comfortable height ran past nine thousand
 * pixels, and the whole day on one screen is the view a race director, course director
 * and medical director plan resources from. So the overview is what the chart opens at,
 * and the slider adds height rather than taking it away.
 */
const ROW_BODY = 16;
const AXIS_HEIGHT = 26;
const RIGHT_PAD = 12;
const LABEL_GUTTER = 24;
const MIN_LABEL_WIDTH = 96;
const MAX_LABEL_WIDTH = 280;
/** Approximate advance of the 12px label face; SVG text cannot wrap or ellipsize itself. */
const LABEL_CHAR_PX = 6.2;
/** Glyph face at 1.0x — the smallest at which ♂ and ♀ are still distinct shapes. */
const GLYPH_PX = 7;
/** Vertical spacing between stacked glyph lanes at 1.0x. */
const LANE_STEP = 8;
/** Clearance above the first lane and below the last, so nothing touches a bar. */
const BAND_PADDING = 4;
/** Gap under the baseline at 1.0x. */
const BASELINE_PAD = 3;

/**
 * How far the timeline is stretched. 1 fits the card; the upper end gives roughly a
 * finger's width per 15-minute bin, which is what it takes to read a single increment.
 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 10;

/**
 * Row height as a multiple of the overview. 1.0 is the whole race day on a laptop
 * screen — the view a briefing is built from, and so the one the chart opens at. Above
 * it every vertical measure grows together, for reading one station closely.
 */
const MIN_HEIGHT = 1;
const MAX_HEIGHT = 3;

function truncateToWidth(text: string, widthPx: number): string {
  const maxChars = Math.max(4, Math.floor(widthPx / LABEL_CHAR_PX));
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/** Where a tooltip should sit, in coordinates of the chart's outer box. */
interface Anchor {
  x: number;
  y: number;
}

interface BinHover extends Anchor {
  kind: 'bin';
  station: string;
  binIndex: number;
}

interface LeadHover extends Anchor {
  kind: 'lead';
  lead: LeadArrival;
  station: string;
}

type Hover = BinHover | LeadHover;

export function CrossingDistribution({ result }: Props) {
  const t = useT();
  const [hover, setHover] = useState<Hover | null>(null);
  /** 'chart' is the race day at a glance; 'table' is its accessible twin. */
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [sharedScale, setSharedScale] = useState(true);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [height, setHeight] = useState(MIN_HEIGHT);

  /**
   * Tooltips are positioned against this box rather than against the scrolling strip
   * inside it. An absolutely positioned child of a scroll container adds to what that
   * container can scroll, so a tooltip near the foot of the chart used to grow the
   * scroll height, and reaching for it moved the pointer off the bar that summoned it —
   * the tooltip vanished, the height collapsed, and the view jumped back up.
   */
  const boxRef = useRef<HTMLDivElement>(null);

  const { stations, courseOrder, timeRangeSeconds, binMinutes } = result;

  // Shared scale keeps rows comparable — a tall bar at station 3 means the same number
  // of runners as a tall bar at station 12. But when a late marathon-only station sees
  // a fraction of the start-line field, its row flattens to a line; per-row scaling
  // trades the comparison for the shape of each station's own load.
  const globalMax = useMemo(
    () => Math.max(1, ...stations.flatMap((s) => s.distribution.map((b) => b.total))),
    [stations]
  );
  const rowMax = useMemo(
    () => stations.map((s) => Math.max(1, ...s.distribution.map((b) => b.total))),
    [stations]
  );

  const hasLeads = stations.some((s) => leadsForStation(s).length > 0);

  const binCount = stations[0]?.distribution.length ?? 0;
  if (binCount === 0) {
    return <p className="hint">No modeled arrivals to plot.</p>;
  }

  /** Pins the tooltip to the pointer, in the outer box's own coordinates. */
  function anchorFrom(event: ReactMouseEvent): Anchor {
    const box = boxRef.current?.getBoundingClientRect();
    return box
      ? { x: event.clientX - box.left, y: event.clientY - box.top }
      : { x: event.clientX, y: event.clientY };
  }

  // Sized to the longest name so labels never run into the plot, but capped so a
  // verbose timing map cannot squeeze the chart out of the card.
  const longestLabel = Math.max(0, ...stations.map((s) => s.schedule.name.length));
  const labelWidth = Math.min(
    MAX_LABEL_WIDTH,
    Math.max(MIN_LABEL_WIDTH, Math.ceil(longestLabel * LABEL_CHAR_PX) + LABEL_GUTTER)
  );
  const labelTextWidth = labelWidth - LABEL_GUTTER;

  const plotWidth = Math.max(640, binCount * 9) * zoom;
  const chartWidth = labelWidth + plotWidth + RIGHT_PAD;

  const spanSeconds = timeRangeSeconds.end - timeRangeSeconds.start || 1;
  const binWidth = plotWidth / binCount;
  // A 2px surface gap separates touching columns; never let a bar vanish entirely.
  const barWidth = Math.max(1, binWidth - 2);

  const xForSeconds = (seconds: number) =>
    labelWidth + ((seconds - timeRangeSeconds.start) / spanSeconds) * plotWidth;

  // Everything vertical grows together from the overview, so a taller row never leaves
  // a glyph sitting on a bar and the shape of the chart is the same at every setting.
  const glyphPx = Math.round(GLYPH_PX * height);
  const laneStep = Math.round(LANE_STEP * height);
  const bandPadding = Math.round(BAND_PADDING * height);
  const rowBody = Math.round(ROW_BODY * height);
  const baselinePad = Math.round(BASELINE_PAD * height);

  // Rows are only as tall as the busiest one needs. Stretching the timeline pulls
  // markers apart, so the band shrinks back as lanes empty and the bars regain the room.
  const rowLeads = stations.map((s) => leadsForStation(s));
  const rowLanes = rowLeads.map((leads) =>
    assignLeadLanes(leads.map((l) => xForSeconds(l.seconds)), glyphPx + 1)
  );
  const laneCount = Math.max(1, ...rowLanes.map((lanes) => Math.max(0, ...lanes) + 1));
  const markerBand = hasLeads ? bandPadding + laneCount * laneStep : 0;
  const rowHeight = rowBody + markerBand;
  const chartHeight = stations.length * rowHeight + AXIS_HEIGHT;

  // Hour ticks across the shared axis, thinning to the quarter hour once stretched far
  // enough that every bin edge has room for its own time.
  const tickStep = binWidth >= 46 ? 900 : binWidth >= 16 ? 1800 : 3600;
  const ticks: number[] = [];
  const firstTick = Math.ceil(timeRangeSeconds.start / tickStep) * tickStep;
  for (let t = firstTick; t <= timeRangeSeconds.end; t += tickStep) ticks.push(t);

  const hoveredStation =
    hover?.kind === 'bin' ? stations.find((s) => s.schedule.name === hover.station) : undefined;
  const hoveredBin = hoveredStation && hover?.kind === 'bin' ? hoveredStation.distribution[hover.binIndex] : undefined;

  return (
    <div className="viz-root" ref={boxRef}>
      <div className="chart-legend">
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.6rem', alignItems: 'center' }}>
          {view === 'chart' && (
            <button
              className="secondary"
              onClick={() => setSharedScale((v) => !v)}
              title={
                sharedScale
                  ? 'Every row shares one height scale, so stations are comparable'
                  : 'Each row fills its own height, so quiet stations stay readable'
              }
            >
              {sharedScale ? t('Scale: shared') : t('Scale: per station')}
            </button>
          )}
          <button className="secondary" onClick={() => setView((v) => (v === 'table' ? 'chart' : 'table'))}>
            {view === 'table' ? t('Show chart') : t('Show table')}
          </button>
        </span>
      </div>

      {view === 'chart' && (
        <div className="chart-controls">
          <label className="zoom-control">
            <span className="muted small">{t('Stretch')}</span>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.5}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Stretch the timeline"
            />
            <span className="muted small tabular">{zoom.toFixed(1)}×</span>
          </label>
          <label className="zoom-control">
            <span className="muted small">{t('Height')}</span>
            <input
              type="range"
              min={MIN_HEIGHT}
              max={MAX_HEIGHT}
              step={0.1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              aria-label="Row height"
            />
            <span className="muted small tabular">{height.toFixed(1)}×</span>
          </label>
          {(zoom !== MIN_ZOOM || height !== MIN_HEIGHT) && (
            <button
              className="secondary"
              onClick={() => {
                setZoom(MIN_ZOOM);
                setHeight(MIN_HEIGHT);
              }}
            >
              {t('Fit')}
            </button>
          )}
        </div>
      )}

      {view === 'chart' && (
        <p className="hint" style={{ margin: '-0.35rem 0 0.85rem' }}>
          {sharedScale
            ? t('All rows share one height scale, so bar heights are comparable between stations. Quiet stations look flat because they genuinely see fewer runners.')
            : t('Each row is scaled to its own busiest window — the shape of each station’s load is readable, but heights are no longer comparable between stations.')}
        </p>
      )}

      {/* The key sits directly above the plot, under the sliders, because a screenshot
          of the chart has to carry the distances it is coloured by — cropping to the
          bars alone leaves four unexplained colours. */}
      {view === 'chart' && (
        <div className="chart-legend chart-key">
          {courseOrder.map((courseName, i) => (
            <span key={courseName} className="legend-item">
              <span className="legend-swatch" style={{ background: slotVar(i) }} />
              {courseName}
            </span>
          ))}
          <span className="legend-item">
            <span className="legend-swatch peak-swatch" />
            {t('Peak {n}-min window').replace('{n}', String(binMinutes))}
          </span>
          {hasLeads && (
            <span className="legend-item" title="The fastest finisher of each sex, on each distance">
              <span className="legend-lead">♂♀</span>
              {t('First Male / Female, coloured by distance')}
            </span>
          )}
        </div>
      )}

      {view === 'table' && <DistributionTable result={result} />}

      {view === 'chart' && (
        <div className="table-scroll chart-scroll">
          <svg
            width={chartWidth}
            height={chartHeight}
            role="img"
            aria-label="Runner arrivals over time at each station"
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={xForSeconds(t)}
                  x2={xForSeconds(t)}
                  y1={0}
                  y2={chartHeight - AXIS_HEIGHT}
                  className="grid-line"
                />
                <text x={xForSeconds(t)} y={chartHeight - 8} textAnchor="middle" className="axis-text">
                  {formatHm(t)}
                </text>
              </g>
            ))}

            {stations.map((station, rowIndex) => {
              const rowTop = rowIndex * rowHeight;
              const baseline = rowTop + rowHeight - baselinePad;
              const usableHeight = Math.max(6, rowBody - baselinePad * 2);
              const scaleMax = sharedScale ? globalMax : rowMax[rowIndex];
              const leads = rowLeads[rowIndex];
              const lanes = rowLanes[rowIndex];

              return (
                <g key={station.schedule.name}>
                  <text x={0} y={rowTop + rowHeight / 2} className="row-label" dominantBaseline="middle">
                    <title>{station.schedule.name}</title>
                    {truncateToWidth(station.schedule.name, labelTextWidth)}
                  </text>

                  <line
                    x1={labelWidth}
                    x2={labelWidth + plotWidth}
                    y1={baseline}
                    y2={baseline}
                    className="baseline"
                  />

                  {station.distribution.map((bin, binIndex) => {
                    if (bin.total === 0) return null;
                    const x = labelWidth + binIndex * binWidth;
                    const isPeak = binIndex === station.peakBinIndex;
                    let yCursor = baseline;

                    return (
                      <g
                        key={binIndex}
                        onMouseMove={(e) =>
                          setHover({
                            kind: 'bin',
                            station: station.schedule.name,
                            binIndex,
                            ...anchorFrom(e),
                          })
                        }
                      >
                        {/* Hit target is wider than the mark so thin columns stay hoverable. */}
                        <rect
                          x={x - 2}
                          y={rowTop + markerBand}
                          width={Math.max(binWidth + 4, 8)}
                          height={rowHeight - markerBand}
                          fill="transparent"
                        />
                        {bin.byCourse.map((count, courseIndex) => {
                          if (count === 0) return null;
                          const h = (count / scaleMax) * usableHeight;
                          yCursor -= h;
                          // A 2px surface gap separates stacked segments, but only where
                          // the segment can spare it — shaving 2px off a 3px segment
                          // would erase the value it encodes.
                          const gap = h >= 6 ? 2 : 0;
                          return (
                            <rect
                              key={courseIndex}
                              x={x}
                              y={yCursor}
                              width={barWidth}
                              height={Math.max(h - gap, 0.5)}
                              fill={slotVar(courseIndex)}
                              opacity={isPeak ? 1 : 0.82}
                            />
                          );
                        })}
                        {isPeak && (
                          <rect
                            x={x - 1.5}
                            y={baseline - (bin.total / scaleMax) * usableHeight - 5}
                            width={barWidth + 3}
                            height={3}
                            className="peak-cap"
                          />
                        )}
                      </g>
                    );
                  })}

                  {/* The head of the field, drawn over the bars: the lead athletes arrive
                      before the bulk of the distribution and would otherwise be lost in a
                      column one runner tall. Coloured by distance, so a row carrying four
                      races says which leader is which. */}
                  {leads.map((lead, leadIndex) => {
                    const lx = xForSeconds(lead.seconds);
                    if (lx < labelWidth || lx > labelWidth + plotWidth) return null;
                    const colour = slotVar(Math.max(0, courseOrder.indexOf(lead.courseName)));
                    // Its lane's own height, so the line still joins glyph to baseline.
                    const glyphY =
                      rowTop + bandPadding / 2 + lanes[leadIndex] * laneStep + glyphPx / 2;

                    return (
                      <g
                        key={`${lead.courseName}-${lead.sex}-${lead.passIndex}`}
                        className="lead-marker"
                        onMouseMove={(e) =>
                          setHover({ kind: 'lead', lead, station: station.schedule.name, ...anchorFrom(e) })
                        }
                      >
                        {/* The hit target keeps a full-size reach whatever the rows are
                            squashed to, so a compressed chart is still hoverable. */}
                        <rect
                          x={lx - 6}
                          y={glyphY - GLYPH_PX / 2}
                          width={12}
                          height={Math.max(8, baseline - glyphY + GLYPH_PX / 2)}
                          fill="transparent"
                        />
                        <line x1={lx} x2={lx} y1={glyphY + glyphPx / 2} y2={baseline} stroke={colour} />
                        <text
                          x={lx}
                          y={glyphY}
                          textAnchor="middle"
                          fill={colour}
                          style={{ fontSize: `${glyphPx}px` }}
                        >
                          {sexGlyph(lead.sex)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {view === 'chart' && hover?.kind === 'bin' && hoveredBin && hoveredStation && (
        <ChartTooltip anchor={hover} box={boxRef.current}>
          <strong>{hoveredStation.schedule.name}</strong>
          <span className="muted small">
            {formatHm(hoveredBin.binStartSeconds)}–{formatHm(hoveredBin.binEndSeconds)}
          </span>
          <table className="tooltip-table">
            <tbody>
              {hoveredBin.byCourse.map((count, i) =>
                count > 0 ? (
                  <tr key={i}>
                    <td>
                      <span className="legend-swatch" style={{ background: slotVar(i) }} /> {courseOrder[i]}
                    </td>
                    <td className="num">{count.toLocaleString()}</td>
                  </tr>
                ) : null
              )}
              <tr className="tooltip-total">
                <td>Through in {binMinutes} min</td>
                <td className="num">{hoveredBin.total.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
          {hover.binIndex === hoveredStation.peakBinIndex && <span className="peak-note">Peak window</span>}
        </ChartTooltip>
      )}

      {view === 'chart' && hover?.kind === 'lead' && (
        <ChartTooltip anchor={hover} box={boxRef.current}>
          <strong>{hover.station}</strong>
          <span className="muted small">{sexLabel(hover.lead.sex)}</span>
          <table className="tooltip-table">
            <tbody>
              <tr>
                <td>
                  <span
                    className="legend-swatch"
                    style={{ background: slotVar(Math.max(0, courseOrder.indexOf(hover.lead.courseName))) }}
                  />{' '}
                  {hover.lead.courseName}
                </td>
                <td className="num lead-time">{formatHm(hover.lead.seconds)}</td>
              </tr>
              <tr>
                <td>At</td>
                <td className="num">{hover.lead.kmFromStart.toFixed(1)} km</td>
              </tr>
            </tbody>
          </table>
        </ChartTooltip>
      )}
    </div>
  );
}

/**
 * A tooltip held inside the chart's own box. It flips to the other side of the pointer
 * near an edge rather than being clipped, and never sits inside the scrolling strip.
 */
function ChartTooltip({
  anchor,
  box,
  children,
}: {
  anchor: Anchor;
  box: HTMLDivElement | null;
  children: React.ReactNode;
}) {
  const width = box?.clientWidth ?? 0;
  const height = box?.clientHeight ?? 0;
  const flipX = width > 0 && anchor.x > width - 210;
  const flipY = height > 0 && anchor.y > height - 170;

  return (
    <div
      className="chart-tooltip"
      role="status"
      style={{
        left: flipX ? undefined : anchor.x + 14,
        right: flipX ? Math.max(4, width - anchor.x + 14) : undefined,
        top: flipY ? undefined : anchor.y + 8,
        bottom: flipY ? Math.max(4, height - anchor.y + 8) : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** The WCAG-clean twin of the chart: every plotted value reachable as text. */
function DistributionTable({ result }: { result: PipelineResult }) {
  const hasLeads = result.stations.some((s) => leadsForStation(s).length > 0);

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Station</th>
            <th>Peak window</th>
            <th className="num">Through in {result.binMinutes} min</th>
            <th>Busiest distance</th>
            <th>Activity</th>
            {hasLeads && <th className="num">First Male</th>}
            {hasLeads && <th className="num">First Female</th>}
          </tr>
        </thead>
        <tbody>
          {result.stations.map((station) => (
            <tr key={station.schedule.name}>
              <td>
                <span className="station-name">{station.schedule.name}</span>
              </td>
              <td>{peakWindowLabel(station)}</td>
              <td className="num">{peakBin(station)?.total.toLocaleString() ?? '—'}</td>
              <td>{busiestCourse(station, result.courseOrder)}</td>
              <td>
                <span className={`tag ${station.schedule.activityLevel}`}>
                  {station.schedule.activityLevel}
                </span>
              </td>
              {hasLeads && <td className="num">{firstLeadLabel(station, 'M')}</td>}
              {hasLeads && <td className="num">{firstLeadLabel(station, 'F')}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The earliest lead arrival of one sex at a station, across every distance through it. */
function firstLeadLabel(station: PipelineStation, sex: LeadArrival['sex']): string {
  const first = firstLeadOfSex(station, sex);
  return first ? `${formatHm(first.seconds)} ${first.courseName}` : '—';
}

function peakBin(station: PipelineStation) {
  return station.peakBinIndex >= 0 ? station.distribution[station.peakBinIndex] : undefined;
}

function peakWindowLabel(station: PipelineStation): string {
  const bin = peakBin(station);
  if (!bin) return '—';
  return `${formatHm(bin.binStartSeconds)}–${formatHm(bin.binEndSeconds)}`;
}

function busiestCourse(station: PipelineStation, courseOrder: string[]): string {
  const bin = peakBin(station);
  if (!bin) return '—';
  let best = -1;
  let bestCount = 0;
  bin.byCourse.forEach((count, i) => {
    if (count > bestCount) {
      bestCount = count;
      best = i;
    }
  });
  return best >= 0 ? courseOrder[best] : '—';
}
