import { useMemo, useState } from 'react';
import type { PipelineStation } from '../lib/pipeline';
import { peakRunnersPerWindow, type ActivityLevel } from '../lib/schedule';
import { secondsToClockTime } from '../lib/time';
import { useT } from '../lib/i18n';
import { DEFAULT_HISTOGRAM_BIN_MINUTES } from '../lib/config';
import type { RaceOverrides, StationOverride } from '../lib/overrides';
import { EditableCell } from './EditableCell';
import { formatDuration, windowSeconds } from '../lib/time';

/**
 * When the busiest window falls, beside how many arrive in it. The count says how much
 * to send; the clock says when to have it there, and reading it off a chart in another
 * section was a step the schedule could take for itself.
 */
function peakWindow(station: PipelineStation): string {
  const bin = station.peakBinIndex >= 0 ? station.distribution[station.peakBinIndex] : undefined;
  if (!bin) return '—';
  const hm = (seconds: number) => secondsToClockTime(seconds).slice(0, 5);
  return `${hm(bin.binStartSeconds)}–${hm(bin.binEndSeconds)}`;
}

interface Props {
  stations: PipelineStation[];
  /** Width of the counting window, so the peak column can say what it counted. */
  binMinutes?: number;
  /** Shows the map's own placemark names under each station. */
  showSourceNames?: boolean;
  /** Supplying this makes rows draggable; receives the new order as map names. */
  onReorder?: (mapNames: string[]) => void;
  /** Supplying this adds a per-row remove control; receives the station's map name. */
  onRemove?: (mapName: string) => void;
  /** Operator note under each name — staff assignment, decoder serial. */
  notes?: Record<string, string>;
  onNoteChange?: (mapName: string, note: string) => void;
  /** Supplying these makes the computed columns editable. */
  overrides?: RaceOverrides;
  onStationEdit?: <K extends keyof StationOverride>(
    mapName: string,
    field: K,
    value: StationOverride[K] | undefined
  ) => void;
}

function formatHm(clock: string): string {
  return clock.slice(0, 5);
}

/**
 * How the table is ordered. The default is the order stations are met on course, which
 * is also the order the operator can drag into shape; the others answer the two
 * questions asked when planning a day's staffing — who is out first, and who is out
 * longest. Sorting is a way of looking at the table, not a change to it, so the manual
 * order is untouched underneath and dragging is disabled while a sort is on.
 */
type SortKey = 'course' | 'open' | 'close' | 'duration';

const SORT_LABELS: Record<Exclude<SortKey, 'course'>, string> = {
  open: 'Opens earliest first',
  close: 'Closes latest first',
  duration: 'Longest open first',
};

function openSeconds(station: PipelineStation): number {
  return windowSeconds('00:00:00', station.schedule.openClockTime) ?? 0;
}

function stationWindowSeconds(station: PipelineStation): number {
  return windowSeconds(station.schedule.openClockTime, station.schedule.closeClockTime) ?? 0;
}

