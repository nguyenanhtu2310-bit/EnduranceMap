import { useRef, useState } from 'react';
import type { Course } from '../lib/snap';
import { summarizeProfile, type ContestProfile } from '../lib/results';

interface Props {
  fileName?: string;
  profiles: ContestProfile[];
  courses: Course[];
  /** contest name -> course name, or '' for "don't use this contest". */
  mapping: Record<string, string>;
  onLoad: (text: string, fileName: string) => void;
  onMappingChange: (mapping: Record<string, string>) => void;
  onClear: () => void;
  onError: (message: string) => void;
}

export function ResultsPanel({
  fileName,
  profiles,
  courses,
  mapping,
  onLoad,
  onMappingChange,
  onClear,
  onError,
}: Props) {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function accept(file: File | undefined) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      onError(`"${file.name}" is not a .csv file.`);
      return;
    }
    try {
      onLoad(await file.text(), file.name);
    } catch {
      onError(`Could not read "${file.name}".`);
    }
  }

  if (!fileName) {
    return (
      <div
        className={isOver ? 'drop over' : 'drop'}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsOver(false);
          void accept(e.dataTransfer.files?.[0]);
        }}
      >
        <p style={{ margin: 0 }}>
          Drop a past race's results CSV, or <strong>browse</strong>
        </p>
        <p className="hint" style={{ margin: '0.4rem 0 0' }}>
          Optional. Without one, the pace bands below are used instead.
        </p>
        <input ref={inputRef} type="file" accept=".csv" onChange={(e) => accept(e.target.files?.[0])} />
      </div>
    );
  }

  return (
    <>
      <div className="file-line" style={{ marginBottom: '1rem' }}>
        <span>
          <span className="tag ok">Loaded</span> <strong className="loaded-file">{fileName}</strong> — {profiles.length} contest{profiles.length === 1 ? '' : 's'}
        </span>
        <span style={{ display: 'inline-flex', gap: '0.6rem' }}>
          <button className="secondary" onClick={() => inputRef.current?.click()}>
            Choose a different file
          </button>
          <button className="secondary" onClick={onClear}>
            Remove
          </button>
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Contest in file</th>
              <th className="num">Finishers</th>
              <th className="num">Distance</th>
              <th className="num">Pace P1 / P50 / P99</th>
              <th className="num">Start spread</th>
              <th>Use for</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const summary = summarizeProfile(profile);
              return (
                <tr key={profile.contest}>
                  <td>
                    <span className="station-name">{profile.contest}</span>
                    {profile.warnings.map((w) => (
                      <span key={w} className="colocated">
                        {w}
                      </span>
                    ))}
                  </td>
                  <td className="num">{profile.finishers.toLocaleString()}</td>
                  <td className="num">{profile.distanceKm > 0 ? `${profile.distanceKm} km` : '—'}</td>
                  <td className="num">
                    {summary
                      ? `${summary.pace.p1.toFixed(2)} / ${summary.pace.p50.toFixed(2)} / ${summary.pace.p99.toFixed(2)}`
                      : '—'}
                  </td>
                  <td className="num">
                    {summary ? `+${Math.round(summary.startSpreadSeconds.p99 / 60)} min at P99` : '—'}
                  </td>
                  <td>
                    <select
                      value={mapping[profile.contest] ?? ''}
                      onChange={(e) =>
                        onMappingChange({ ...mapping, [profile.contest]: e.target.value })
                      }
                    >
                      <option value="">Not used</option>
                      {courses.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        Each mapped contest replays its real finishers — every runner keeps their own start offset and their
        own pace — onto this race's course and start time, scaled to the field size you enter below. Pace
        figures are minutes per km. Contests left as “Not used” fall back to the pace band.
      </p>
    </>
  );
}
