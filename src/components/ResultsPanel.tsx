import { useRef, useState } from 'react';
import type { Course } from '../lib/snap';
import { summarizeProfile, type ContestProfile } from '../lib/results';
import type { DistanceSource } from '../lib/distances';
import { useT } from '../lib/i18n';

/**
 * How the distance was arrived at, worst evidence last. Shown against every contest
 * because a race named "Ultra 70km" that measured 66 km is the difference between a
 * schedule that works and one that is six percent out all day.
 */
const DISTANCE_SOURCES: Record<DistanceSource, string> = {
  operator: 'set by you',
  measured: 'measured from pace',
  name: 'from the name — check',
  splits: 'from split labels',
  times: 'guessed from times',
  unknown: 'unknown — set it',
};

/**
 * The distance box for one contest, typed into rather than fought with.
 *
 * Held locally while it is being typed and only reported on blur or Enter. A controlled
 * number input driven straight off the profile fights the keyboard: every keystroke
 * re-derives every runner's pace and hands back a rounded value, so "10" on the way to
 * "104" comes back as 10 and the caret jumps. Reporting once, when the operator has
 * finished, also means the field is not re-modelled sixty times on the way there.
 */
function DistanceInput({
  km,
  title,
  onCommit,
}: {
  km: number;
  title: string;
  onCommit: (km: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (km > 0 ? String(km) : '');

  function commit() {
    if (text === null) return;
    const value = Number(text.replace(',', '.'));
    if (Number.isFinite(value) && value > 0) onCommit(value);
    setText(null);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      placeholder="km"
      title={title}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setText(null);
      }}
    />
  );
}

interface Props {
  fileName?: string;
  profiles: ContestProfile[];
  courses: Course[];
  /** contest name -> course name, or '' for "don't use this contest". */
  mapping: Record<string, string>;
  onLoad: (text: string, fileName: string) => void;
  onMappingChange: (mapping: Record<string, string>) => void;
  /** Corrects how far a contest was, when the file could not say. */
  onDistanceChange?: (contest: string, km: number) => void;
  /**
   * Drops a contest from the file entirely. A timing export carries rows nobody is
   * planning for — pacers, chip tests, staff entries — and leaving them listed means
   * every distance decision has to be made around them.
   */
  onRemoveContest?: (contest: string) => void;
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
  onDistanceChange,
  onRemoveContest,
  onClear,
  onError,
}: Props) {
  const t = useT();
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
            {t('Choose a different file')}
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
              <th>{t('Contest in file')}</th>
              <th className="num">{t('Finishers')}</th>
              <th className="num">{t('Distance')}</th>
              <th className="num">{t('Pace P1 / P50 / P99')}</th>
              <th className="num">{t('Start spread')}</th>
              <th>{t('Use for')}</th>
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
                  <td className="num">
                    {onDistanceChange ? (
                      <DistanceInput
                        km={profile.distanceKm}
                        title={t(DISTANCE_SOURCES[profile.distanceSource])}
                        onCommit={(km) => onDistanceChange(profile.contest, km)}
                      />
                    ) : profile.distanceKm > 0 ? (
                      `${profile.distanceKm} km`
                    ) : (
                      '—'
                    )}
                    <span className={`colocated source-${profile.distanceSource}`}>
                      {t(DISTANCE_SOURCES[profile.distanceSource])}
                    </span>
                  </td>
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
                    {onRemoveContest && (
                      <button
                        type="button"
                        className="row-remove"
                        title={t('Remove this contest')}
                        aria-label={`${t('Remove this contest')}: ${profile.contest}`}
                        onClick={() => onRemoveContest(profile.contest)}
                      >
                        ×
                      </button>
                    )}
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
