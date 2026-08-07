import { describe, expect, it } from 'vitest';
import { buildCourse } from '../geo';
import { runPipeline, type DistanceInput } from '../pipeline';
import { fieldWindow, runnerPaces, type FieldInput } from '../fieldPosition';
import { eventSecondsFrom, formatEventClock } from '../time';

/**
 * The real VMM 2026 card: six distances going off across three days, and the cut-offs
 * the race director actually published.
 *
 * Kept because it is the shape that breaks things. Every distance but one starts on the
 * Saturday, the longest starts the morning before, and the cut-offs for the two ultras
 * land on the Sunday — so a tool that holds a clock time without the day it belongs to
 * models the 100 miles and the 100 km on top of each other and reports it confidently.
 * That is exactly what happened once, and nothing caught it, because the tests called
 * the pipeline directly and the day was being lost on the way in from the form.
 *
 * The courses are synthetic. It is the timings that carry the risk here, and a real
 * runner's route is not this tool's to publish.
 */

/** The race is 18–20 September 2026, and 2026-09-18 is a Friday. Day 2 is the Sunday. */
const RACE_DATE = '2026-09-18';

/** A course of roughly the right length, running north from one shared start. */
const course = (km: number) =>
  buildCourse(
    Array.from({ length: 201 }, (_, i) => ({
      lat: 22.0 + (km / 111.32) * (i / 200),
      lon: 103.84,
    }))
  );

const KML = (courses: [string, number][]) => `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>RACE ROUTE</name>${courses
  .map(
    ([name, km]) =>
      `<Placemark><name>${name}</name><LineString><coordinates>${course(km)
        .map((v) => `${v.lon},${v.lat},0`)
        .join(' ')}</coordinates></LineString></Placemark>`
  )
  .join('')}</Folder>
<Folder><name>CP</name>
<Placemark><name>CP mid</name><Point><coordinates>103.84,22.15,0</coordinates></Point></Placemark>
<Placemark><name>CP far</name><Point><coordinates>103.84,22.45,0</coordinates></Point></Placemark>
</Folder></Document></kml>`;

interface CardEntry {
  name: string;
  /** Measured length, not the advertised one — a trail race rounds its name down. */
  km: number;
  gainMetres: number;
  startClock: string;
  startDay: number;
  /**
   * Every wave's gun, first to last. One entry is a single mass start.
   *
   * A wave start is not a detail of the ceremony. Three waves fifteen minutes apart put
   * the field on the course over half an hour, and the first checkpoint meets it that way
   * — modelling one gun stacks all of them into one instant and reports a queue that
   * never forms, then misses the one that does.
   */
  waves: string[];
  /** Minutes for the last wave to cross the line once its gun goes. */
  waveClearMinutes: number;
  cutoffClock: string;
  cutoffDay: number;
  /** Elapsed hours the published cut-off allows. */
  limitHours: number;
  /** Every intermediate cut-off the card carries, as published. */
  checkpoints: { name: string; clock: string; day: number }[];
}

/** Day names as the card writes them, so a mistranscription reads as one. */
const FRI = 0;
const SAT = 1;
const SUN = 2;

