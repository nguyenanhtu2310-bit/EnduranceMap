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
import { eventSecondsFrom, formatEventClock } from '../lib/time';
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
/**
 * Height of one row of gun labels.
 *
 * The ruler is drawn 900 units wide and displayed at about three-quarters of that, so
 * every size here is smaller on screen than it reads in the source. At twelve units the
 * labels came out around seven pixels — present, and not actually readable.
 */
const RULER_ROW_H = 16;
/**
 * Room to the left of the plot for the two scales, in the same units the plot uses.
 *
 * Wide enough for the longest unit word at the size it is now drawn. The units are the
 * thing an operator hunts for on an unfamiliar chart — is that axis metres or runners? —
 * so they are set in the brand green and large enough to find, and "runners" at that size
 * needs more than the forty-two units that fitted it when it was grey and small.
 */
const GUTTER = 60;
/** Room at the top of the ruler for the marker that says which moment is being shown. */
const NOW_BAND_H = 15;

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

  /*
   * Every gun on the timeline, so the moment being looked at is read against the starts
   * rather than counted from the left edge.
   *
   * On a card whose distances go off across three days — one Friday morning, four across
   * a Saturday dawn — "Sat 06:00" means nothing until you know the 70 km left at three
   * and the 50 km at half past five. These are the reference points an organiser is
   * actually holding in their head.
   */
  const starts = useMemo(() => {
    const span = Math.max(1, window.endSeconds - window.startSeconds);
    return inputs
      .map((input) => ({
        name: input.courseName,
        seconds: eventSecondsFrom(input.startTimeClock, input.startDayOffset),
      }))
      .filter((s): s is { name: string; seconds: number } => s.seconds !== null)
      .map((s) => ({ ...s, fraction: (s.seconds - window.startSeconds) / span }))
      .sort((a, b) => a.seconds - b.seconds);
  }, [inputs, window]);
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

  // Two distances an hour apart sit a percent apart on a forty-hour timeline, so the
  // gun labels are placed the same way the station names are rather than overlapped.
  const startLayout = useMemo(
    () =>
      layoutLabels(
        starts.map((s) => ({
          x: s.fraction * COLUMNS,
          text: `${s.name} ${formatEventClock(s.seconds, raceDate)}`,
        })),
        { width: COLUMNS, maxRows: 4 }
      ),
    [starts, raceDate]
  );

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
  /**
   * How far through its own race each distance is, at this moment.
   *
   * One row per distance rather than one bar for the event. Six distances going off
   * across a morning are at six different points in their own day — the 10 km can be
   * packed up while the 100 miles has not reached its first checkpoint — and a single
   * aggregate reports "39% finished", which is true of no race on the card.
   *
   * Finishers only. Attrition needs recorded splits, and a DNF figure taken from a model
   * built out of finishers would be arithmetic about nobody.
   */
  const progress = inputs
    .map((input, i) => ({
      name: input.courseName,
      index: i,
      finished: snapshot.finishedByCourse[i] ?? 0,
      fieldSize: snapshot.fieldSizeByCourse[i] ?? 0,
    }))
    .filter((row) => row.fieldSize > 0);

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
  const rulerHeight = NOW_BAND_H + Math.max(1, startLayout.rows) * RULER_ROW_H + 10;

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
            {/* "Off route" read as lost. These runners are on their own roads and fine —
                it is the axis that cannot reach them, not the course marshals. */}
            <dt>{t('On their own roads')}</dt>
            <dd
              title={t(
                'On course and running ground the longest distance never touches, so they have no kilometre on this axis'
              )}
            >
              {offSpine}
            </dd>
          </div>
        )}
      </dl>

      <svg
        className="command-chart"
        viewBox={`${-GUTTER} 0 ${COLUMNS + GUTTER} ${baseline + AXIS_H}`}
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

        {/*
          Two scales, because the picture stacks two different things: how high the ground
          is, and how many people are standing on it. Without them the bars say "taller
          than that one" and nothing else, which is not a number anybody can staff to.
        */}
        {[maxMetres, (maxMetres + minMetres) / 2, minMetres].map((metres) => (
          <g className="scale" key={`ele-${metres}`}>
            <line x1={-4} y1={y(metres)} x2={0} y2={y(metres)} />
            <text x={-7} y={y(metres) + 3} textAnchor="end">
              {Math.round(metres).toLocaleString()}
            </text>
          </g>
        ))}
        {/* Rotated against the scale it belongs to, at the outside of the gutter. Set
            above the top tick it collided with the number there, and the collision only
            got worse once the units were made large enough to be worth reading. */}
        <text
          className="scale-unit"
          x={-GUTTER + 9}
          y={top + PLOT_H / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${-GUTTER + 9} ${top + PLOT_H / 2})`}
        >
          {t('metres')}
        </text>

        {[tallest, tallest / 2, 0].map((count) => {
          const cy = baseline - (count / tallest) * FIELD_H;
          return (
            <g className="scale" key={`field-${count}`}>
              <line x1={-4} y1={cy} x2={0} y2={cy} />
              <text x={-7} y={cy + 3} textAnchor="end">
                {Math.round(count).toLocaleString()}
              </text>
            </g>
          );
        })}
        <text
          className="scale-unit"
          x={-GUTTER + 9}
          y={fieldTop + FIELD_H / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${-GUTTER + 9} ${fieldTop + FIELD_H / 2})`}
        >
          {t('runners')}
        </text>

        <line className="profile-axis" x1={0} y1={baseline} x2={COLUMNS} y2={baseline} />
        <line className="profile-axis" x1={0} y1={fieldTop} x2={COLUMNS} y2={fieldTop} />

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

      {/*
        One row per distance, each measured against its own field rather than the event's.
        Laid out as rows instead of stacked bars because a card with six distances is six
        races, and six full-width bars would be six things to compare by eye when the
        question is only ever "how far through is this one".
      */}
      {progress.length > 0 && (
        <div className="finisher-rows">
          {/*
            The share is headed "of finishers" and not left bare, because bare it reads as
            a finish rate and is not one. The model carries no retirements, so every
            runner in it arrives eventually and every distance reaches 100% — as progress
            through the field that is exactly right, and as a finish rate it would be a
            claim the tool is in no position to make.
          */}
          <div className="finisher-row finisher-head">
            <span className="finisher-name">{t('Distance')}</span>
            <span />
            <span className="finisher-count">{t('Home so far')}</span>
            <span className="finisher-share">{t('of finishers')}</span>
          </div>
          {progress.map((row) => {
            const share = row.fieldSize > 0 ? (row.finished / row.fieldSize) * 100 : 0;
            return (
              <div className="finisher-row" key={row.name}>
                <span className="finisher-name">
                  <i style={{ background: seriesVar(courseIndex(row.name)) }} />
                  {row.name}
                </span>
                <span className="finisher-track">
                  <span className="finisher-fill" style={{ width: `${share}%` }} />
                </span>
                <span className="finisher-count">
                  {row.finished.toLocaleString()}
                  <em>/{row.fieldSize.toLocaleString()}</em>
                </span>
                <span className="finisher-share">{share.toFixed(0)}%</span>
              </div>
            );
          })}
          <p className="hint finisher-note">
            {t(
              'How much of each distance’s field is home at this moment. This is progress through the race, not a finish rate — the model carries no retirements, so everyone arrives in the end.'
            )}
          </p>
        </div>
      )}

      <svg
        className="timeline-ruler"
        viewBox={`0 0 ${COLUMNS} ${NOW_BAND_H + Math.max(1, startLayout.rows) * RULER_ROW_H + 10}`}
        role="img"
        aria-label={t('When each distance starts')}
      >
        {starts.map((start, i) => {
          const sx = start.fraction * COLUMNS;
          const placed = startLayout.placed.find((p) => p.index === i);
          const rulerH = NOW_BAND_H + Math.max(1, startLayout.rows) * RULER_ROW_H + 10;
          return (
            <g className="gun" key={`${start.name}-${start.seconds}`}>
              <title>{`${start.name} — ${formatEventClock(start.seconds, raceDate)}`}</title>
              <line
                x1={sx}
                y1={placed ? NOW_BAND_H + placed.row * RULER_ROW_H + 3 : NOW_BAND_H}
                x2={sx}
                y2={rulerH}
                stroke={seriesVar(courseIndex(start.name))}
              />
              {placed && (
                // Held a few units inside the frame. A label anchored at the very left
                // has its first glyph bearing slightly negative, so the leading digit of
                // "100 Miles" was sliced off by the edge of the drawing.
                <text
                  x={Math.min(COLUMNS - 3, Math.max(3, sx))}
                  y={NOW_BAND_H + placed.row * RULER_ROW_H + 11}
                  textAnchor={placed.anchor}
                  fill={seriesVar(courseIndex(start.name))}
                >
                  {start.name} {formatEventClock(start.seconds, raceDate)}
                </text>
              )}
            </g>
          );
        })}
        {/*
          The moment on show, on the same axis as the guns.
          It carries its own time rather than relying on the slider's thumb: a range
          input's thumb is inset from both ends of its track, so it never quite lines up
          with anything drawn edge to edge above it.
        */}
        {(() => {
          const nowX =
            ((atSeconds - window.startSeconds) /
              Math.max(1, window.endSeconds - window.startSeconds)) *
            COLUMNS;
          const label = formatEventClock(atSeconds, raceDate);
          const width = label.length * 5.6 + 10;
          const left = Math.min(COLUMNS - width, Math.max(0, nowX - width / 2));
          return (
            <g className="now">
              <line x1={nowX} y1={NOW_BAND_H - 3} x2={nowX} y2={rulerHeight} />
              <rect x={left} y={0} width={width} height={NOW_BAND_H - 4} rx={2} />
              <text x={left + width / 2} y={NOW_BAND_H - 8} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })()}
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

      {/*
        Named from the distances the bars are actually drawn from, and coloured by the
        same lookup. Reading the key off the course order instead let a distance the
        order did not contain take a colour with no entry beside it — a stripe on the
        chart that nothing on the page accounted for.
      */}
      <div className="mark-key">
        {inputs.map((input) => (
          <span key={input.courseName}>
            <i
              className="key-dot"
              style={{ background: seriesVar(courseIndex(input.courseName)) }}
            />{' '}
            {input.courseName}
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
