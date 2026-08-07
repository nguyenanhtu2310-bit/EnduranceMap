import { useState } from 'react';
import type { ManualStation } from '../lib/manualStations';
import { TimeInput } from './TimeInput';
import { useT } from '../lib/i18n';

interface Props {
  stations: ManualStation[];
  onChange: (stations: ManualStation[]) => void;
  /** The routes those kilometres can be measured along, longest first. */
  courses: { name: string; totalKm: number }[];
  /** Anything the placement could not do, so a bad row is not merely absent. */
  warnings?: string[];
}

/**
 * A cell holding its own draft until it is finished.
 *
 * The same reason the race card needs one: a name reported on every keystroke is a
 * rename per letter, and a distance parsed half-typed turns "12.4" into 12 and then 124
 * on its way past the decimal point.
 */
function DraftCell({
  value,
  title,
  align = 'left',
  placeholder,
  onCommit,
}: {
  value: string;
  title: string;
  align?: 'left' | 'right';
  placeholder?: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      title={title}
      placeholder={placeholder}
      style={{ textAlign: align }}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Stations typed in from the table a race publishes, rather than pinned on a map.
 *
 * Every race with a website has this table — checkpoint, place, cumulative kilometres,
 * often the cut-off — and it is published months before anyone draws a KML. Until now a
 * station could only come from a pin somebody had dropped or a mat a timing system had
 * declared, which meant the whole plan waited on a file that arrives last.
 *
 * Nothing downstream knows the difference. A station placed from a distance is a station:
 * the arrivals are modelled, the traffic is counted and the schedule is built exactly as
 * for one that came off a map.
 */
export function ManualStationsPanel({ stations, onChange, courses, warnings = [] }: Props) {
  const t = useT();
  const longest = courses[0]?.name ?? '';

  const update = (index: number, patch: Partial<ManualStation>) =>
    onChange(stations.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  function addRow() {
    if (!longest) return;
    onChange([...stations, { name: '', km: 0, courseName: longest }]);
  }

  if (courses.length === 0) {
    return (
      <p className="hint">
        {t('Load a route first — a distance from the start needs a course to measure along.')}
      </p>
    );
  }

  return (
    <>
      {stations.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Station')}</th>
                <th>{t('Measured along')}</th>
                <th className="num">{t('Km from start')}</th>
                <th className="num">{t('Cut-off')}</th>
                <th aria-label={t('Remove')} />
              </tr>
            </thead>
            <tbody>
              {/* Keyed by position: the name is the thing being typed, and a row that
                  changes key while it is typed into is a row React replaces. */}
              {stations.map((station, i) => (
                <tr key={i}>
                  <td>
                    <DraftCell
                      value={station.name}
                      title={t('What the race calls this station')}
                      placeholder="CP3"
                      onCommit={(name) => update(i, { name })}
                    />
                  </td>
                  <td>
                    <select
                      value={station.courseName}
                      title={t('The route these kilometres are counted along')}
                      onChange={(e) => update(i, { courseName: e.target.value })}
                    >
                      {courses.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} · {c.totalKm.toFixed(1)} km
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <DraftCell
                      value={Number.isFinite(station.km) ? String(station.km) : ''}
                      align="right"
                      placeholder="26.2"
                      title={t('Cumulative distance from the start')}
                      onCommit={(text) => update(i, { km: Number(text.replace(',', '.')) })}
                    />
                  </td>
                  <td className="num">
                    <TimeInput
                      value={station.cutoffClock ?? ''}
                      align="right"
                      title={t('Cut-off at this station, if the table publishes one')}
                      onChange={(v) => update(i, { cutoffClock: v })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="row-remove"
                      title={t('Remove this station')}
                      aria-label={`${t('Remove this station')}: ${station.name || i + 1}`}
                      onClick={() => onChange(stations.filter((_, n) => n !== i))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions" style={{ margin: stations.length > 0 ? '0.75rem 0 0' : 0 }}>
        <button className="secondary" onClick={addRow}>
          + {t('Add a station')}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {t('From the distance table the race publishes — no map pin needed.')}
        </span>
      </div>

      {/* A row that could not be placed is said so, not merely left out: the usual cause
          is a table read against the wrong distance, which is fixable and invisible. */}
      {warnings.map((warning) => (
        <p className="hint" key={warning}>
          {warning}
        </p>
      ))}
    </>
  );
}
