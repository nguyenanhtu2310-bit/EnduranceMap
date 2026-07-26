import type { PipelineResult } from '../lib/pipeline';
import { parseClockTimeToSeconds, secondsToClockTime } from '../lib/time';

interface Props {
  result: PipelineResult;
}

function formatHm(clock: string): string {
  const seconds = parseClockTimeToSeconds(clock);
  return seconds === null ? clock : secondsToClockTime(seconds).slice(0, 5);
}

/** Minutes by which modeled arrivals overrun (positive) or clear (negative) the cut-off. */
function marginMinutes(cutoffClock: string, modeledClock: string): number | null {
  const cutoff = parseClockTimeToSeconds(cutoffClock);
  const modeled = parseClockTimeToSeconds(modeledClock);
  if (cutoff === null || modeled === null) return null;
  return Math.round((modeled - cutoff) / 60);
}

export function CutoffTable({ result }: Props) {
  const rows = result.cutoffTable;

  if (rows.length === 0) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        No official cut-off times were found on the scheduled stations. Cut-offs are read from placemark names
        such as <code>COT 1 (KM7.4/42 - 4:10 AM)</code>, including points co-located with the stations you
        selected.
      </p>
    );
  }

  const breached = rows.filter((r) => r.exceeded).length;

  return (
    <>
      <p className="hint">
        {rows.length} cut-off{rows.length === 1 ? '' : 's'} across the scheduled stations.{' '}
        {breached > 0 ? (
          <>
            <strong>{breached}</strong> would be missed by the slowest modeled runners — those need either a
            sweep plan or a revised pace band.
          </>
        ) : (
          'Every modeled field clears its cut-off.'
        )}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Station</th>
              <th>Distance</th>
              <th className="num">Km</th>
              <th className="num">Official cut-off</th>
              <th className="num">Modeled last arrival</th>
              <th className="num">Margin</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const margin = marginMinutes(row.cutoffClockTime, row.modeledLastArrivalClockTime);
              return (
                <tr key={i}>
                  <td>
                    <span className="station-name">{row.stationName}</span>
                  </td>
                  <td>{row.courseName}</td>
                  <td className="num">{row.kmFromStart.toFixed(1)}</td>
                  <td className="num">{formatHm(row.cutoffClockTime)}</td>
                  <td className="num">{row.modeledLastArrivalClockTime.slice(0, 5)}</td>
                  <td className="num">
                    {margin === null ? '—' : margin > 0 ? `+${margin} min` : `${margin} min`}
                  </td>
                  <td>
                    <span className={row.exceeded ? 'tag over' : 'tag ok'}>
                      {row.exceeded ? 'Over cut-off' : 'Clears'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        “Modeled last arrival” is the P99 of the pace band you entered — the tail of the field, not the
        absolute last runner. Margin is how far past (+) or inside (−) the cut-off that tail lands.
      </p>
    </>
  );
}
