import { useState } from 'react';
import type { PipelineStation } from '../lib/pipeline';

interface Props {
  stations: PipelineStation[];
  /** Shows the map's own placemark names under each station. */
  showSourceNames?: boolean;
  /** Supplying this makes rows draggable; receives the new order as map names. */
  onReorder?: (mapNames: string[]) => void;
  /** Supplying this adds a per-row remove control; receives the station's map name. */
  onRemove?: (mapName: string) => void;
}

function formatHm(clock: string): string {
  return clock.slice(0, 5);
}

export function StationScheduleTable({ stations, showSourceNames = true, onReorder, onRemove }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

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
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {onReorder && <th aria-label="Drag to reorder" />}
            <th>Station</th>
            <th>Crossings</th>
            <th className="num">Open</th>
            <th className="num">Close</th>
            <th className="num">Peak /hr</th>
            <th>Activity</th>
            {onRemove && <th aria-label="Remove" />}
          </tr>
        </thead>
        <tbody>
          {stations.map((station) => (
            <tr
              key={station.mapName}
              draggable={!!onReorder}
              onDragStart={() => setDragging(station.mapName)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!onReorder) return;
                e.preventDefault();
                setOver(station.mapName);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(station.mapName);
              }}
              className={over === station.mapName && dragging !== station.mapName ? 'drop-target' : undefined}
            >
              {onReorder && (
                <td className="drag-cell" title="Drag to reorder">
                  ⠿
                </td>
              )}
              <td>
                <span className="station-name">{station.schedule.name}</span>
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
              <td className="num">{formatHm(station.schedule.openClockTime)}</td>
              <td className="num">{formatHm(station.schedule.closeClockTime)}</td>
              <td className="num">{Math.round(station.schedule.peakRunnersPerHour).toLocaleString()}</td>
              <td>
                <span className={`tag ${station.schedule.activityLevel}`}>{station.schedule.activityLevel}</span>
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
  );
}
