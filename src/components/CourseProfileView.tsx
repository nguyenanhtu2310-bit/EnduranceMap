import { useMemo } from 'react';
import type { CourseProfile } from '../lib/courseProfile';
import { resampleProfile } from '../lib/courseProfile';
import { useT } from '../lib/i18n';

interface Props {
  course: CourseProfile;
}

const COLUMNS = 460;
const PLOT_H = 150;
const AXIS_H = 18;

/**
 * One route file, as read.
 *
 * The quality line comes first and is not collapsible. Of the route files this tool was
 * first given, one was a placeholder, one carried no elevation at all and one had kept it
 * on 1.6% of its points — every one looked fine in a file listing, and each cost an hour
 * before the numbers came out wrong. What a file actually contains belongs on screen
 * before anything is planned on it.
 */
export function CourseProfileView({ course }: Props) {
  const t = useT();
  const bands = useMemo(() => resampleProfile(course.profile, COLUMNS), [course.profile]);

  const km = (value: number) => `${value.toFixed(2)} km`;
  const m = (value: number) => `${Math.round(value).toLocaleString()} m`;

  if (!course.totals || bands.length === 0) {
    return (
      <div className="course-profile">
        <div className="profile-head">
          <h4>{course.name}</h4>
          <span className="muted small">
            {km(course.totalKm)} · {course.quality.pointCount.toLocaleString()} {t('points')}
          </span>
        </div>
        <p className="hint">
          {course.quality.elevationCoverage === 0
            ? t('This file has no elevation, so it can describe the route but not the climbing.')
            : `${t('Elevation is missing from part of this file')} — ${Math.round(
                (1 - course.quality.elevationCoverage) * 100
              )}% ${t('of points have none, so no profile is drawn.')}`}
        </p>
      </div>
    );
  }

  const { minMetres, maxMetres } = course.totals;
  const span = Math.max(1, maxMetres - minMetres);
  const y = (ele: number) => PLOT_H - ((ele - minMetres) / span) * PLOT_H;
  const x = (index: number) => (index / Math.max(1, bands.length - 1)) * COLUMNS;

  // Filled from the floor up to the skyline, the way a course profile is always drawn.
  // The skyline takes the highest reading in each column rather than a sampled point, so
  // summits survive being thinned from 65,699 points to the chart's width.
  const skyline = bands.map((b, i) => `${x(i).toFixed(1)},${y(b.high).toFixed(1)}`).join(' ');
  const ground = `0,${PLOT_H} ${skyline} ${COLUMNS},${PLOT_H}`;

  const xOfKm = (value: number) => (value / Math.max(0.001, course.totalKm)) * COLUMNS;

  const climbs = [...course.climbs]
    .filter((c) => c.changeMetres > 0)
    .sort((a, b) => b.changeMetres - a.changeMetres)
    .slice(0, 5);

  return (
    <div className="course-profile">
      <div className="profile-head">
        <h4>{course.name}</h4>
        <span className="muted small">
          {km(course.totalKm)} · {course.quality.pointCount.toLocaleString()} {t('points')}
        </span>
      </div>

      <dl className="profile-facts">
        <div>
          <dt>{t('Climb')}</dt>
          <dd>{m(course.totals.gainMetres)}</dd>
        </div>
        <div>
          <dt>{t('Descent')}</dt>
          <dd>{m(course.totals.lossMetres)}</dd>
        </div>
        <div>
          <dt>{t('Range')}</dt>
          <dd>
            {m(minMetres)} – {m(maxMetres)}
          </dd>
        </div>
        <div>
          <dt>{t('Flat-equivalent')}</dt>
          <dd>{course.flatEquivalentKm ? km(course.flatEquivalentKm) : '—'}</dd>
        </div>
      </dl>

      <svg
        className="profile-chart"
        viewBox={`0 0 ${COLUMNS} ${PLOT_H + AXIS_H}`}
        role="img"
        aria-label={`${course.name} ${t('elevation profile')}`}
      >
        {/*
          The climbs that decide the race, shaded on the ground they occupy. A profile
          shows that a course goes up; it does not say which of the ups is the one a crew
          and a medical team have to plan around.
        */}
        {climbs.map((climb) => {
          const x1 = xOfKm(climb.startKm);
          const x2 = xOfKm(climb.endKm);
          const wide = x2 - x1 > 46;
          return (
            <g className="climb-band" key={`${climb.startKm}-${climb.endKm}`}>
              <title>
                {`${t('km')} ${climb.startKm.toFixed(1)}–${climb.endKm.toFixed(1)} · ` +
                  `+${Math.round(climb.changeMetres)} m · ${climb.gradientPercent.toFixed(1)}%`}
              </title>
              <rect x={x1} y={0} width={Math.max(1, x2 - x1)} height={PLOT_H} />
              {wide && (
                <text x={(x1 + x2) / 2} y={PLOT_H - 5} textAnchor="middle">
                  +{Math.round(climb.changeMetres)} m
                </text>
              )}
            </g>
          );
        })}

        <polygon className="profile-fill" points={ground} />
        <polyline className="profile-line" points={skyline} fill="none" />
        <line className="profile-axis" x1={0} y1={PLOT_H} x2={COLUMNS} y2={PLOT_H} />
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={fraction}
            className="profile-tick"
            x={Math.min(COLUMNS - 2, Math.max(2, fraction * COLUMNS))}
            y={PLOT_H + AXIS_H - 4}
            textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
          >
            {/* A short course rounded to whole km ends its axis past its own finish —
                10.77 km labelled "11". One decimal under 20 km keeps the last tick true. */}
            {(course.totalKm * fraction).toFixed(course.totalKm < 20 ? 1 : 0)}
          </text>
        ))}
      </svg>

      <p className="profile-source small muted">
        {course.character?.character === 'raw'
          ? `${t('Recorded track — smoothed at')} ${course.totals.thresholdMetres} m ${t(
              'before totalling'
            )} (${t('reverses direction')} ${(course.character.flipRate * 100).toFixed(1)}% ${t(
              'of the time'
            )})`
          : `${t('Already filtered by whatever wrote the file — totalled as it stands')} (${t(
              'reverses direction'
            )} ${((course.character?.flipRate ?? 0) * 100).toFixed(1)}% ${t('of the time')})`}
      </p>

      {climbs.length > 0 && (
        <table className="climb-table">
          <thead>
            <tr>
              <th>{t('Biggest climbs')}</th>
              <th>{t('Length')}</th>
              <th>{t('Climb')}</th>
              <th>{t('Gradient')}</th>
            </tr>
          </thead>
          <tbody>
            {climbs.map((climb) => (
              <tr key={climb.startKm}>
                <td>
                  {t('km')} {climb.startKm.toFixed(1)} – {climb.endKm.toFixed(1)}
                </td>
                <td>{(climb.endKm - climb.startKm).toFixed(2)} km</td>
                <td>+{m(climb.changeMetres)}</td>
                <td>{climb.gradientPercent.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
