import { useMemo, useRef, useState } from 'react';
import { parseTimingPoints, type TimingPoint } from '../lib/timingPoints';
import type { LoadedGpx } from './GpxPanel';
import { useT } from '../lib/i18n';

interface Props {
  files: LoadedGpx[];
  onChange: (files: LoadedGpx[]) => void;
  /** Course names and lengths, so each file can be shown against the race it describes. */
  courses: { name: string; totalKm: number }[];
}

interface ReadFile {
  fileName: string;
  points: TimingPoint[];
  declaredKm: number;
  warnings: string[];
  error?: string;
}

/**
 * The timing system's split configuration, one file per distance.
 *
 * Supplying it is what stops anyone renaming pins in Google My Maps: a map's placemarks
 * mark positions and are called "Điểm 5", while these names become the columns of the
 * results file and therefore had to be right. Each station takes the name of whichever
 * mat it is standing on, and the ones standing on no mat are marked as untimed rather
 * than quietly counted.
 */
export function TimingPointsPanel({ files, onChange, courses }: Props) {
  const t = useT();
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const read = useMemo<ReadFile[]>(() => {
    const out = files.map((file) => {
      try {
        const parsed = parseTimingPoints(file.text);
        return {
          fileName: file.fileName,
          points: parsed.points,
          declaredKm: parsed.points.reduce((far, p) => Math.max(far, p.kmFromStart), 0),
          warnings: parsed.warnings,
        };
      } catch (e) {
        return {
          fileName: file.fileName,
          points: [],
          declaredKm: 0,
          warnings: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });
    out.sort((a, b) => b.declaredKm - a.declaredKm);
    return out;
  }, [files]);

  async function accept(list: FileList | null | undefined) {
    if (!list || list.length === 0) return;
    const loaded: LoadedGpx[] = [];
    for (const file of Array.from(list)) {
      if (!/\.lvs$/i.test(file.name)) continue;
      loaded.push({ fileName: file.name, text: await file.text() });
    }
    onChange(loaded);
  }

  /** The course a file describes, by measured length against the length it declares. */
  function courseFor(declaredKm: number): { name: string; totalKm: number } | undefined {
    if (declaredKm <= 0) return undefined;
    let best: { name: string; totalKm: number } | undefined;
    let bestGap = Infinity;
    for (const course of courses) {
      const gap = Math.abs(course.totalKm - declaredKm) / Math.max(course.totalKm, declaredKm);
      if (gap < bestGap) {
        bestGap = gap;
        best = course;
      }
    }
    // Same generous bound the course merge uses: a drawn route and a surveyed one
    // disagree by a few percent, and trail distances advertise short.
    return bestGap <= 0.08 ? best : undefined;
  }

  return (
    <div className="gpx-panel">
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
          void accept(e.dataTransfer.files);
        }}
      >
        <p style={{ margin: 0 }}>
          {t('Drop the timing split files (.lvs) here, or')} <strong>{t('browse')}</strong>
        </p>
        <p className="hint" style={{ margin: '0.4rem 0 0' }}>
          {t('One per distance, exported from the timing program. Stations take their names from these.')}
        </p>
        <input ref={inputRef} type="file" accept=".lvs" multiple onChange={(e) => accept(e.target.files)} />
      </div>

      {read.length > 0 && (
        <div className="gpx-results">
          {read.map((file) => {
            const course = courseFor(file.declaredKm);
            return (
              <div className="gpx-file" key={file.fileName}>
                <div className="gpx-file-head">
                  <strong className="loaded-file">{file.fileName}</strong>
                  {file.error ? (
                    <span className="tag bad">{t('Unreadable')}</span>
                  ) : (
                    <span className="muted small">
                      {file.points.length} {t('timing points')} · {file.declaredKm.toFixed(2)} km
                      {course ? ` · ${course.name}` : ` · ${t('no matching course loaded')}`}
                    </span>
                  )}
                </div>
                {file.error && <p className="hint error-text">{file.error}</p>}
                {file.warnings.map((warning) => (
                  <p className="hint" key={warning}>
                    {warning}
                  </p>
                ))}
                {file.points.length > 0 && (
                  <div className="table-scroll">
                    <table className="climb-table">
                      <thead>
                        <tr>
                          <th>{t('Timing point')}</th>
                          <th>{t('Name in results')}</th>
                          <th className="num">{t('Declared km')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {file.points.map((point) => (
                          <tr key={`${point.name}-${point.kmFromStart}`}>
                            <td>{point.label}</td>
                            <td>{point.name}</td>
                            <td className="num">{point.kmFromStart.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
