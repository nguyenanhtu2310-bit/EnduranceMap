import { summarizeMultisportProfile, type MultisportProfile } from '../lib/multisportResults';
import type { MultisportRace } from '../lib/multisport';

interface Props {
  fileName: string;
  profiles: MultisportProfile[];
  races: MultisportRace[];
  /** Profile key to the id of the race it drives. */
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  onClear: () => void;
}

function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Each leg in the unit its sport is actually planned in. One pace figure across a swim,
 * a ride and a run would be meaningless, so there is no single number to show.
 */
function legRate(kind: string, seconds: number, distanceKm: number): string {
  if (distanceKm <= 0 || seconds <= 0) return '—';
  if (kind === 'swim') return `${(seconds / 60 / (distanceKm * 10)).toFixed(2)} min/100m`;
  if (kind === 'bike') return `${(distanceKm / (seconds / 3600)).toFixed(1)} km/h`;
  if (kind === 'run') return `${(seconds / 60 / distanceKm).toFixed(2)} min/km`;
  return '—';
}

export function MultisportResultsPanel({
  fileName,
  profiles,
  races,
  mapping,
  onMappingChange,
  onClear,
}: Props) {
  return (
    <>
      <div className="file-line">
        <span className="muted">Loaded</span>
        <strong>{fileName}</strong>
        <span className="muted">
          {profiles.length} race{profiles.length === 1 ? '' : 's'} in this file
        </span>
        <button className="secondary" onClick={onClear}>
          Remove
        </button>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Race in file</th>
              <th className="num">Starters</th>
              <th className="num">Usable</th>
              <th>Legs</th>
              <th className="num">Rolling start</th>
              <th>Use for</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const summary = summarizeMultisportProfile(profile);
              const offsets = profile.athletes.map((a) => a.raceOffsetSeconds).sort((a, b) => a - b);
              const spread = offsets[Math.floor(offsets.length * 0.99)] ?? 0;

              return (
                <tr key={profile.key}>
                  <td>
                    <span className="station-name">{profile.label}</span>
                    {profile.warnings.map((w) => (
                      <span key={w} className="colocated">
                        {w}
                      </span>
                    ))}
                  </td>
                  <td className="num">{profile.rows.toLocaleString()}</td>
                  <td className="num">
                    {profile.usable.toLocaleString()}
                    <span className="colocated">
                      {Math.round((profile.usable / Math.max(1, profile.rows)) * 100)}%
                    </span>
                  </td>
                  <td>
                    <details>
                      <summary className="muted">
                        {profile.legs
                          .filter((l) => l.kind !== 'transition')
                          .map((l) => `${l.label} ${l.distanceKm} km`)
                          .join(' · ')}
                      </summary>
                      <table className="inner">
                        <thead>
                          <tr>
                            <th>Leg</th>
                            <th className="num">P1</th>
                            <th className="num">P50</th>
                            <th className="num">P99</th>
                            <th className="num">Typical rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.map((s) => (
                            <tr key={s.leg.label}>
                              <td>{s.leg.label}</td>
                              <td className="num">{hm(s.p1Seconds)}</td>
                              <td className="num">{hm(s.p50Seconds)}</td>
                              <td className="num">{hm(s.p99Seconds)}</td>
                              <td className="num">
                                {legRate(s.leg.kind, s.p50Seconds, s.leg.distanceKm)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Where the ladder drops is where the race lost people. */}
                      <p className="hint" style={{ margin: '0.6rem 0 0' }}>
                        {profile.attrition.map((a) => `${a.label} ${a.reached}`).join(' → ')}
                      </p>
                    </details>
                  </td>
                  <td className="num">+{Math.round(spread / 60)} min at P99</td>
                  <td>
                    <select
                      value={mapping[profile.key] ?? ''}
                      onChange={(e) => onMappingChange({ ...mapping, [profile.key]: e.target.value })}
                    >
                      <option value="">Not used</option>
                      {races.map((race) => (
                        <option key={race.id} value={race.id}>
                          {race.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        A multisport export has no contest column, so the races in it are told apart by how deep their
        splits run and their distances read from how fast the middle of the field rode and ran. Check those
        distances against the race you know — everything downstream is scaled from them. Each race here
        drives one race in your plan; which route each leg follows is already set in the race details.
      </p>
    </>
  );
}