const CARD: CardEntry[] = [
  {
    name: '100 Miles', km: 161, gainMetres: 8800, startClock: '08:00', startDay: FRI,
    waves: ['08:00'], waveClearMinutes: 5,
    cutoffClock: '09:00', cutoffDay: SUN, limitHours: 49,
    checkpoints: [
      { name: 'CP Sa Pa', clock: '13:30', day: FRI },
      { name: 'CP M4', clock: '20:00', day: FRI },
      { name: 'CP M7', clock: '04:00', day: SAT },
      { name: 'CP Topas Ecolodge', clock: '10:00', day: SAT },
      { name: 'CP2', clock: '17:00', day: SAT },
      { name: 'CP3', clock: '20:00', day: SAT },
      { name: 'CP4', clock: '23:00', day: SAT },
      { name: 'CP5', clock: '01:30', day: SUN },
      { name: 'CP6', clock: '04:30', day: SUN },
      { name: 'CP7', clock: '06:15', day: SUN },
    ],
  },
  {
    name: '100km', km: 101, gainMetres: 5500, startClock: '05:00', startDay: SAT,
    waves: ['05:00'], waveClearMinutes: 5,
    cutoffClock: '09:00', cutoffDay: SUN, limitHours: 28,
    checkpoints: [
      { name: 'CP Topas Ecolodge', clock: '10:45', day: SAT },
      { name: 'CP2', clock: '17:00', day: SAT },
      { name: 'CP3', clock: '20:00', day: SAT },
      { name: 'CP4', clock: '23:00', day: SAT },
      { name: 'CP5', clock: '01:30', day: SUN },
      { name: 'CP6', clock: '04:30', day: SUN },
      { name: 'CP7', clock: '06:15', day: SUN },
    ],
  },
  {
    name: '70km', km: 69.8, gainMetres: 3900, startClock: '03:00', startDay: SAT,
    waves: ['03:00'], waveClearMinutes: 5,
    cutoffClock: '00:00', cutoffDay: SUN, limitHours: 21,
    checkpoints: [
      { name: 'CP2', clock: '08:30', day: SAT },
      { name: 'CP3', clock: '11:00', day: SAT },
      { name: 'CP4', clock: '14:00', day: SAT },
      { name: 'CP5', clock: '16:30', day: SAT },
      { name: 'CP6', clock: '19:30', day: SAT },
      { name: 'CP7', clock: '21:15', day: SAT },
    ],
  },
  {
    name: '50km', km: 49.6, gainMetres: 2700, startClock: '05:30', startDay: SAT,
    waves: ['05:30', '06:00'], waveClearMinutes: 5,
    cutoffClock: '00:00', cutoffDay: SUN, limitHours: 18.5,
    checkpoints: [
      { name: 'CP4', clock: '14:00', day: SAT },
      { name: 'CP5', clock: '16:30', day: SAT },
      { name: 'CP6', clock: '19:30', day: SAT },
      { name: 'CP7', clock: '21:15', day: SAT },
    ],
  },
  {
    name: '21km', km: 23, gainMetres: 1100, startClock: '08:00', startDay: SAT,
    waves: ['08:00', '08:15', '08:30'], waveClearMinutes: 10,
    cutoffClock: '21:00', cutoffDay: SAT, limitHours: 13,
    checkpoints: [{ name: 'CP M3', clock: '15:30', day: SAT }],
  },
  {
    name: '10km', km: 10.4, gainMetres: 500, startClock: '09:00', startDay: SAT,
    waves: ['09:00'], waveClearMinutes: 5,
    cutoffClock: '15:30', cutoffDay: SAT, limitHours: 6.5,
    checkpoints: [{ name: 'CP M4', clock: '13:30', day: SAT }],
  },
];

/**
 * How long the field is going through the arch, waves and all.
 *
 * The tool carries one spread figure per distance rather than a list of waves, so the
 * wave structure has to be flattened into it: last gun minus first, plus the time the
 * last wave takes to clear. That is an approximation — it smears three pulses into one
 * even stream — but it is the right total, and the total is what decides how long the
 * first checkpoint is busy.
 */
const startSpreadOf = (entry: CardEntry): number => {
  const minutes = (clock: string) => {
    const [h, m] = clock.split(':').map(Number);
    return h * 60 + m;
  };
  const guns = entry.waves.map(minutes);
  return Math.max(...guns) - Math.min(...guns) + entry.waveClearMinutes;
};

const inputs: DistanceInput[] = CARD.map((entry) => ({
  courseName: entry.name,
  startTimeClock: entry.startClock,
  startDayOffset: entry.startDay,
  startSpreadMinutes: startSpreadOf(entry),
  runnerCount: 200,
  fastestMinPerKm: 5,
  typicalMinPerKm: (entry.limitHours * 60) / entry.km / 1.6,
  slowestMinPerKm: (entry.limitHours * 60) / entry.km,
  organizerCutoffClock: entry.cutoffClock,
  cutoffDayOffset: entry.cutoffDay,
}));

