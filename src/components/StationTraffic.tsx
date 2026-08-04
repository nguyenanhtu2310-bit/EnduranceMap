import type { PipelineStation } from '../lib/pipeline';
import { secondsToClockTime } from '../lib/time';
import { firstLeadOfSex, leadsForStation } from '../lib/leadMarkers';
import { buildStationTraffic, courseTotal } from '../lib/stationTraffic';
import { useT } from '../lib/i18n';

interface Props {
  station: PipelineStation;
  courseOrder: string[];
  binMinutes: number;
  /** Colour for a distance's slot, shared with the overview chart. */
  colourFor: (courseIndex: number) => string;
}

const BAR_GAP = 2;
const GROUP_GAP = 14;
const MIN_BAR = 7;
const PLOT_HEIGHT = 210;
const LABEL_BAND = 18;
const AXIS_BAND = 22;
const LEFT_PAD = 4;

/**
 * One station's traffic, window by window.
 *
 * The overview answers "when is the course busy"; a crew standing at a point needs
 * "how many, of which race, in the next quarter of an hour" — the number they count
 * cups and marshals against. So the distances stand side by side here rather than
 * stacked, each bar carries its own figure, and the same figures repeat as a table
 * underneath: the crew at Da Nang worked from a photograph of exactly that, and a
 * photograph cannot be hovered.
 */
export function StationTraffic({ station, courseOrder, binMinutes, colourFor }: Props) {
  const t = useT();
  const view = buildStationTraffic(station, courseOrder);
  if (!view) return <p className="hint">No modeled arrivals at this point.</p>;
  const { active, present, max } = view;
  const barWidth = Math.max(MIN_BAR, 34 - present.length * 4);
  const groupWidth = present.length * (barWidth + BAR_GAP) + GROUP_GAP;
  const width = LEFT_PAD + active.length * groupWidth;
  const height = LABEL_BAND + PLOT_HEIGHT + AXIS_BAND;
  const baseline = LABEL_BAND + PLOT_HEIGHT;

  const hm = (seconds: number) => secondsToClockTime(seconds).slice(0, 5);
  const leadMan = firstLeadOfSex(station, 'M');
  const leadWoman = firstLeadOfSex(station, 'F');

  return (
    <div className="station-traffic">
      <dl className="traffic-facts">
        <dt>{t('Operating time')}</dt>
        <dd>
          {hm(active[0].binStartSeconds)} – {hm(active[active.length - 1].binEndSeconds)}
        </dd>

        <dt>{t('Total visits')}</dt>
        <dd>{view.total.toLocaleString()}</dd>

        <dt>{t('Busiest')}</dt>
        <dd>
          <strong>{view.busiestBin.total.toLocaleString()}</strong> {t('at')}{' '}
          {hm(view.busiestBin.binStartSeconds)} – {hm(view.busiestBin.binEndSeconds)}
        </dd>

        {leadsForStation(station).length > 0 && (
          <>
            <dt>{t('First through')}</dt>
            <dd>
              {leadMan && (
                <>
                  {t('Male')} <span className="lead-time">{hm(leadMan.seconds)}</span>
                </>
              )}
              {leadMan && leadWoman && ' · '}
              {leadWoman && (
                <>
                  {t('Female')} <span className="lead-time">{hm(leadWoman.seconds)}</span>
                </>
              )}
            </dd>
          </>
        )}
      </dl>

      <div className="chart-legend chart-key">
        {present.map(({ name, index }) => (
          <span key={name} className="legend-item">
            <span className="legend-swatch" style={{ background: colourFor(index) }} />
            {name}
          </span>
        ))}
      </div>

      <div className="table-scroll">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Arrivals per ${binMinutes} minutes at ${station.schedule.name}`}
        >
          <line x1={LEFT_PAD} x2={width} y1={baseline} y2={baseline} className="baseline" />

          {active.map((bin, binIndex) => {
            const groupLeft = LEFT_PAD + binIndex * groupWidth + GROUP_GAP / 2;
            return (
              <g key={bin.binStartSeconds}>
                {present.map(({ name, index }, slot) => {
                  const count = bin.byCourse[index] ?? 0;
                  if (count === 0) return null;
                  const barHeight = (count / max) * PLOT_HEIGHT;
                  const x = groupLeft + slot * (barWidth + BAR_GAP);
                  return (
                    <g key={name}>
                      <rect
                        x={x}
                        y={baseline - barHeight}
                        width={barWidth}
                        height={Math.max(barHeight, 1)}
                        fill={colourFor(index)}
                      />
                      <text
                        x={x + barWidth / 2}
                        y={baseline - barHeight - 5}
                        textAnchor="middle"
                        className="bar-value"
                      >
                        {count.toLocaleString()}
                      </text>
                    </g>
                  );
                })}
                <text
                  x={groupLeft + (present.length * (barWidth + BAR_GAP)) / 2}
                  y={baseline + 15}
                  textAnchor="middle"
                  className="axis-text"
                >
                  {hm(bin.binStartSeconds)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="table-scroll">
        <table className="traffic-table">
          <thead>
            <tr>
              <th>{t('Distance')}</th>
              {active.map((bin) => (
                <th key={bin.binStartSeconds} className="num">
                  {hm(bin.binStartSeconds)}
                </th>
              ))}
              <th className="num">{t('Total')}</th>
            </tr>
          </thead>
          <tbody>
            {present.map(({ name, index }) => (
              <tr key={name}>
                <td>
                  <span className="legend-swatch" style={{ background: colourFor(index) }} /> {name}
                </td>
                {active.map((bin) => (
                  <td key={bin.binStartSeconds} className="num">
                    {bin.byCourse[index] ? bin.byCourse[index].toLocaleString() : ''}
                  </td>
                ))}
                <td className="num">
                  <strong>{courseTotal(view, index).toLocaleString()}</strong>
                </td>
              </tr>
            ))}
            <tr className="tooltip-total">
              <td>
                <strong>{t('All')}</strong>
              </td>
              {active.map((bin) => (
                <td key={bin.binStartSeconds} className="num">
                  <strong>{bin.total ? bin.total.toLocaleString() : ''}</strong>
                </td>
              ))}
              <td className="num">
                <strong>{active.reduce((sum, bin) => sum + bin.total, 0).toLocaleString()}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
