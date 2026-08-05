import { describe, expect, it } from 'vitest';
import { DEFAULT_CUTOFF_GRACE_MINUTES, MAX_CUTOFF_MARGIN_MINUTES } from '../config';
import { parseClockTimeToSeconds } from '../time';
import {
  buildArrivalHistogram,
  peakRunnersPerWindow,
  buildCutoffTable,
  buildStackedHistogram,
  buildStationSchedule,
  classifyActivityLevel,
  peakRunnersPerHour,
  type DistanceCrossing,
} from '../schedule';

describe('buildArrivalHistogram', () => {
  it('returns an empty array for no arrivals', () => {
    expect(buildArrivalHistogram([])).toEqual([]);
  });

  it('bins arrivals into fixed-width windows', () => {
    const sixAM = 6 * 3600;
    const arrivals = [sixAM, sixAM + 60, sixAM + 60 * 20, sixAM + 60 * 16]; // two in first 15-min bin, two in the second
    const bins = buildArrivalHistogram(arrivals, 15);
    expect(bins).toHaveLength(2);
    expect(bins[0].count).toBe(2);
    expect(bins[1].count).toBe(2);
  });

  it('produces a single bin for a single-instant arrival set', () => {
    const bins = buildArrivalHistogram([1000, 1000, 1000], 15);
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(3);
  });
});

describe('buildStackedHistogram', () => {
  const sixAM = 6 * 3600;

  it('bins each course into its own slot on a shared grid', () => {
    const bins = buildStackedHistogram(
      [
        [sixAM, sixAM + 60],
        [sixAM + 16 * 60],
      ],
      15,
      sixAM,
      sixAM + 30 * 60
    );

    expect(bins).toHaveLength(2);
    expect(bins[0].byCourse).toEqual([2, 0]);
    expect(bins[0].total).toBe(2);
    expect(bins[1].byCourse).toEqual([0, 1]);
  });

  it('spans the whole requested range even where a station has no arrivals', () => {
    const bins = buildStackedHistogram([[sixAM]], 15, sixAM, sixAM + 60 * 60);
    expect(bins).toHaveLength(4);
    expect(bins.slice(1).every((b) => b.total === 0)).toBe(true);
  });

  it('produces the same grid for different stations so rows line up', () => {
    const a = buildStackedHistogram([[sixAM + 100]], 15, sixAM, sixAM + 3600);
    const b = buildStackedHistogram([[sixAM + 2000]], 15, sixAM, sixAM + 3600);
    expect(a.map((x) => x.binStartSeconds)).toEqual(b.map((x) => x.binStartSeconds));
  });

  it('drops arrivals outside the range rather than distorting the edge bins', () => {
    const bins = buildStackedHistogram([[sixAM - 10000, sixAM + 60, sixAM + 99999]], 15, sixAM, sixAM + 900);
    expect(bins.reduce((sum, b) => sum + b.total, 0)).toBe(1);
  });

  it('returns nothing for a degenerate range', () => {
    expect(buildStackedHistogram([[sixAM]], 15, sixAM, sixAM)).toEqual([]);
  });
});

describe('peakRunnersPerHour', () => {
  it('scales the busiest bin count up to a per-hour rate', () => {
    const bins = [
      { binStartSeconds: 0, binEndSeconds: 900, count: 10 },
      { binStartSeconds: 900, binEndSeconds: 1800, count: 25 },
    ];
    expect(peakRunnersPerHour(bins, 15)).toBe(100); // 25 runners per 15 min -> 100/hr
  });

  it('returns 0 for no bins', () => {
    expect(peakRunnersPerHour([])).toBe(0);
  });
});

describe('peakRunnersPerWindow', () => {
  it('gives back the number that was counted, not an extrapolation of it', () => {
    const bins = [
      { binStartSeconds: 0, binEndSeconds: 900, count: 10 },
      { binStartSeconds: 900, binEndSeconds: 1800, count: 322 },
    ];
    // The hourly rate reads as a crowd four times the size of the one that turned up.
    expect(peakRunnersPerHour(bins, 15)).toBe(1288);
    expect(peakRunnersPerWindow(peakRunnersPerHour(bins, 15), 15)).toBe(322);
  });

  it('round-trips at any bin width', () => {
    for (const bin of [5, 10, 15, 20, 30, 60]) {
      const bins = [{ binStartSeconds: 0, binEndSeconds: bin * 60, count: 77 }];
      expect(peakRunnersPerWindow(peakRunnersPerHour(bins, bin), bin)).toBe(77);
    }
  });
});

