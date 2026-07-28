import {
  isRoutedLeg,
  type LegBand,
  type MultisportLeg,
  type MultisportPlan,
  type MultisportRace,
  type PlanProblem,
} from '../lib/multisport';
import type { Course } from '../lib/snap';
import { TimeInput } from './TimeInput';

interface Props {
  plan: MultisportPlan;
  courses: Course[];
  onChange: (next: MultisportPlan) => void;
  problems?: PlanProblem[];
  /** Legs whose times come from a results file rather than the band typed here. */
  drivenByResults?: Set<string>;
  onAddRace?: () => void;
  onRemoveRace?: (raceId: string) => void;
}

/**
 * How a leg's three numbers are shown and stored.
 *
 * A bike leg is stored in minutes per kilometre like everything else, because that is
 * what the arrival model wants, but nobody plans a bike course in minutes per kilometre.
 * It is shown in km/h and converted on the way in and out — which also flips the order,
 * since the fastest athlete has the highest speed and the lowest pace.
 */
interface BandUnit {
  label: string;
  toDisplay: (stored: number) => number;
  toStored: (shown: number) => number;
  step: number;
}

const MIN_PER_KM: BandUnit = { label: 'min/km', toDisplay: (v) => v, toStored: (v) => v, step: 0.1 };
const MINUTES: BandUnit = { label: 'min', toDisplay: (v) => v, toStored: (v) => v, step: 1 };
const KM_PER_HOUR: BandUnit = {
  label: 'km/h',
  toDisplay: (v) => (v > 0 ? 60 / v : 0),
  toStored: (v) => (v > 0 ? 60 / v : 0),
  step: 0.5,
};

function unitFor(leg: MultisportLeg): BandUnit {
  if (leg.band.mode === 'duration') return MINUTES;
  return leg.kind === 'bike' ? KM_PER_HOUR : MIN_PER_KM;
}

/** The three band numbers in the order they are stored: fastest, typical, slowest. */
function bandValues(band: LegBand): [number, number, number] {
  return band.mode === 'pace'
    ? [band.fastestMinPerKm, band.typicalMinPerKm, band.slowestMinPerKm]
    : [band.fastestMinutes, band.typicalMinutes, band.slowestMinutes];
}

function withBandValue(band: LegBand, index: 0 | 1 | 2, value: number): LegBand {
  const next = bandValues(band);
  next[index] = value;
  return band.mode === 'pace'
    ? { mode: 'pace', fastestMinPerKm: next[0], typicalMinPerKm: next[1], slowestMinPerKm: next[2] }
    : { mode: 'duration', fastestMinutes: next[0], typicalMinutes: next[1], slowestMinutes: next[2] };
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places));
}

