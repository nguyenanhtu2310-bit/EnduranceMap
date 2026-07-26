import { useMemo, useState } from 'react';
import type { PipelineResult, PipelineStation } from '../lib/pipeline';
import { secondsToClockTime } from '../lib/time';

interface Props {
  result: PipelineResult;
}

/**
 * Categorical slots in fixed order — a distance keeps its colour no matter how many
 * others are on screen, so filtering never repaints the survivors. Values are the
 * validated reference palette; the CSS variables are declared in index.css.
 */
const SERIES_SLOTS = 8;

function slotVar(index: number): string {
  return `var(--series-${(index % SERIES_SLOTS) + 1})`;
}

function formatHm(seconds: number): string {
  return secondsToClockTime(seconds).slice(0, 5);
}

const ROW_HEIGHT = 46;
const LABEL_WIDTH = 116;
const AXIS_HEIGHT = 26;
const RIGHT_PAD = 12;

interface HoverState {
  station: string;
  binIndex: number;
  x: number;
  y: number;
}

export function CrossingDistribution({ result }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [sharedScale, setSharedScale] = useState(true);

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

  const binCount = stations[0]?.distribution.length ?? 0;
  if (binCount === 0) {
    return <p className="hint">No modeled arrivals to plot.</p>;
  }

  const plotWidth = Math.max(560, binCount * 7);
  const chartWidth = LABEL_WIDTH + plotWidth + RIGHT_PAD;
  const chartHeight = stations.length * ROW_HEIGHT + AXIS_HEIGHT;

  const spanSeconds = timeRangeSeconds.end - timeRangeSeconds.start || 1;
  const binWidth = plotWidth / binCount;
  // A 2px surface gap separates touching columns; never let a bar vanish entirely.
  const barWidth = Math.max(1, binWidth - 2);

  const xForSeconds = (seconds: number) =>
    LABEL_WIDTH + ((seconds - timeRangeSeconds.start) / spanSeconds) * plotWidth;

  // Hour ticks across the shared axis.
  const ticks: number[] = [];
  const firstHour = Math.ceil(timeRangeSeconds.start / 3600) * 3600;
  for (let t = firstHour; t <= timeRangeSeconds.end; t += 3600) ticks.push(t);

  const hovered = hover ? stations.find((s) => s.schedule.name === hover.station) : undefined;
  const hoveredBin = hovered && hover ? hovered.distribution[hover.binIndex] : undefined;

  return (
    <div className="viz-root">
      <div className="chart-legend">
        {courseOrder.map((courseName, i) => (
          <span key={courseName} className="legend-item">
            <span className="legend-swatch" style={{ background: slotVar(i) }} />
            {courseName}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-swatch peak-swatch" />
          Peak {binMinutes}-min window
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.6rem', alignItems: 'center' }}>
          {!showTable && (
            <button
              className="secondary"
              onClick={() => setSharedScale((v) => !v)}
              title={
                sharedScale
                  ? 'Every row shares one height scale, so stations are comparable'
                  : 'Each row fills its own height, so quiet stations stay readable'
              }
            >
              {sharedScale ? 'Scale: shared' : 'Scale: per station'}
            </button>
          )}
          <button className="secondary" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        </span>
      </div>

      {!showTable && (
        <p className="hint" style={{ margin: '-0.35rem 0 0.85rem' }}>
          {sharedScale
            ? 'All rows share one height scale, so bar heights are comparable between stations. Quiet stations look flat because they genuinely see fewer runners.'
            : 'Each row is scaled to its own busiest window — the shape of each station’s load is readable, but heights are no longer comparable between stations.'}
        </p>
      )}

      {showTable ? (
        <DistributionTable result={result} />
      ) : (
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
              const rowTop = rowIndex * ROW_HEIGHT;
              const baseline = rowTop + ROW_HEIGHT - 6;
              const usableHeight = ROW_HEIGHT - 14;
              const scaleMax = sharedScale ? globalMax : rowMax[rowIndex];

              return (
                <g key={station.schedule.name}>
                  <text x={0} y={rowTop + ROW_HEIGHT / 2} className="row-label" dominantBaseline="middle">
                    {station.schedule.name}
                  </text>

                  <line
                    x1={LABEL_WIDTH}
                    x2={LABEL_WIDTH + plotWidth}
                    y1={baseline}
                    y2={baseline}
                    className="baseline"
                  />

                  {station.distribution.map((bin, binIndex) => {
                    if (bin.total === 0) return null;
                    const x = LABEL_WIDTH + binIndex * binWidth;
                    const isPeak = binIndex === station.peakBinIndex;
                    let yCursor = baseline;

                    return (
                      <g
                        key={binIndex}
                        onMouseEnter={() =>
                          setHover({ station: station.schedule.name, binIndex, x: x + binWidth / 2, y: rowTop })
                        }
                      >
                        {/* Hit target is wider than the mark so thin columns stay hoverable. */}
                        <rect
                          x={x - 2}
                          y={rowTop}
                          width={Math.max(binWidth + 4, 8)}
                          height={ROW_HEIGHT}
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
                </g>
              );
            })}
          </svg>

          {hover && hoveredBin && hovered && (
            <div
              className="chart-tooltip"
              style={{ left: hover.x + 12, top: hover.y + 4 }}
              role="status"
            >
              <strong>{hovered.schedule.name}</strong>
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
                    <td>Total</td>
                    <td className="num">{hoveredBin.total.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td>Rate</td>
                    <td className="num">
                      {Math.round(hoveredBin.total * (60 / binMinutes)).toLocaleString()}/hr
                    </td>
                  </tr>
                </tbody>
              </table>
              {hover.binIndex === hovered.peakBinIndex && <span className="peak-note">Peak window</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The WCAG-clean twin of the chart: every plotted value reachable as text. */
function DistributionTable({ result }: { result: PipelineResult }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Station</th>
            <th>Peak window</th>
            <th className="num">Runners in window</th>
            <th className="num">Rate /hr</th>
            <th>Busiest distance</th>
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
              <td className="num">{Math.round(station.schedule.peakRunnersPerHour).toLocaleString()}</td>
              <td>{busiestCourse(station, result.courseOrder)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