describe('classifyActivityLevel', () => {
  it('uses the default thresholds', () => {
    expect(classifyActivityLevel(30)).toBe('Low');
    expect(classifyActivityLevel(60)).toBe('Medium');
    expect(classifyActivityLevel(200)).toBe('High');
  });

  it('respects custom thresholds', () => {
    expect(classifyActivityLevel(50, { mediumRunnersPerHour: 100, highRunnersPerHour: 300 })).toBe('Low');
  });
});

function crossing(courseName: string, kmFromStart: number, p1Clock: string, p99Clock: string, officialCutoffClock?: string): DistanceCrossing {
  const toSeconds = (clock: string) => {
    const [h, m] = clock.split(':').map(Number);
    return h * 3600 + m * 60;
  };
  return {
    courseName,
    kmFromStart,
    arrivalPercentiles: [
      { percentile: 1, seconds: toSeconds(p1Clock), clockTime: p1Clock },
      { percentile: 99, seconds: toSeconds(p99Clock), clockTime: p99Clock },
    ],
    officialCutoffClock,
  };
}

describe('buildStationSchedule', () => {
  it('opens before the earliest P1 minus the setup buffer and closes after the latest P99 plus teardown', () => {
    const schedule = buildStationSchedule('Solo Station', [crossing('10km', 5, '07:00', '09:00')], {
      setupBufferMinutes: 30,
      teardownBufferMinutes: 20,
    });
    expect(schedule.openClockTime).toBe('06:30:00');
    expect(schedule.closeClockTime).toBe('09:20:00');
  });

  it('combines a shared checkpoint using the earliest open and the LATEST close across distances', () => {
    const schedule = buildStationSchedule(
      'Shared Station',
      [crossing('10km', 5, '07:00', '09:00'), crossing('Half Marathon', 11, '07:30', '11:00')],
      { setupBufferMinutes: 30, teardownBufferMinutes: 20 }
    );
    // earliest open: 07:00 - 30min = 06:30
    expect(schedule.openClockTime).toBe('06:30:00');
    // latest close: max(09:00+20min, 11:00+20min) = 11:20
    expect(schedule.closeClockTime).toBe('11:20:00');
  });

  it('uses the official cutoff instead of P99+teardown when provided, and flags if modeled arrivals exceed it', () => {
    const schedule = buildStationSchedule('Cutoff Station', [crossing('Marathon', 21, '07:00', '13:30', '13:00')]);
    expect(schedule.closeClockTime).toBe('13:00:00');
    expect(schedule.cutoffExceeded).toBe(true);
    expect(schedule.cutoffDetails[0]).toMatchObject({ courseName: 'Marathon', cutoffClock: '13:00' });
  });

  it('does not flag a cutoff that modeled arrivals stay within', () => {
    const schedule = buildStationSchedule('Cutoff Station 2', [crossing('Marathon', 21, '07:00', '12:30', '13:00')]);
    expect(schedule.cutoffExceeded).toBe(false);
  });

  it('derives activity level and peak runners/hour from raw arrival timestamps', () => {
    const sixAM = 6 * 3600;
    const busyCrossing: DistanceCrossing = {
      ...crossing('10km', 5, '06:00', '08:00'),
      runnerArrivalsSeconds: Array.from({ length: 60 }, (_, i) => sixAM + (i % 15) * 60), // 60 arrivals packed into a 15-min pattern
    };
    const schedule = buildStationSchedule('Busy Station', [busyCrossing], { binMinutes: 15 });
    expect(schedule.peakRunnersPerHour).toBeGreaterThan(0);
    expect(['Low', 'Medium', 'High']).toContain(schedule.activityLevel);
  });

  it('throws when given no crossings', () => {
    expect(() => buildStationSchedule('Empty', [])).toThrow();
  });
});