export function MultisportPaceBandForm({
  plan,
  courses,
  onChange,
  problems = [],
  drivenByResults,
  onAddRace,
  onRemoveRace,
}: Props) {
  const courseByName = new Map(courses.map((c) => [c.name, c]));

  function updateRace(raceId: string, patch: Partial<MultisportRace>) {
    onChange({ races: plan.races.map((r) => (r.id === raceId ? { ...r, ...patch } : r)) });
  }

  function updateLeg(raceId: string, legId: string, patch: Partial<MultisportLeg>) {
    onChange({
      races: plan.races.map((race) =>
        race.id !== raceId
          ? race
          : { ...race, legs: race.legs.map((leg) => (leg.id === legId ? { ...leg, ...patch } : leg)) }
      ),
    });
  }

  const legProblem = (legId: string) => problems.some((p) => p.legId === legId);

  return (
    <>
      {plan.races.map((race) => (
        <div key={race.id} className="ms-race">
          <div className="ms-race-head">
            <label>
              Race
              <input
                type="text"
                value={race.name}
                placeholder="IRONMAN 70.3"
                onChange={(e) => updateRace(race.id, { name: e.target.value })}
              />
            </label>
            <label>
              Start
              <TimeInput
                value={race.startTimeClock}
                onChange={(v) => updateRace(race.id, { startTimeClock: v })}
                title="Gun time — the swim start"
              />
            </label>
            <label>
              Spread (min)
              <input
                type="number"
                min={0}
                step={1}
                value={race.startSpreadMinutes}
                onChange={(e) => updateRace(race.id, { startSpreadMinutes: Number(e.target.value) })}
              />
            </label>
            <label>
              Athletes
              <input
                type="number"
                min={0}
                step={10}
                value={race.runnerCountText}
                onChange={(e) => updateRace(race.id, { runnerCountText: e.target.value })}
              />
            </label>
            <label>
              Finish COT
              <TimeInput
                value={race.organizerCutoffClock ?? ''}
                onChange={(v) => updateRace(race.id, { organizerCutoffClock: v })}
                title="Official finish cut-off"
              />
            </label>
            {onRemoveRace && plan.races.length > 1 && (
              <button
                type="button"
                className="row-remove"
                title={`Remove ${race.name}`}
                onClick={() => onRemoveRace(race.id)}
              >
                ×
              </button>
            )}
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Leg</th>
                  <th className="num">Distance (km)</th>
                  <th>Route on the map</th>
                  <th className="num">Fastest</th>
                  <th className="num">Typical</th>
                  <th className="num">Slowest</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {race.legs.map((leg) => {
                  const unit = unitFor(leg);
                  const routed = isRoutedLeg(leg.kind);
                  const bound = leg.courseName ? courseByName.get(leg.courseName) : undefined;
                  const values = bandValues(leg.band);

                  return (
                    <tr key={leg.id} className={legProblem(leg.id) ? 'ms-leg-problem' : undefined}>
                      <td>
                        <span className="station-name">{leg.label}</span>
                        <span className="colocated">{leg.kind}</span>
                        {drivenByResults?.has(leg.id) && (
                          <span className="colocated">from results file</span>
                        )}
                      </td>

                      <td className="num">
                        {leg.kind === 'transition' ? (
                          <span className="muted">—</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={leg.distanceKm}
                            onChange={(e) =>
                              updateLeg(race.id, leg.id, { distanceKm: Number(e.target.value) })
                            }
                          />
                        )}
                      </td>

                      <td>
                        {leg.kind === 'transition' ? (
                          <span className="muted">timing only</span>
                        ) : (
                          <>
                            <select
                              value={leg.courseName ?? ''}
                              onChange={(e) => {
                                const courseName = e.target.value || undefined;
                                const course = courseName ? courseByName.get(courseName) : undefined;
                                updateLeg(race.id, leg.id, {
                                  courseName,
                                  courseIsManual: true,
                                  // Taking the measured length keeps the typed distance
                                  // honest the moment a route is chosen.
                                  ...(course ? { distanceKm: round(course.totalKm, 2) } : {}),
                                });
                              }}
                            >
                              <option value="">— not on the map —</option>
                              {courses.map((c) => (
                                <option key={c.name} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                            {bound && (
                              <span className="colocated">
                                {leg.courseIsManual ? 'chosen' : 'auto'} · {bound.totalKm.toFixed(2)} km
                              </span>
                            )}
                            {!routed && !leg.courseName && (
                              <span className="colocated">not staffed</span>
                            )}
                          </>
                        )}
                      </td>

                      {([0, 1, 2] as const).map((i) => (
                        <td key={i} className="num">
                          <input
                            type="number"
                            min={0}
                            step={unit.step}
                            value={round(unit.toDisplay(values[i]), 2)}
                            onChange={(e) =>
                              updateLeg(race.id, leg.id, {
                                band: withBandValue(leg.band, i, unit.toStored(Number(e.target.value))),
                              })
                            }
                          />
                        </td>
                      ))}

                      <td className="muted">{unit.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {onAddRace && (
        <button type="button" className="secondary" onClick={onAddRace}>
          + Add another race
        </button>
      )}

      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        Legs run in the order listed. A swim and a transition are timed rather than staffed — they only
        decide how late the legs after them begin — so no positions are scheduled on them even where the
        swim is drawn. Bike speeds are entered in km/h; everything else is minutes, or minutes per
        kilometre. Choosing a route takes its measured length, which is usually more accurate than the
        advertised distance.
      </p>
    </>
  );
}
