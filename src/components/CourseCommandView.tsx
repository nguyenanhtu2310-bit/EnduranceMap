import { useMemo, useState } from 'react';
import type { PipelineResult } from '../lib/pipeline';
import type { CourseProfile } from '../lib/courseProfile';
import { layoutLabels, resampleProfile, stationMarks } from '../lib/courseProfile';
import { useT } from '../lib/i18n';

interface Props {
  result: PipelineResult;
  /** Elevation profiles by course name, from the route files. */
  profiles: Map<string, CourseProfile>;
}

const COLUMNS = 900;
const PLOT_H = 210;
const AXIS_H = 20;
/** Height of one row of labels, and the gap between the lowest row and the profile. */
const LABEL_ROW_H = 13;
const LABEL_PAD = 10;

/**
 * The course, its climbs and every station on it, on one picture.
 *
 * A trail race is decided by where the hard ground is and who is standing near it, and
 * until now those two facts lived in different sections. A profile with the stations
 * drawn on it answers the question a race director actually asks — "what is between CP4
 * and CP5, and how bad is it" — without anyone cross-referencing a table against a chart.
 *
 * Timed stations are drawn solid and labelled; untimed ones are faint and hollow. The
 * distinction is not decoration: a chip is read at one and not the other, so only the
 * solid ones can ever confirm that a runner passed.
 */
