import type { DistanceInput } from '../lib/pipeline';

export interface DistanceFormRow extends Omit<DistanceInput, 'runnerCount'> {
  /** Kept as a string so the field can be cleared while typing. */
  runnerCountText: string;
  measuredKm: number;
}

interface Props {
  rows: DistanceFormRow[];
  onChange: (rows: DistanceFormRow[]) => void;
}

const NUMERIC_FIELDS = [
  { key: 'fastestMinPerKm', label: 'Fastest', title: 'Pace of the leading runners, in minutes per km' },
  { key: 'typicalMinPerKm', label: 'Typical', title: 'Median runner pace, in minutes per km' },
  { key: 'slowestMinPerKm', label: 'Slowest', title: 'Pace of the final finishers, in minutes per km' },
] as const;

export function PaceBandForm({ rows, onChange }: Props) {
  function update(index: number, patch: Partial<DistanceFormRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Distance</th>
            <th className="num">Measured</th>
            <th>Start</th>
            <th className="num" title="Minutes over which the whole field crosses the start line">
              Spread (min)
            </th>
            <th className="num">Runners</th>
            {NUMERIC_FIELDS.map((f) => (
              <th key={f.key} className="num" title={f.title}>
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.courseName}>
              <td>
                <strong>{row.courseName}</strong>
              </td>
              <td className="num muted">{row.measuredKm.toFixed(2)} km</td>
              <td style={{ minWidth: 110 }}>
                <input
                  type="time"
                  value={row.startTimeClock}
                  onChange={(e) => update(i, { startTimeClock: e.target.value })}
                />
              </td>
              <td className="num" style={{ minWidth: 80 }}>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={row.startSpreadMinutes ?? 0}
                  onChange={(e) => update(i, { startSpreadMinutes: Number(e.target.value) })}
                />
              </td>
              <td className="num" style={{ minWidth: 90 }}>
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={row.runnerCountText}
                  onChange={(e) => update(i, { runnerCountText: e.target.value })}
                />
              </td>
              {NUMERIC_FIELDS.map((f) => (
                <td key={f.key} className="num" style={{ minWidth: 80 }}>
                  <input
                    type="number"
                    min={1}
                    step={0.1}
                    value={row[f.key]}
                    onChange={(e) => update(i, { [f.key]: Number(e.target.value) } as Partial<DistanceFormRow>)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint" style={{ margin: '0.75rem 0 0' }}>
        Paces are minutes per km. Fastest and slowest anchor the P1 and P99 arrivals; spread is how long the
        field takes to clear the start line, which is what keeps early stations from reading as impossibly busy.
      </p>
    </div>
  );
}