describe('the VMM 2026 card', () => {
  it('every published cut-off is the elapsed limit the race advertises', () => {
    // The card and the tool have to agree about what "Sunday 09:00" means from a Friday
    // 08:00 gun: 49 hours, not one.
    for (const entry of CARD) {
      const start = eventSecondsFrom(entry.startClock, entry.startDay)!;
      const cutoff = eventSecondsFrom(entry.cutoffClock, entry.cutoffDay)!;
      expect((cutoff - start) / 3600).toBeCloseTo(entry.limitHours, 6);
    }
  });

  it('names each gun by its own day', () => {
    const named = CARD.map(
      (e) => `${e.name} ${formatEventClock(eventSecondsFrom(e.startClock, e.startDay)!, RACE_DATE)}`
    );
    expect(named).toEqual([
      '100 Miles Fri 08:00',
      '100km Sat 05:00',
      '70km Sat 03:00',
      '50km Sat 05:30',
      '21km Sat 08:00',
      '10km Sat 09:00',
    ]);
  });

  it('puts the Saturday guns a day after the Friday one, not an hour', () => {
    const miles = eventSecondsFrom('08:00', 0)!;
    const half = eventSecondsFrom('08:00', 1)!;
    expect(half - miles).toBe(86400);
  });

  it('runs the whole card through the pipeline on one timeline', () => {
    const out = runPipeline(KML(CARD.map((e) => [e.name, e.km])), inputs, { stationFolders: ['CP'] });
    expect(out.stations.length).toBeGreaterThan(0);

    for (const station of out.stations) {
      console.log(
        `${station.schedule.name.padEnd(8)} ` +
          `${formatEventClock(station.schedule.openSeconds, RACE_DATE)} – ` +
          `${formatEventClock(station.schedule.closeSeconds, RACE_DATE)}`
      );
      // The 100 miles is out on the Friday, so every shared station opens that day.
      expect(station.schedule.openSeconds).toBeLessThan(86400);
      // And the ultras run to the Sunday, so nothing closes before the Saturday.
      expect(station.schedule.closeSeconds).toBeGreaterThan(86400);
    }
  });

  it('does not report a finisher as overdue against a cut-off two days out', () => {
    // The bug this guards: a 49-hour race closing at "09:00" was compared against nine
    // in the morning on day one, and every finisher looked late.
    const out = runPipeline(KML(CARD.map((e) => [e.name, e.km])), inputs, { stationFolders: ['CP'] });
    const overdue = out.stations.filter((s) => s.schedule.cutoffExceeded);
    expect(overdue).toHaveLength(0);
  });

  it('spans the timeline from the first gun to the last runner home', () => {
    const fieldInputs: FieldInput[] = CARD.map((entry, i) => ({
      ...inputs[i],
      courseKm: entry.km,
    }));
    const paces = new Map(fieldInputs.map((f) => [f.courseName, runnerPaces(f)]));
    const window = fieldWindow(fieldInputs, paces);

    expect(formatEventClock(window.startSeconds, RACE_DATE)).toBe('Fri 08:00');

    // The 100 miles' slowest is the last off the course, at its 49-hour limit — plus the
    // corral. Whoever leaves at the back of a five-minute start crosses five minutes
    // later, which is a fact about the field rather than a rounding error, and whether it
    // puts them over depends on the race timing gun or chip.
    const limit = eventSecondsFrom('09:00', 2)!;
    expect(window.endSeconds).toBeGreaterThanOrEqual(limit);
    expect(window.endSeconds - limit).toBeLessThanOrEqual(5 * 60);
  });
});

