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

/** 2026-09-25 is a Friday, so day 0 is Friday and day 2 is Sunday. */
const RACE_DATE = '2026-09-25';

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
  km: number;
  startClock: string;
  startDay: number;
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
    name: '100 Miles', km: 161, startClock: '08:00', startDay: FRI,
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
    name: '100km', km: 101.6, startClock: '05:00', startDay: SAT,
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
    name: '70km', km: 70.2, startClock: '03:00', startDay: SAT,
    cutoffClock: '00:00', cutoffDay: SUN, limitHours: 21,
    checkpoints: [
      { name: 'CP3', clock: '12:00', day: SAT },
      { name: 'CP4', clock: '15:00', day: SAT },
      { name: 'CP5', clock: '17:00', day: SAT },
      { name: 'CP6', clock: '20:00', day: SAT },
      { name: 'CP7', clock: '21:30', day: SAT },
    ],
  },
  {
    name: '50km', km: 47.4, startClock: '05:30', startDay: SAT,
    cutoffClock: '00:00', cutoffDay: SUN, limitHours: 18.5,
    checkpoints: [
      { name: 'CP4', clock: '15:00', day: SAT },
      { name: 'CP5', clock: '17:00', day: SAT },
      { name: 'CP6', clock: '20:00', day: SAT },
      { name: 'CP7', clock: '21:30', day: SAT },
    ],
  },
  {
    name: '21km', km: 21.4, startClock: '08:00', startDay: SAT,
    cutoffClock: '21:00', cutoffDay: SAT, limitHours: 13, checkpoints: [],
  },
  {
    name: '10km', km: 10.2, startClock: '09:00', startDay: SAT,
    cutoffClock: '15:30', cutoffDay: SAT, limitHours: 6.5, checkpoints: [],
  },
];

const inputs: DistanceInput[] = CARD.map((entry) => ({
  courseName: entry.name,
  startTimeClock: entry.startClock,
  startDayOffset: entry.startDay,
  startSpreadMinutes: 5,
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
    // CP3 closes at noon for the 70 km and at eight in the evening for the ultras. Both
    // are real: the shorter field must be through by one time, and the crew stands until
    // the other. A model holding a single cut-off per station cannot express that.
    const short = cotAt('70km', 'CP3')!;
    const long = cotAt('100km', 'CP3')!;
    expect(short).toBeLessThan(long);
    expect((long - short) / 3600).toBe(8);
  });

  it('runs the ultras’ checkpoints past midnight and the shorter pair’s before it', () => {
    expect(cotAt('100km', 'CP5')!).toBeGreaterThan(eventSecondsFrom('00:00', SUN)!);
    expect(cotAt('70km', 'CP7')!).toBeLessThan(eventSecondsFrom('00:00', SUN)!);
  });

  it('leaves the two short distances with a finish cut-off and nothing else', () => {
    for (const name of ['21km', '10km']) {
      expect(CARD.find((e) => e.name === name)!.checkpoints).toEqual([]);
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
