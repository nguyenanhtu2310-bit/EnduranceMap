import type { PipelineStation } from '../lib/pipeline';

interface Props {
  stations: PipelineStation[];
}

function formatHm(clock: string): string {
  return clock.slice(0, 5);
}

export function StationScheduleTable({ stations }: Props) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Station</th>
            <th>Folder</th>
            <th>Crossings</th>
            <th className="num">Open</th>
            <th className="num">Close</th>
            <th className="num">Peak /hr</th>
            <th>Activity</th>
          </tr>
        </thead>
        <tbody>
          {stations.map((station) => (
            <tr key={station.schedule.name + station.crossings[0]?.kmFromStart}>
              <td>
                {station.schedule.name}
                {station.schedule.cutoffExceeded && (
                  <>
                    {' '}
                    <span className="tag over" title="Modeled arrivals run past the official cut-off">
                      cut-off risk
                    </span>
                  </>
                )}
              </td>
              <td className="muted small">{station.folder}</td>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
