import { passKey, type PipelineResult } from '../lib/pipeline';
import type { CrossingOverride, RaceOverrides } from '../lib/overrides';
import { EditableCell } from './EditableCell';
import { parseClockTimeToSeconds, secondsToClockTime } from '../lib/time';

interface Props {
  result: PipelineResult;
  graceMinutes: number;
  overrides?: RaceOverrides;
  onCrossingEdit?: <K extends keyof CrossingOverride>(
    key: string,
    field: K,
    value: CrossingOverride[K] | undefined
  ) => void;
}

function hm(clock: string): string {
  const seconds = parseClockTimeToSeconds(clock);
  return seconds === null ? clock : secondsToClockTime(seconds).slice(0, 5);
}

/** Minutes between the modelled tail and the proposed cut-off. */
function marginMinutes(suggested: string, modeled: string): number | null {
  const a = parseClockTimeToSeconds(suggested);
  const b = parseClockTimeToSeconds(modeled);
  return a === null || b === null ? null : Math.round((a - b) / 60);
}

export function CutoffTable({ result, graceMinutes, overrides, onCrossingEdit }: Props) {
  const rows = result.cutoffTable;

  if (rows.length === 0) {
    return <p className="hint" style={{ margin: 0 }}>No crossings to propose cut-offs for.</p>;
  }

  const tighter = rows.filter((r) => r.mapIsTighter).length;

  // The time a CP actually works to is the LATEST proposal across the distances through
  // it — usually the slowest arrival of the longest race. Highlight it, or a table of
  // white numbers hides the one that matters.
  const finalByStation = new Map<string, number>();
  for (const row of rows) {
    const seconds = parseClockTimeToSeconds(row.suggestedClockTime) ?? -1;
    if (seconds > (finalByStation.get(row.stationName) ?? -1)) finalByStation.set(row.stationName, seconds);
  }
  /**
   * Cut-off rows are flattened from the stations, so an edit has to be traced back to
   * the pass it came from — matched on the distance and the kilometre it sits at.
   */
  const keyFor = (row: (typeof rows)[number]) => {
    const station = result.stations.find((s) => s.schedule.name === row.stationName);
    const pass = station?.crossings.find(
      (c) => c.courseName === row.courseName && Math.abs(c.kmFromStart - row.kmFromStart) < 0.05
    );
    return station && pass ? passKey(station.mapName, row.courseName, pass.passIndex) : '';
  };

  const isFinal = (row: (typeof rows)[number]) =>
    parseClockTimeToSeconds(row.suggestedClockTime) === finalByStation.get(row.stationName);

  return (
    <>
      <p className="hint">
        Proposed from the slowest modelled runner plus {graceMinutes} minutes, rounded up to the next quarter
        hour. Rounding up rather than to nearest keeps a cut-off from landing earlier than the calculation
        intended.
        {tighter > 0 && (
          <>
            {' '}
            <strong>{tighter}</strong> cut-off{tighter === 1 ? '' : 's'} already on the map {tighter === 1 ? 'is' : 'are'}{' '}
            tighter than this — those would turn runners away who are still inside the modelled field.
          </>
        )}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Station</th>
              <th>Distance</th>
              <th className="num">Km</th>
              <th className="num">Slowest arrival</th>
              <th className="num">Proposed cut-off</th>
              <th className="num">Margin</th>
              <th className="num">Provided</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const margin = marginMinutes(row.suggestedClockTime, row.modeledLastArrivalClockTime);
              return (
                <tr key={i}>
                  <td>
                    <span className="station-name">{row.stationName}</span>
                  </td>
                  <td>{row.courseName}</td>
                  <td className="num">{row.kmFromStart.toFixed(1)}</td>
                  <td className="num muted">{row.modeledLastArrivalClockTime.slice(0, 5)}</td>
                  <td className={isFinal(row) ? 'num cot-final' : 'num muted'}>
                    {/* The tag leads, so every time in the column keeps one right edge
                        instead of the final row's being shunted left by its own label. */}
                    {isFinal(row) && <span className="cot-final-tag">final</span>}
                    {onCrossingEdit ? (
                      <EditableCell
                        computed={hm(row.suggestedClockTime)}
                        override={overrides?.crossings?.[keyFor(row)]?.cutoffClock}
                        type="time"
                        align="right"
                        title="Proposed cut-off"
                        onChange={(v) => onCrossingEdit(keyFor(row), 'cutoffClock', v)}
                      />
                    ) : (
                      <strong>{hm(row.suggestedClockTime)}</strong>
                    )}
                  </td>
                  <td className="num muted">{margin === null ? '—' : `+${margin} min`}</td>
                  <td className="num">
                    {row.mapClockTime ? (
                      <>
                        {hm(row.mapClockTime)}
                        {row.mapIsTighter && (
                          <span className="tag over" style={{ marginLeft: '0.4rem' }}>
                            tighter
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        The highlighted time is the final cut-off for that CP — the latest across every distance through it.
        “Slowest arrival” is the P99 of the field driving this plan — the tail, not the absolute last runner.
        “Provided” is any cut-off already given — typed into Race details or written on the map's placemark
        names. It is shown for comparison and governs that distance's schedule, but never changes the
        proposal.
      </p>
    </>
  );
}
