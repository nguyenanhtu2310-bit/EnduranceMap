import { passKey, type PipelineStation } from '../lib/pipeline';
import type { CrossingOverride, RaceOverrides } from '../lib/overrides';
import { TimeInput } from './TimeInput';
import { useT } from '../lib/i18n';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Names the day an offset lands on, so a cut-off is set against a date not a count. */
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

interface Props {
  station: PipelineStation;
  overrides?: RaceOverrides;
  raceDate?: string;
  onCrossingEdit: <K extends keyof CrossingOverride>(
    key: string,
    field: K,
    value: CrossingOverride[K] | undefined
  ) => void;
}

/**
 * The cut-offs at one station: one per distance that passes through it.
 *
 * Not one per station, which is the shape a table wants and the ground does not have. A
 * real card closes the same checkpoint at two different times for two groups — CP3 at
 * eleven in the morning for the 70 km and at eight in the evening for the ultras — and
 * both are true at once: the shorter field has to be through by one, and the crew stands
 * until the other.
 *
 * Shared between the naming table and the schedule because they are the same control on
 * the same data, and two copies of it would drift the moment either gained a field.
 */
export function CutoffStack({ station, overrides, raceDate, onCrossingEdit }: Props) {
  const t = useT();

  return (
    <div className="cot-stack">
      {station.crossings.map((crossing) => {
        const key = passKey(station.mapName, crossing.courseName, crossing.passIndex);
        const edit = overrides?.crossings?.[key];
        return (
          <div className="cot-row" key={key}>
            <span className="cot-course" title={crossing.courseName}>
              {crossing.courseName}
              {/* Which pass, on a course that crosses the same point twice. */}
              {crossing.passCount > 1 && <em> ·{crossing.passIndex + 1}</em>}
            </span>
            <TimeInput
              value={edit?.cutoffClock ?? crossing.officialCutoffClock ?? ''}
              align="right"
              title={`${t('Cut-off for')} ${crossing.courseName}`}
              onChange={(v) => onCrossingEdit(key, 'cutoffClock', v)}
            />
            <select
              value={edit?.cutoffDayOffset ?? 0}
              title={t('Which day this cut-off falls on')}
              onChange={(e) => onCrossingEdit(key, 'cutoffDayOffset', Number(e.target.value))}
            >
              {dayOptions(raceDate).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
