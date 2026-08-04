import { useState } from 'react';
import type { PipelineResult } from '../lib/pipeline';
import { secondsToClockTime } from '../lib/time';
import { buildStationTraffic } from '../lib/stationTraffic';
import { StationTraffic } from './StationTraffic';

interface Props {
  result: PipelineResult;
  /** Colour for a distance's slot, shared with the overview chart. */
  colourFor: (courseIndex: number) => string;
}

/**
 * Every station's traffic, one foldable block each.
 *
 * Its own section rather than a view inside the overview chart: the two answer
 * different questions for different people. The overview is the race day for a director
 * planning the whole event; this is one point's morning for the crew standing on it,
 * and a crew chief opening the plan should be able to reach their page without first
 * knowing it lives behind a toggle on someone else's chart.
 */
export function StationTrafficList({ result, colourFor }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (result.stations.length === 0) {
    return <p className="hint">No stations to describe.</p>;
  }

  const hm = (seconds: number) => secondsToClockTime(seconds).slice(0, 5);

  return (
    <div className="station-list">
      {result.stations.map((station) => {
        const isOpen = open[station.schedule.name] ?? false;
        const view = buildStationTraffic(station, result.courseOrder);

        return (
          <div className="station-detail" key={station.schedule.name}>
            <button
              type="button"
              className="section-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpen((current) => ({ ...current, [station.schedule.name]: !isOpen }))}
            >
              <span className="section-caret" aria-hidden="true">
                {isOpen ? '▾' : '▸'}
              </span>
              <h3>{station.schedule.name}</h3>
              <span className="section-summary muted small">
                {view
                  ? `${view.total.toLocaleString()} visits · busiest ${view.busiestBin.total.toLocaleString()} at ${hm(
                      view.busiestBin.binStartSeconds
                    )}`
                  : 'no arrivals'}
              </span>
            </button>
            {isOpen && (
              <StationTraffic
                station={station}
                courseOrder={result.courseOrder}
                binMinutes={result.binMinutes}
                colourFor={colourFor}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