describe('buildCutoffTable', () => {
  it('flattens cutoff rows across stations, flagging exceeded ones', () => {
    const stations = [
      buildStationSchedule('Turnaround', [crossing('Marathon', 21, '07:00', '13:30', '13:00')]),
      buildStationSchedule('Finish', [crossing('Marathon', 42.2, '07:00', '14:00', '15:00')]),
    ];

    const rows = buildCutoffTable(stations);
    expect(rows).toHaveLength(2);
    // The map's 13:00 is tighter than a proposal built on a 13:30 tail.
    expect(rows.find((r) => r.stationName === 'Turnaround')?.mapIsTighter).toBe(true);
    expect(rows.find((r) => r.stationName === 'Finish')?.mapIsTighter).toBe(false);
  });

  it('proposes a cut-off for every crossing, not only those the map named', () => {
    const stations = [buildStationSchedule('No Cutoff', [crossing('10km', 5, '07:00', '09:00')])];
    const rows = buildCutoffTable(stations, { graceMinutes: 15 });
    expect(rows).toHaveLength(1);
    expect(rows[0].mapClockTime).toBeUndefined();
    // 09:00 tail + 15 min grace, already on a quarter hour.
    expect(rows[0].suggestedClockTime).toBe('09:15:00');
  });

  it('rounds a proposal up rather than to nearest', () => {
    const stations = [buildStationSchedule('Odd', [crossing('10km', 5, '07:00', '09:01')])];
    // 09:01 + 5 = 09:06, which rounds up to 09:10 — never back to 09:05, which would
    // be tighter than the calculation asked for.
    expect(buildCutoffTable(stations)[0].suggestedClockTime).toBe('09:10:00');
  });

  it('adds the operator’s grace, not a fixed one', () => {
    const stations = [buildStationSchedule('Grace', [crossing('10km', 5, '07:00', '09:00')])];
    // The same tail, held open longer, has to propose a later cut-off.
    expect(buildCutoffTable(stations, { graceMinutes: 5 })[0].suggestedClockTime).toBe('09:05:00');
    expect(buildCutoffTable(stations, { graceMinutes: 40 })[0].suggestedClockTime).toBe('09:40:00');
  });

  it('never sits more than fifteen minutes past the slowest arrival', () => {
    // Every minute of an hour, so no arrival happens to fall kindly on the rounding.
    for (let minute = 0; minute < 60; minute++) {
      const tail = `09:${String(minute).padStart(2, '0')}`;
      const stations = [buildStationSchedule('Tail', [crossing('10km', 5, '07:00', tail)])];
      const row = buildCutoffTable(stations)[0];

      const proposed = parseClockTimeToSeconds(row.suggestedClockTime)!;
      const arrival = parseClockTimeToSeconds(row.modeledLastArrivalClockTime)!;
      const margin = (proposed - arrival) / 60;

      expect(margin).toBeLessThanOrEqual(MAX_CUTOFF_MARGIN_MINUTES);
      // And never before the field it is meant to let through.
      expect(margin).toBeGreaterThanOrEqual(DEFAULT_CUTOFF_GRACE_MINUTES);
    }
  });

  it('lets a grace larger than the cap stand, since the operator chose it', () => {
    const stations = [buildStationSchedule('Long', [crossing('10km', 5, '07:00', '09:02')])];
    const row = buildCutoffTable(stations, { graceMinutes: 30 })[0];
    const margin =
      (parseClockTimeToSeconds(row.suggestedClockTime)! -
        parseClockTimeToSeconds(row.modeledLastArrivalClockTime)!) /
      60;
    expect(margin).toBeGreaterThanOrEqual(30);
  });

  it('starts a race with five minutes of grace', () => {
    expect(DEFAULT_CUTOFF_GRACE_MINUTES).toBe(5);
  });
});

describe('activity thresholds in window terms', () => {
  // The settings panel shows and takes a per-window count while storing an hourly rate,
  // so the number an operator types has to classify exactly what they expect from the
  // peak column beside it.
  const perHour = (perWindow: number, binMinutes: number) => perWindow * (60 / binMinutes);

  it('tags a station on the count shown in its peak column', () => {
    const thresholds = {
      mediumRunnersPerHour: perHour(15, 15),
      highRunnersPerHour: perHour(40, 15),
    };
    // A station whose busiest window holds 40 is High; 39 is not.
    expect(classifyActivityLevel(perHour(40, 15), thresholds)).toBe('High');
    expect(classifyActivityLevel(perHour(39, 15), thresholds)).toBe('Medium');
    expect(classifyActivityLevel(perHour(14, 15), thresholds)).toBe('Low');
  });

  it('means the same load whatever the window is set to', () => {
    // 40 through a quarter hour is the same crowd as 80 through a half hour, so a
    // threshold typed at one bin width must not reclassify when the width changes.
    const thresholds = { mediumRunnersPerHour: 60, highRunnersPerHour: perHour(40, 15) };
    expect(classifyActivityLevel(perHour(40, 15), thresholds)).toBe('High');
    expect(classifyActivityLevel(perHour(80, 30), thresholds)).toBe('High');
    expect(classifyActivityLevel(perHour(79, 30), thresholds)).not.toBe('High');
  });

  it('round-trips a typed figure back to the same figure', () => {
    for (const bin of [5, 10, 15, 30]) {
      for (const typed of [5, 15, 40, 125]) {
        expect(Math.round(perHour(typed, bin) / (60 / bin))).toBe(typed);
      }
    }
  });
});