describe('what the published cut-offs are shaped like', () => {
  const cotAt = (distance: string, checkpoint: string) => {
    const entry = CARD.find((e) => e.name === distance)!;
    const cp = entry.checkpoints.find((c) => c.name === checkpoint);
    return cp ? eventSecondsFrom(cp.clock, cp.day) : null;
  };
  const finishOf = (distance: string) => {
    const entry = CARD.find((e) => e.name === distance)!;
    return eventSecondsFrom(entry.cutoffClock, entry.cutoffDay)!;
  };

  it('closes a shared checkpoint at one moment for both ultras', () => {
    // A crew tears a checkpoint down once. The 100 miles and the 100 km run the same
    // ground from CP2 on, and every cut-off they share is the same instant — so a
    // schedule that gave each distance its own closing time would staff it twice.
    for (const cp of ['CP2', 'CP3', 'CP4', 'CP5', 'CP6', 'CP7']) {
      expect(cotAt('100 Miles', cp)).toBe(cotAt('100km', cp));
    }
    expect(finishOf('100 Miles')).toBe(finishOf('100km'));
  });

  it('closes the shorter pair together too', () => {
    for (const cp of ['CP4', 'CP5', 'CP6', 'CP7']) {
      expect(cotAt('70km', cp)).toBe(cotAt('50km', cp));
    }
    expect(finishOf('70km')).toBe(finishOf('50km'));
  });

  it('gives one checkpoint two different cut-offs for two groups', () => {
    // CP3 closes at eleven in the morning for the 70 km and at eight in the evening for
    // the ultras. Both are real: the shorter field must be through by one time, and the
    // crew stands until the other. A model holding a single cut-off per station cannot
    // express that, and the gap is not small — nine hours at CP3, eight and a half at CP2.
    for (const [cp, hours] of [
      ['CP2', 8.5],
      ['CP3', 9],
    ] as const) {
      const short = cotAt('70km', cp)!;
      const long = cotAt('100km', cp)!;
      expect(short).toBeLessThan(long);
      expect((long - short) / 3600).toBe(hours);
    }
  });

  it('runs the ultras’ checkpoints past midnight and the shorter pair’s before it', () => {
    expect(cotAt('100km', 'CP5')!).toBeGreaterThan(eventSecondsFrom('00:00', SUN)!);
    expect(cotAt('70km', 'CP7')!).toBeLessThan(eventSecondsFrom('00:00', SUN)!);
  });

  it('gives the two short distances one intermediate cut-off each', () => {
    // Not none. Both short races have a checkpoint that turns runners round, and a plan
    // that treats them as start-to-finish only staffs the sweep at the wrong hour.
    expect(cotAt('21km', 'CP M3')).toBe(eventSecondsFrom('15:30', SAT));
    expect(cotAt('10km', 'CP M4')).toBe(eventSecondsFrom('13:30', SAT));
    for (const name of ['21km', '10km']) {
      expect(CARD.find((e) => e.name === name)!.checkpoints).toHaveLength(1);
    }
  });

  it('never lets an intermediate cut-off fall after its own finish', () => {
    for (const entry of CARD) {
      const finish = eventSecondsFrom(entry.cutoffClock, entry.cutoffDay)!;
      for (const cp of entry.checkpoints) {
        expect(eventSecondsFrom(cp.clock, cp.day)!).toBeLessThan(finish);
      }
    }
  });

  it('keeps every intermediate cut-off after its own gun', () => {
    for (const entry of CARD) {
      const start = eventSecondsFrom(entry.startClock, entry.startDay)!;
      for (const cp of entry.checkpoints) {
        expect(eventSecondsFrom(cp.clock, cp.day)!).toBeGreaterThan(start);
      }
    }
  });
});

describe('the distances that start in waves', () => {
  const entryFor = (name: string) => CARD.find((e) => e.name === name)!;

  it('puts the 21 km on the course over forty minutes, not ten', () => {
    // Three guns a quarter-hour apart, and ten more minutes for the last of them to
    // clear the arch. Forty minutes is the figure the race gives, and it is four times
    // the spread a single mass start would have been modelled with.
    expect(entryFor('21km').waves).toEqual(['08:00', '08:15', '08:30']);
    expect(startSpreadOf(entryFor('21km'))).toBe(40);
  });

  it('spreads the 50 km over its two waves', () => {
    expect(entryFor('50km').waves).toEqual(['05:30', '06:00']);
    expect(startSpreadOf(entryFor('50km'))).toBe(35);
  });

  it('starts every wave no earlier than the distance’s published gun', () => {
    for (const entry of CARD) {
      expect(entry.waves[0]).toBe(entry.startClock);
    }
  });

  it('holds the last 21 km wave inside the finish limit it is judged against', () => {
    // A runner released half an hour after the gun is still cut off at 21:00 by the
    // clock on the wall. The spread is time they do not get back, and the tool has to
    // model the tail from the last wave rather than from the first.
    const entry = entryFor('21km');
    const lastGun = eventSecondsFrom(entry.waves[entry.waves.length - 1], entry.startDay)!;
    const finish = eventSecondsFrom(entry.cutoffClock, entry.cutoffDay)!;
    expect((finish - lastGun) / 3600).toBe(12.5);
    expect((finish - lastGun) / 3600).toBeLessThan(entry.limitHours);
  });

  it('widens a start-line count in step with the spread it is given', () => {
    // The point of carrying the wave structure at all: a first checkpoint sees the field
    // arrive over at least as long as the arch released it.
    const wide = runPipeline(
      KML(CARD.map((e) => [e.name, e.km])),
      inputs,
      { stationFolders: ['CP'] }
    );
    const narrow = runPipeline(
      KML(CARD.map((e) => [e.name, e.km])),
      inputs.map((input) => ({ ...input, startSpreadMinutes: 5 })),
      { stationFolders: ['CP'] }
    );

    const spanOf = (out: ReturnType<typeof runPipeline>) =>
      Math.max(...out.stations.map((s) => s.schedule.closeSeconds - s.schedule.openSeconds));

    expect(spanOf(wide)).toBeGreaterThan(spanOf(narrow));
  });
});
