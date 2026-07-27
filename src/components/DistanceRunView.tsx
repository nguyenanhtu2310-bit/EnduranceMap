import { useState } from 'react';
import type { PipelineResult, PipelineStation } from '../lib/pipeline';
import { parseClockTimeToSeconds, secondsToClockTime } from '../lib/time';

interface Props {
  result: PipelineResult;
}

function hm(clock: string): string {
  const seconds = parseClockTimeToSeconds(clock);
  return seconds === null ? clock : secondsToClockTime(seconds).slice(0, 5);
}

interface Stop {
  station: PipelineStation;
  kmFromStart: number;
  passIndex: number;
  passCount: number;
  gapKm: number;
  officialCutoffClock?: string;
}

/**
 * Every point a runner on one distance actually meets, in the order they meet it.
 * A station the course passes twice appears twice — on an out-and-back the second
 * visit is a separate resupply, and spacing it as though it were one stop understates
 * what the position has to carry.
 */
function buildRun(result: PipelineResult, courseName: string): Stop[] {
  const stops: Stop[] = [];

  for (const station of result.stations) {
    for (const crossing of station.crossings) {
      if (crossing.courseName !== courseName) continue;
      stops.push({
        station,
        kmFromStart: crossing.kmFromStart,
        passIndex: crossing.passIndex,
        passCount: crossing.passCount,
        gapKm: 0,
        officialCutoffClock: crossing.officialCutoffClock,
      });
    }
  }

  stops.sort((a, b) => a.kmFromStart - b.kmFromStart);

  let previousKm = 0;
  for (const stop of stops) {
    stop.gapKm = stop.kmFromStart - previousKm;
    previousKm = stop.kmFromStart;
  }

  return stops;
}

export function DistanceRunView({ result }: Props) {
  const courses = [...result.courses]
    .filter((c) => result.courseOrder.includes(c.name))
    .sort((a, b) => b.totalKm - a.totalKm);

  const [selected, setSelected] = useState(courses[0]?.name ?? '');
  const course = courses.find((c) => c.name === selected) ?? courses[0];

  if (!course) return <p className="hint">No distances to show.</p>;

  const stops = buildRun(result, course.name);
  const finalGap = course.totalKm - (stops[stops.length - 1]?.kmFromStart ?? 0);
  const longestGap = Math.max(0, ...stops.map((s) => s.gapKm), finalGap);

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: '1rem' }}>
        {courses.map((c) => (
          <button
            key={c.name}
            className={c.name === course.name ? undefined : 'secondary'}
            onClick={() => setSelected(c.name)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {stops.length === 0 ? (
        <p className="hint">No scheduled positions sit on the {course.name} route.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Point</th>
                <th className="num">At km</th>
                <th className="num">Gap from previous</th>
                <th className="num">Open</th>
                <th className="num">Close</th>
                <th className="num">Cut-off</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((stop, i) => (
                <tr key={`${stop.station.mapName}-${stop.passIndex}`}>
                  <td className="num muted">{i + 1}</td>
                  <td>
                    <span className="station-name">{stop.station.schedule.name}</span>
                    {stop.passCount > 1 && (
                      <span className="colocated">
                        pass {stop.passIndex + 1} of {stop.passCount}
                      </span>
                    )}
                  </td>
                  <td className="num">{stop.kmFromStart.toFixed(1)}</td>
                  <td className="num">
                    {stop.gapKm.toFixed(1)}
                    {stop.gapKm === longestGap && stop.gapKm > 0 && (
                      <span className="tag over" style={{ marginLeft: '0.4rem' }}>
                        longest
                      </span>
                    )}
                  </td>
                  <td className="num">{hm(stop.station.schedule.openClockTime)}</td>
                  <td className="num">{hm(stop.station.schedule.closeClockTime)}</td>
                  <td className="num">{stop.officialCutoffClock ? hm(stop.officialCutoffClock) : '–'}</td>
                  <td>
                    <span className={`tag ${stop.station.schedule.activityLevel}`}>
                      {stop.station.schedule.activityLevel}
                    </span>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="num muted">—</td>
                <td className="muted">Course end</td>
                <td className="num">{course.totalKm.toFixed(1)}</td>
                <td className="num">
                  {finalGap.toFixed(1)}
                  {finalGap === longestGap && finalGap > 0 && (
                    <span className="tag over" style={{ marginLeft: '0.4rem' }}>
                      longest
                    </span>
                  )}
                </td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td className="num">—</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        {stops.length} stop{stops.length === 1 ? '' : 's'} over {course.totalKm.toFixed(1)} km, longest gap{' '}
        <strong>{longestGap.toFixed(1)} km</strong>. Gaps are measured along this distance's own route, so a
        point the course passes twice is listed twice — the second visit is a separate resupply.
      </p>
    </>
  );
}