export function StationScheduleTable({
  stations,
  binMinutes = DEFAULT_HISTOGRAM_BIN_MINUTES,
  showSourceNames = true,
  onReorder,
  onRemove,
  notes,
  onNoteChange,
  overrides,
  onStationEdit,
}: Props) {
  const t = useT();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('course');

  const shown = useMemo(() => {
    if (sort === 'course') return stations;
    const ranked = [...stations];
    if (sort === 'open') ranked.sort((a, b) => openSeconds(a) - openSeconds(b));
    // Latest closing and longest open are both "most exposed first", so they descend.
    if (sort === 'close') {
      ranked.sort((a, b) => openSeconds(b) + stationWindowSeconds(b) - (openSeconds(a) + stationWindowSeconds(a)));
    }
    if (sort === 'duration') ranked.sort((a, b) => stationWindowSeconds(b) - stationWindowSeconds(a));
    return ranked;
  }, [stations, sort]);

  const sorted = sort !== 'course';
  const canDrag = !!onReorder && !sorted;

  function drop(targetMapName: string) {
    if (!onReorder || !dragging || dragging === targetMapName) return;

    const names = stations.map((s) => s.mapName);
    const from = names.indexOf(dragging);
    const to = names.indexOf(targetMapName);
    if (from < 0 || to < 0) return;

    names.splice(to, 0, ...names.splice(from, 1));
    onReorder(names);
    setDragging(null);
    setOver(null);
  }

  return (
    <>
      <div className="sort-bar">
        <span className="sort-label">{t('Order')}</span>
        <button
          type="button"
          className={sort === 'course' ? 'sort-chip on' : 'sort-chip'}
          onClick={() => setSort('course')}
          title={onReorder ? 'The order stations are met on course — drag to rearrange' : 'The order stations are met on course'}
        >
          {t('On course')}
        </button>
        {(['open', 'close', 'duration'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={sort === key ? 'sort-chip on' : 'sort-chip'}
            onClick={() => setSort(sort === key ? 'course' : key)}
            title={t(SORT_LABELS[key])}
          >
            {t(SORT_LABELS[key])}
          </button>
        ))}
        {sorted && onReorder && <span className="hint sort-note">Dragging is off while sorted.</span>}
      </div>

    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {onReorder && <th aria-label="Drag to reorder" />}
            <th>{t('Station')}</th>
            <th>{t('Crossings')}</th>
            <th className="num">{t('Open')}</th>
            <th className="num">{t('Close')}</th>
            <th className="num">{t('Duration')}</th>
            <th className="num">{t('Peak window')}</th>
            <th className="num">{t('Peak')} /{binMinutes} {t('min')}</th>
            <th>{t('Activity')}</th>
            {onRemove && <th aria-label="Remove" />}
          </tr>
        </thead>
        <tbody>
          {shown.map((station) => (
            <tr
              key={station.mapName}
              draggable={canDrag}
              onDragStart={() => setDragging(station.mapName)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!canDrag) return;
                e.preventDefault();
                setOver(station.mapName);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (canDrag) drop(station.mapName);
              }}
              className={over === station.mapName && dragging !== station.mapName ? 'drop-target' : undefined}
            >
              {onReorder && (
                <td className="drag-cell" title="Drag to reorder">
                  ⠿
                </td>
              )}
              <td>
                {onStationEdit ? (
                  <EditableCell
                    computed={station.schedule.name}
                    override={overrides?.stations?.[station.mapName]?.name}
                    type="text"
                    title="Station name"
                    onChange={(v) => onStationEdit(station.mapName, 'name', v)}
                  />
                ) : (
                  <span className="station-name">{station.schedule.name}</span>
                )}
                {station.schedule.cutoffExceeded && (
                  <>
                    {' '}
                    <span className="tag over" title="Modeled arrivals run past the official cut-off">
                      cut-off risk
                    </span>
                  </>
                )}
                {showSourceNames && station.sourceNames.length > 0 && (
                  <span className="colocated">{station.sourceNames.join(', ')}</span>
                )}
                {station.coLocatedNames.length > 0 && (
                  <span className="colocated" title="Placemarks from other folders at this same position">
                    at {station.coLocatedNames.join(', ')}
                  </span>
                )}
                {onNoteChange && (
                  <input
                    className="note-input"
                    type="text"
                    value={notes?.[station.mapName] ?? ''}
                    placeholder="Note"
                    title="Shown under this station in every section and in the report"
                    onChange={(e) => onNoteChange(station.mapName, e.target.value)}
                  />
                )}
              </td>
              <td>
                {station.crossings.map((crossing, i) => (
                  <span
                    key={i}
                    className="pill"
                    title={
                      crossing.passCount > 1
                        ? `${crossing.courseName} pass ${crossing.passIndex + 1} of ${crossing.passCount}`
                        : crossing.courseName
                    }
                  >
                    {crossing.courseName} {crossing.kmFromStart.toFixed(1)}km
                    {crossing.passCount > 1 ? ` (${crossing.passIndex + 1}/${crossing.passCount})` : ''}
                  </span>
                ))}
              </td>
              <td className="num">
                {onStationEdit ? (
                  <EditableCell
                    computed={formatHm(station.schedule.openClockTime)}
                    override={overrides?.stations?.[station.mapName]?.openClockTime}
                    type="time"
                    align="right"
                    title="Open time"
                    onChange={(v) => onStationEdit(station.mapName, 'openClockTime', v)}
                  />
                ) : (
                  formatHm(station.schedule.openClockTime)
                )}
              </td>
              <td className="num">
                {onStationEdit ? (
                  <EditableCell
                    computed={formatHm(station.schedule.closeClockTime)}
                    override={overrides?.stations?.[station.mapName]?.closeClockTime}
                    type="time"
                    align="right"
                    title="Close time"
                    onChange={(v) => onStationEdit(station.mapName, 'closeClockTime', v)}
                  />
                ) : (
                  formatHm(station.schedule.closeClockTime)
                )}
              </td>
              <td className="num">
                {(() => {
                  const seconds = stationWindowSeconds(station);
                  return seconds > 0 ? formatDuration(seconds) : '—';
                })()}
              </td>
              <td className="num">{peakWindow(station)}</td>
              <td className="num">
                {peakRunnersPerWindow(station.schedule.peakRunnersPerHour, binMinutes).toLocaleString()}
              </td>
              <td>
                {onStationEdit ? (
                  <select
                    className={[
                      'level-select',
                      station.schedule.activityLevel,
                      overrides?.stations?.[station.mapName]?.activityLevel ? 'edited' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    value={station.schedule.activityLevel}
                    onChange={(e) =>
                      onStationEdit(
                        station.mapName,
                        'activityLevel',
                        (e.target.value || undefined) as ActivityLevel | undefined
                      )
                    }
                  >
                    {(['Low', 'Medium', 'High'] as const).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`tag ${station.schedule.activityLevel}`}>{station.schedule.activityLevel}</span>
                )}
              </td>
              {onRemove && (
                <td>
                  <button
                    type="button"
                    className="row-remove"
                    title={`Remove ${station.schedule.name} from every section`}
                    onClick={() => onRemove(station.mapName)}
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
