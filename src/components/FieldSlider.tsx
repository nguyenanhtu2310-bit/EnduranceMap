import { useMemo, useState } from 'react';
import type { PipelineResult } from '../lib/pipeline';
import type { CourseProfile } from '../lib/courseProfile';
import { layoutLabels, resampleProfile, stationMarks } from '../lib/courseProfile';
import { lengthOf, mapToSpine, type SpineMapping } from '../lib/spine';
import {
  fieldSnapshot,
  fieldWindow,
  runnerPaces,
  type FieldInput,
  type RunnerPace,
} from '../lib/fieldPosition';
import { formatEventClock } from '../lib/time';
import { seriesVar } from '../lib/series';
import { useT } from '../lib/i18n';

interface Props {
  result: PipelineResult;
  profiles: Map<string, CourseProfile>;
  raceDate?: string;
}

const COLUMNS = 900;
const PLOT_H = 170;
const FIELD_H = 120;
const AXIS_H = 20;
const LABEL_ROW_H = 13;
const LABEL_PAD = 8;
const BIN_KM = 1;

/** Fifteen minutes: fine enough that nobody crosses a whole leg between two knots. */
const STEP_SECONDS = 15 * 60;

/**
 * Where every runner on every distance is, at a moment the operator chooses.
 *
 * The question a race director and a medical director actually ask on the day is "where
 * is everybody right now", and until now the tool could only answer it one station at a
 * time. Here the whole field sits on the course it is running, under the climbs it is
 * running them on, with the stations that serve it drawn in.
 *
 * Every distance is placed on the longest course's kilometres, because a station at the
 * 100 km's 26.2 and the 100 miles' 85.6 is one place and belongs in one column. Ground
 * the longest course never touches is counted separately rather than given a plausible
 * position it does not have.
 *
 * The knots are fifteen minutes apart for a reason that is not taste. Between two mats a
 * runner's position is interpolated — the count on a leg is exact, since a chip read at
 * one end and not the other places them unambiguously between the two, but where on the
 * leg is a straight line through ground that is not straight. Legs on a real course run
 * from 2.7 km to 14.1 km, and a runner covers under 1.5 km in a quarter of an hour, so no
 * leg is ever skipped between one knot and the next. An hourly knot would let a cluster
 * cross most of a leg unseen.
 */
