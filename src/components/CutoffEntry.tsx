import type { Course } from '../lib/snap';
import type { PipelineStation } from '../lib/pipeline';

interface Props {
  stations: PipelineStation[];
  courses: Course[];
  /** station map-name -> course name -> "HH:MM". */
  value: Record<string, Record<string, string>>;
  onChange: (value: Record<string, Record<string, string>>) => void;
}

/** Longest first, matching how a race schedule is read. */
function orderedCourses(courses: Course[]): Course[] {
  return [...courses].sort((a, b) => b.totalKm - a.totalKm);
}

export function CutoffEntry({ stations, courses, value, onChange }: Props) {
  const cols = orderedCourses(courses);

  if (stations.length === 0) {
    return <p className="hint">Calculate a schedule first — the stations to set cut-offs for come from it.</p>;
  }

  function set(station: string, course: string, time: string) {
    const forStation = { ...(value[station] ?? {}) };
    if (time) forStation[course] = time;
    else delete forStation[course];

    const next = { ...value };
    if (Object.keys(forStation).length > 0) next[station] = forStation;
    else delete next[station];

    onChange(next);
  }

  const entered = Object.values(value).reduce((sum, byCourse) => sum + Object.keys(byCourse).length, 0);

  return (
    <>
      <div className="table-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th>Station</th>
              {cols.map((c) => (
                <th key={c.name}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stations.map((station) => (
              <tr key={station.mapName}>
                <td className="row-head">
                  {station.schedule.name}
                  {station.schedule.name !== station.mapName && (
                    <span className="colocated">{station.mapName}</span>
                  )}
                </td>
                {cols.map((course) => {
                  const crossing = station.crossings.find((c) => c.courseName === course.name);
                  if (!crossing) {
                    return (
                      <td key={course.name} className="absent">
                        –
                      </td>
                    );
                  }
                  const manual = value[station.mapName]?.[course.name] ?? '';
                  const fromMap = crossing.officialCutoffClock;
                  return (
                    <td key={course.name}>
                      <input
                        type="time"
                        value={manual}
                        onChange={(e) => set(station.mapName, course.name, e.target.value)}
                        style={{ minWidth: 104 }}
                      />
                      {!manual && fromMap && <span className="cot">from map: {fromMap}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions" style={{ marginTop: '0.85rem' }}>
        <span className="hint" style={{ margin: 0 }}>
          {entered === 0
            ? 'Nothing entered — cut-offs come from the map’s placemark names.'
            : `${entered} cut-off${entered === 1 ? '' : 's'} entered. These override the map.`}
        </span>
        {entered > 0 && (
          <button className="secondary" onClick={() => onChange({})}>
            Clear all
          </button>
        )}
      </div>
      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        A dash means that distance does not pass the station. Leaving a cell empty keeps whatever the map
        says; anything typed here wins, since the organiser’s sheet is the source of truth and the map is a
        transcription of it. Re-run the calculation to apply.
      </p>
    </>
  );
}
