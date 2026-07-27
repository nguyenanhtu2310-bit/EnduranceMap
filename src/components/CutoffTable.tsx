import type { PipelineResult } from '../lib/pipeline';
import { parseClockTimeToSeconds, secondsToClockTime } from '../lib/time';

interface Props {
  result: PipelineResult;
  graceMinutes: number;
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

export function CutoffTable({ result, graceMinutes }: Props) {
  const rows = result.cutoffTable;

  if (rows.length === 0) {
    return <p className="hint" style={{ margin: 0 }}>No crossings to propose cut-offs for.</p>;
  }

  const tighter = rows.filter((r) => r.mapIsTighter).length;

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
              <th className="num">On map</th>
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
                  <td className="num">
                    <strong>{hm(row.suggestedClockTime)}</strong>
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
        “Slowest arrival” is the P99 of the field driving this plan — the tail, not the absolute last runner.
        “On map” is any cut-off already written into the placemark names, shown for comparison only; it does
        not change the proposal.
      </p>
    </>
  );
}