export function FieldSlider({ result, profiles, raceDate }: Props) {
  const t = useT();

  // The longest course carries the profile everything else is read against. Measured on a
  // real season, the short courses lie on the long one and never the other way round.
  const spineCourse = useMemo(
    () =>
      [...result.courses]
        .filter((c) => profiles.get(c.name)?.profile.length)
        .sort((a, b) => b.totalKm - a.totalKm)[0],
    [result.courses, profiles]
  );

  const mappings = useMemo(() => {
    const out = new Map<string, SpineMapping>();
    if (!spineCourse) return out;
    for (const course of result.courses) {
      out.set(
        course.name,
        course.name === spineCourse.name
          ? {
              courseName: course.name,
              coverage: 1,
              samples: course.vertices.map((v) => ({ cumulativeKm: v.cumulativeKm })).map((v) => ({
                courseKm: v.cumulativeKm,
                spineKm: v.cumulativeKm,
              })),
            }
          : mapToSpine(course.vertices, spineCourse.vertices, course.name)
      );
    }
    return out;
  }, [result.courses, spineCourse]);

  const inputs = useMemo<FieldInput[]>(
    () =>
      result.distanceInputs.map((input) => ({
        ...input,
        courseKm: result.courses.find((c) => c.name === input.courseName)?.totalKm ?? 0,
      })),
    [result.distanceInputs, result.courses]
  );

  const paces = useMemo(() => {
    const out = new Map<string, RunnerPace[]>();
    for (const input of inputs) out.set(input.courseName, runnerPaces(input));
    return out;
  }, [inputs]);

  const window = useMemo(() => fieldWindow(inputs, paces), [inputs, paces]);
  const knots = Math.max(
    1,
    Math.ceil((window.endSeconds - window.startSeconds) / STEP_SECONDS)
  );
  const [knot, setKnot] = useState(0);
  const atSeconds = window.startSeconds + Math.min(knot, knots) * STEP_SECONDS;

  const spineKm = spineCourse ? lengthOf(spineCourse.vertices) : 0;
  const snapshot = useMemo(
    () => fieldSnapshot(atSeconds, inputs, mappings, paces, { spineKm, binKm: BIN_KM }),
    [atSeconds, inputs, mappings, paces, spineKm]
  );

  const profile = spineCourse ? profiles.get(spineCourse.name) : undefined;
  const bands = useMemo(() => resampleProfile(profile?.profile ?? [], COLUMNS), [profile]);
  const marks = useMemo(
    () => (spineCourse ? stationMarks(result.stations, spineCourse.name) : []),
    [result.stations, spineCourse]
  );

  const layout = useMemo(
    () =>
      layoutLabels(
        marks.map((m) => ({
          x: (m.kmFromStart / Math.max(0.001, spineKm)) * COLUMNS,
          text: m.name,
        })),
        { width: COLUMNS, maxRows: 4 }
      ),
    [marks, spineKm]
  );
  const rowOf = useMemo(() => {
    const byIndex = new Map<number, { row: number; anchor: 'start' | 'middle' | 'end' }>();
    for (const p of layout.placed) byIndex.set(p.index, { row: p.row, anchor: p.anchor });
    return byIndex;
  }, [layout]);

  if (!spineCourse || !profile?.totals || bands.length === 0) {
    return (
      <p className="hint">
        {t('Drop the route GPX for the longest distance to see the field on its course.')}
      </p>
    );
  }

  const labelH = Math.max(1, layout.rows) * LABEL_ROW_H + LABEL_PAD;
  const top = labelH;
  const fieldTop = top + PLOT_H;
  const baseline = fieldTop + FIELD_H;

  const { minMetres, maxMetres } = profile.totals;
  const span = Math.max(1, maxMetres - minMetres);
  const y = (ele: number) => top + PLOT_H - ((ele - minMetres) / span) * PLOT_H;
  const x = (index: number) => (index / Math.max(1, bands.length - 1)) * COLUMNS;
  const xOfKm = (km: number) => (km / Math.max(0.001, spineKm)) * COLUMNS;

  const skyline = bands.map((b, i) => `${x(i).toFixed(1)},${y(b.high).toFixed(1)}`).join(' ');
  const ground = `0,${top + PLOT_H} ${skyline} ${COLUMNS},${top + PLOT_H}`;

  const binCount = snapshot.binsByCourse[0]?.length ?? 0;
  const binWidth = COLUMNS / Math.max(1, binCount);
  const tallest = Math.max(
    1,
    ...Array.from({ length: binCount }, (_, i) =>
      snapshot.binsByCourse.reduce((sum, bins) => sum + bins[i], 0)
    )
  );

  const courseIndex = (name: string) => Math.max(0, result.courseOrder.indexOf(name));
  const busiest = Array.from({ length: binCount }, (_, i) =>
    snapshot.binsByCourse.reduce((sum, bins) => sum + bins[i], 0)
  );
  const busiestBin = busiest.indexOf(Math.max(...busiest));
  const offSpine = snapshot.offSpineByCourse.reduce((a, b) => a + b, 0);

  return (
    <>
      <dl className="profile-facts">
        <div>
          <dt>{t('At')}</dt>
          <dd>{formatEventClock(atSeconds, raceDate)}</dd>
        </div>
        <div>
          <dt>{t('Runners on course')}</dt>
          <dd>{snapshot.totalOnCourse.toLocaleString()}</dd>
        </div>
        {snapshot.totalOnCourse > 0 && (
          <div>
            <dt>{t('Busiest kilometre')}</dt>
            <dd>
              {t('km')} {(busiestBin * BIN_KM).toFixed(0)}–{((busiestBin + 1) * BIN_KM).toFixed(0)} ·{' '}
              {busiest[busiestBin]}
            </dd>
          </div>
        )}
        {offSpine > 0 && (
          <div>
            <dt>{t('Off this course')}</dt>
            <dd title={t('Running ground the longest course never touches')}>{offSpine}</dd>
          </div>
        )}
      </dl>

      <svg
        className="command-chart"
        viewBox={`0 0 ${COLUMNS} ${baseline + AXIS_H}`}
        role="img"
        aria-label={t('The field on the course at the chosen moment')}
      >
        <polygon className="profile-fill" points={ground} />
        <polyline className="profile-line" points={skyline} fill="none" />

        {marks.map((mark, i) => {
          const mx = xOfKm(mark.kmFromStart);
          const label = rowOf.get(i);
          return (
            <g
              key={`${mark.name}-${mark.passIndex}-${mark.kmFromStart}`}
              className={mark.isTimed ? 'mark timed' : 'mark untimed'}
            >
              <title>{`${mark.name} — ${t('km')} ${mark.kmFromStart.toFixed(1)}`}</title>
              <line x1={mx} y1={top} x2={mx} y2={baseline} className="mark-stem" />
              {label && (
                <text x={mx} y={10 + label.row * LABEL_ROW_H} className="mark-label" textAnchor={label.anchor}>
                  {mark.name}
                </text>
              )}
            </g>
          );
        })}

        {/* The field, stacked by distance so it is clear which race is where. */}
        {Array.from({ length: binCount }, (_, bin) => {
          let stacked = 0;
          return snapshot.binsByCourse.map((bins, course) => {
            const count = bins[bin];
            if (count === 0) return null;
            const height = (count / tallest) * FIELD_H;
            const yTop = baseline - (stacked / tallest) * FIELD_H - height;
            stacked += count;
            return (
              <rect
                key={`${bin}-${course}`}
                x={bin * binWidth}
                y={yTop}
                width={Math.max(0.6, binWidth - 0.4)}
                height={height}
                fill={seriesVar(courseIndex(inputs[course]?.courseName ?? ''))}
              >
                <title>
                  {`${inputs[course]?.courseName} — ${count} ${t('runners')}, ${t('km')} ` +
                    `${(bin * BIN_KM).toFixed(0)}–${((bin + 1) * BIN_KM).toFixed(0)}`}
                </title>
              </rect>
            );
          });
        })}

        <line className="profile-axis" x1={0} y1={baseline} x2={COLUMNS} y2={baseline} />
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={fraction}
            className="profile-tick"
            x={Math.min(COLUMNS - 2, Math.max(2, fraction * COLUMNS))}
            y={baseline + AXIS_H - 5}
            textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
          >
            {(spineKm * fraction).toFixed(0)} km
          </text>
        ))}
      </svg>

      <div className="slider-row">
        <button
          type="button"
          className="secondary"
          onClick={() => setKnot((k) => Math.max(0, k - 4))}
          title={t('Back an hour')}
        >
          ‹‹
        </button>
        <input
          type="range"
          min={0}
          max={knots}
          step={1}
          value={Math.min(knot, knots)}
          onChange={(e) => setKnot(Number(e.target.value))}
          aria-label={t('Moment of the race')}
        />
        <button
          type="button"
          className="secondary"
          onClick={() => setKnot((k) => Math.min(knots, k + 4))}
          title={t('On an hour')}
        >
          ››
        </button>
      </div>

      <div className="mark-key">
        {result.courseOrder.map((name, i) => (
          <span key={name}>
            <i className="key-dot" style={{ background: seriesVar(i) }} /> {name}
          </span>
        ))}
      </div>

      <p className="hint" style={{ margin: '0.6rem 0 0' }}>
        {t(
          'Every distance placed on the longest course. Counts between two timing mats are exact — a chip read at one and not the other puts a runner between them — but where on that stretch they are is interpolated.'
        )}
      </p>
    </>
  );
}
