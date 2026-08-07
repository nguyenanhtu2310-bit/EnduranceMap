import { useState } from 'react';
import type { DistanceInput } from '../lib/pipeline';
import { TimeInput } from './TimeInput';
import {
  eventDayOffset,
  eventSecondsFrom,
  formatElapsedClock,
  parseElapsedClock,
  secondsToClockTime,
} from '../lib/time';
import { useT } from '../lib/i18n';

export interface DistanceFormRow extends Omit<DistanceInput, 'runnerCount'> {
  /** Kept as a string so the field can be cleared while typing. */
  runnerCountText: string;
  measuredKm: number;
}

interface Props {
  rows: DistanceFormRow[];
  onChange: (rows: DistanceFormRow[]) => void;
  /** Courses whose pace comes from a results file, so the band here is reference only. */
  drivenByResults?: Set<string>;
  /** The event's first date, so a day can be named rather than counted. */
  raceDate?: string;
  /** Courses a hand-added distance can be pointed at, longest first. */
  courses?: { name: string; totalKm: number }[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A cell that can be typed into, which sounds like nothing and was not.
 *
 * The name of a distance is also what identifies it, and a cell that reported every
 * keystroke turned each one into a rename: the half-typed word was trimmed, checked
 * against the other rows, accepted or silently refused, and written back under the
 * cursor. Typing "21km Day 1" meant renaming the distance ten times, and the row was
 * keyed on its own name, so React tore it down and rebuilt it between letters.
 *
 * So the draft stays here, local and untouched, until it is finished. Nothing outside
 * this cell hears about it until the operator leaves it or presses Enter, which is also
 * the only moment the value can honestly be judged — "21km Day" is not a name anybody
 * meant to keep, and "2" is not the time limit of someone typing "28:30".
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

  const commit = () => {
    if (draft !== null) onCommit(draft);
    setDraft(null);
  };

  return (
    <span className="editable">
      <input
        type="text"
        title={title}
        placeholder={placeholder}
        style={{ textAlign: align }}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          // Escape abandons the draft rather than committing it, so an edit started by
          // accident costs nothing.
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}

/**
 * Names the day an offset lands on, for the picker's own labels.
 *
 * Falls back to counting where no date is set, because "D+1" is still better than a
 * clock time that could mean either of two mornings.
 */
function dayOptions(raceDate?: string): { value: number; label: string }[] {
  const base = raceDate ? new Date(`${raceDate}T00:00:00`) : null;
  const usable = base && !Number.isNaN(base.getTime()) ? base : null;
  return [0, 1, 2, 3].map((value) => {
    if (!usable) return { value, label: value === 0 ? 'Day 1' : `D+${value}` };
    const day = new Date(usable);
    day.setDate(day.getDate() + value);
    return { value, label: `${WEEKDAYS[day.getDay()]} ${day.getDate()}` };
  });
}

function DayPicker({
  value,
  onChange,
  raceDate,
  title,
}: {
  value: number;
  onChange: (day: number) => void;
  raceDate?: string;
  title: string;
}) {
  return (
    <select value={value} title={title} onChange={(e) => onChange(Number(e.target.value))}>
      {dayOptions(raceDate).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

const NUMERIC_FIELDS = [
  { key: 'fastestMinPerKm', label: 'Fastest', title: 'Pace of the leading runners, in minutes per km' },
  { key: 'typicalMinPerKm', label: 'Typical', title: 'Median runner pace, in minutes per km' },
  { key: 'slowestMinPerKm', label: 'Slowest', title: 'Pace of the final finishers, in minutes per km' },
] as const;

export function PaceBandForm({ rows, onChange, drivenByResults, raceDate, courses = [] }: Props) {
  const t = useT();
  function update(index: number, patch: Partial<DistanceFormRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /*
   * A distance the route files do not describe, running on a course that they do.
   *
   * One route is often raced by more than one field — an elite wave off the same start an
   * hour earlier, a relay on the marathon course, a category with its own cut-off. Each
   * needs its own start, its own field size and its own band, and until now the only
   * distances on offer were the ones a file happened to contain.
   *
   * It borrows an existing course's geometry rather than inventing any: the pipeline
   * already gives a named leg its own copy of a drawn route, which is the same problem.
   */
  /** The route a row runs, which is its own name until it has been renamed. */
  const routeOf = (row: DistanceFormRow) => row.sourceCourseName ?? row.courseName;

  /**
   * Renames a distance while keeping the route under it.
   *
   * A card can want two of one course — "21km Day 1" and "21km Day 2", the same trail run
   * twice to take a field the path cannot hold at once — and each needs its own name, its
   * own gun and its own cut-off. Renaming pins the route down as the row's source, so the
   * name is free to be whatever the race calls it.
   */
  function rename(index: number, name: string) {
    const row = rows[index];
    const trimmed = name.trim();
    if (!trimmed || rows.some((r, i) => i !== index && r.courseName === trimmed)) return;
    update(index, { courseName: trimmed, sourceCourseName: routeOf(row) });
  }

  /**
   * The elapsed limit a row allows, worked out from its gun and its cut-off.
   *
   * Derived rather than stored. A limit and a cut-off are two ways of saying one thing —
   * "28 hours" and "Sunday 09:00" from a Saturday 05:00 gun — and holding both would let
   * them disagree, at which point the schedule has to pick one and the operator cannot
   * see which. So the cut-off stays the record and this is a view of it.
   */
  function limitOf(row: DistanceFormRow): string {
    const start = eventSecondsFrom(row.startTimeClock, row.startDayOffset ?? 0);
    const cutoff = row.organizerCutoffClock
      ? eventSecondsFrom(row.organizerCutoffClock, row.cutoffDayOffset ?? 0)
      : null;
    if (start === null || cutoff === null || cutoff <= start) return '';
    return formatElapsedClock(cutoff - start);
  }

  /**
   * Sets the cut-off from a limit typed in its place.
   *
   * The day falls out of the arithmetic rather than being asked for: Friday 08:00 plus
   * 49 hours is Sunday 09:00, and an organizer who knows the race is 49 hours should not
   * also have to work out which morning that lands on — getting it wrong by a day is the
   * single mistake this tool exists to stop.
   */
  function setLimit(index: number, text: string) {
    const row = rows[index];
    const trimmed = text.trim();
    if (!trimmed) {
      update(index, { organizerCutoffClock: '', cutoffDayOffset: 0 });
      return;
    }

    const limit = parseElapsedClock(trimmed);
    const start = eventSecondsFrom(row.startTimeClock, row.startDayOffset ?? 0);
    if (limit === null || limit <= 0 || start === null) return;

    const cutoff = start + limit;
    update(index, {
      organizerCutoffClock: secondsToClockTime(cutoff % 86400).slice(0, 5),
      cutoffDayOffset: eventDayOffset(cutoff),
    });
  }

  /** Points a distance at a different route, taking that route's measured length. */
  function reroute(index: number, courseName: string) {
    const course = courses.find((c) => c.name === courseName);
    if (!course) return;
    update(index, { sourceCourseName: course.name, measuredKm: course.totalKm });
  }

  function addRow() {
    const source = courses[0];
    if (!source) return;
    const base = rows.find((r) => routeOf(r) === source.name);
    let name = `${source.name} (2)`;
    for (let n = 2; rows.some((r) => r.courseName === name); n++) name = `${source.name} (${n})`;
    onChange([
      ...rows,
      {
        ...(base ?? {
          startTimeClock: '05:00',
          startSpreadMinutes: 10,
          fastestMinPerKm: 3.2,
          typicalMinPerKm: 6.5,
          slowestMinPerKm: 10,
        }),
        courseName: name,
        sourceCourseName: source.name,
        measuredKm: source.totalKm,
        runnerCountText: '100',
        organizerCutoffClock: '',
      } as DistanceFormRow,
    ]);
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('Distance')}</th>
            <th className="num">{t('Measured')}</th>
            <th>{t('Start')}</th>
            <th title={t('Which day of the event this distance starts on')}>{t('Start day')}</th>
            <th className="num" title={t('Minutes over which the whole field crosses the start line')}>
              {t('Spread (min)')}
            </th>
            <th className="num">{t('Runners')}</th>
            {NUMERIC_FIELDS.map((f) => (
              <th key={f.key} className="num" title={t(f.title)}>
                {t(f.label)}
              </th>
            ))}
            <th className="num" title="Cut-off time provided by the organizer — leave blank if not provided yet">
              COT
            </th>
            <th title={t('Which day the cut-off falls on — an ultra finishes on another day')}>
              {t('COT day')}
            </th>
            <th
              className="num"
              title={t('How long this distance has, from its own gun — type either this or the cut-off')}
            >
              {t('Time limit')}
            </th>
            <th aria-label={t('Remove')} />
          </tr>
        </thead>
        <tbody>
          {/* Keyed by position, not by name — the name is the thing being edited, and a
              row that changes key while it is typed into is a row React replaces. */}
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <DraftCell
                  value={row.courseName}
                  title={t('What this distance is called')}
                  onCommit={(value) => rename(i, value)}
                />
                {drivenByResults?.has(row.courseName) && (
                  <span className="colocated">{t('from results file')}</span>
                )}
              </td>
              <td className="num muted">
                {courses.length > 1 ? (
                  <select
                    value={routeOf(row)}
                    title={t('Which route this distance runs')}
                    onChange={(e) => reroute(i, e.target.value)}
                  >
                    {courses.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} · {c.totalKm.toFixed(1)} km
                      </option>
                    ))}
                  </select>
                ) : (
                  `${row.measuredKm.toFixed(2)} km`
                )}
              </td>
              <td style={{ minWidth: 110 }}>
                <TimeInput
                  value={row.startTimeClock}
                  onChange={(v) => update(i, { startTimeClock: v })}
                  title="Gun time for this distance"
                />
              </td>
              <td style={{ minWidth: 96 }}>
                <DayPicker
                  value={row.startDayOffset ?? 0}
                  onChange={(day) => update(i, { startDayOffset: day })}
                  raceDate={raceDate}
                  title={t('Which day of the event this distance starts on')}
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
              <td className="num" style={{ minWidth: 104 }}>
                <TimeInput
                  value={row.organizerCutoffClock ?? ''}
                  onChange={(v) => update(i, { organizerCutoffClock: v })}
                  align="right"
                  title="Official finish cut-off"
                />
              </td>
              <td style={{ minWidth: 96 }}>
                <DayPicker
                  value={row.cutoffDayOffset ?? 0}
                  onChange={(day) => update(i, { cutoffDayOffset: day })}
                  raceDate={raceDate}
                  title={t('Which day the cut-off falls on')}
                />
              </td>
              <td className="num" style={{ minWidth: 88 }}>
                <DraftCell
                  value={limitOf(row)}
                  align="right"
                  placeholder="h:mm"
                  title={t('How long this distance has, from its own gun')}
                  onCommit={(text) => setLimit(i, text)}
                />
              </td>
              <td>
                {rows.length > courses.length && (
                  <button
                    type="button"
                    className="row-remove"
                    title={t('Remove this distance')}
                    onClick={() => removeRow(i)}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {courses.length > 0 && (
        <div className="actions" style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary" onClick={addRow}>
            + {t('Add a distance')}
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {t('For a wave, a relay or a category racing a course the files already hold.')}
          </span>
        </div>
      )}

      <p className="hint" style={{ margin: '0.75rem 0 0' }}>
        {t(
          'Paces are minutes per km. Fastest and slowest anchor the P1 and P99 arrivals; spread is how long the field takes to clear the start line. COT is the finish cut-off the organizer has set for that distance — leave it blank if it has not been provided yet, and the tool proposes one instead.'
        )}
      </p>
    </div>
  );
}