export function CourseCommandView({ result, profiles }: Props) {
  const t = useT();
  const withProfile = result.courses.filter((c) => profiles.get(c.name)?.profile.length);
  const [selected, setSelected] = useState(withProfile[0]?.name ?? '');

  const course = withProfile.find((c) => c.name === selected) ?? withProfile[0];
  const profile = course ? profiles.get(course.name) : undefined;

  const marks = useMemo(
    () => (course ? stationMarks(result.stations, course.name) : []),
    [result.stations, course]
  );
  const bands = useMemo(() => resampleProfile(profile?.profile ?? [], COLUMNS), [profile]);

  /*
   * Every station is labelled, timed or not — a hollow dot with no name tells a medical
   * director where something is but not what, which is the half that matters. Both kinds
   * go through the same placement so a water station never lands on a checkpoint.
   */
  const totalKm = profile?.totalKm ?? 0;
  const layout = useMemo(
    () =>
      layoutLabels(
        marks.map((m) => ({
          x: (m.kmFromStart / Math.max(0.001, totalKm)) * COLUMNS,
          text: m.name + (m.passCount > 1 ? ` (${m.passIndex + 1})` : ''),
        })),
        { width: COLUMNS }
      ),
    [marks, totalKm]
  );
  const rowOf = useMemo(() => {
    const byIndex = new Map<number, { row: number; anchor: 'start' | 'middle' | 'end' }>();
    for (const p of layout.placed) byIndex.set(p.index, { row: p.row, anchor: p.anchor });
    return byIndex;
  }, [layout]);
  const labelH = Math.max(1, layout.rows) * LABEL_ROW_H + LABEL_PAD;

  if (!course || !profile?.totals || bands.length === 0) {
    return (
      <p className="hint">
        {t(
          'Drop the route GPX for a distance to see its profile here, with every station drawn on it.'
        )}
      </p>
    );
  }

  const { minMetres, maxMetres } = profile.totals;
  const span = Math.max(1, maxMetres - minMetres);
  const y = (ele: number) => labelH + PLOT_H - ((ele - minMetres) / span) * PLOT_H;
  const xOfKm = (km: number) => (km / Math.max(0.001, profile.totalKm)) * COLUMNS;
  const x = (index: number) => (index / Math.max(1, bands.length - 1)) * COLUMNS;

  const skyline = bands.map((b, i) => `${x(i).toFixed(1)},${y(b.high).toFixed(1)}`).join(' ');
  const ground = `0,${labelH + PLOT_H} ${skyline} ${COLUMNS},${labelH + PLOT_H}`;

  /** Ground level under a station, so its stem starts at the hill rather than in the air. */
  const surfaceAt = (km: number) => {
    const index = Math.min(bands.length - 1, Math.max(0, Math.round((km / profile.totalKm) * (bands.length - 1))));
    return y(bands[index].high);
  };

  const timed = marks.filter((m) => m.isTimed);

  return (
    <>
      {withProfile.length > 1 && (
        <div className="sort-bar">
          <span className="sort-label">{t('Course')}</span>
          {withProfile.map((c) => (
            <button
              key={c.name}
              type="button"
              className={c.name === course.name ? 'sort-chip on' : 'sort-chip'}
              onClick={() => setSelected(c.name)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <dl className="profile-facts">
        <div>
          <dt>{t('Distance')}</dt>
          <dd>{profile.totalKm.toFixed(2)} km</dd>
        </div>
        <div>
          <dt>{t('Climb')}</dt>
          <dd>{Math.round(profile.totals.gainMetres).toLocaleString()} m</dd>
        </div>
        <div>
          <dt>{t('Stations on course')}</dt>
          <dd>
            {marks.length} ({timed.length} {t('timed')})
          </dd>
        </div>
      </dl>

      <svg
        className="command-chart"
        viewBox={`0 0 ${COLUMNS} ${labelH + PLOT_H + AXIS_H}`}
        role="img"
        aria-label={`${course.name} ${t('elevation profile with stations')}`}
      >
        <polygon className="profile-fill" points={ground} />
        <polyline className="profile-line" points={skyline} fill="none" />

        {marks.map((mark, i) => {
          const mx = xOfKm(mark.kmFromStart);
          const top = surfaceAt(mark.kmFromStart);
          const label = rowOf.get(i);
          const labelY = label ? 10 + label.row * LABEL_ROW_H : 0;
          return (
            <g
              key={`${mark.name}-${mark.passIndex}-${mark.kmFromStart}`}
              className={mark.isTimed ? 'mark timed' : 'mark untimed'}
            >
              <title>
                {`${mark.name} — ${t('km')} ${mark.kmFromStart.toFixed(1)}` +
                  (mark.passCount > 1 ? ` (${mark.passIndex + 1}/${mark.passCount})` : '') +
                  (mark.isTimed ? '' : ` — ${t('no timing mat')}`)}
              </title>
              <line x1={mx} y1={top} x2={mx} y2={labelH + PLOT_H} className="mark-stem" />
              {label && (
                <>
                  <line x1={mx} y1={labelY + 3} x2={mx} y2={top} className="mark-lead" />
                  <text x={mx} y={labelY} className="mark-label" textAnchor={label.anchor}>
                    {mark.name}
                    {mark.passCount > 1 ? ` (${mark.passIndex + 1})` : ''}
                  </text>
                </>
              )}
              {mark.isTimed ? (
                <circle cx={mx} cy={top} r={4} className="mark-dot" />
              ) : (
                <circle cx={mx} cy={top} r={3.5} className="mark-dot-hollow" />
              )}
            </g>
          );
        })}

        <line className="profile-axis" x1={0} y1={labelH + PLOT_H} x2={COLUMNS} y2={labelH + PLOT_H} />
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={fraction}
            className="profile-tick"
            x={Math.min(COLUMNS - 2, Math.max(2, fraction * COLUMNS))}
            y={labelH + PLOT_H + AXIS_H - 5}
            textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
          >
            {(profile.totalKm * fraction).toFixed(profile.totalKm < 20 ? 1 : 0)} km
          </text>
        ))}
      </svg>

      <div className="mark-key">
        <span>
          <i className="key-dot timed" /> {t('Timed — a chip is read here')}
        </span>
        <span>
          <i className="key-dot untimed" /> {t('No mat — staffed, but nobody is counted')}
        </span>
      </div>
    </>
  );
}
