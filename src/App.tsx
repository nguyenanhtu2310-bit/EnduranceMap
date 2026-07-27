import { useMemo, useState } from 'react';
import { CrossingDistribution } from './components/CrossingDistribution';
import { CutoffTable } from './components/CutoffTable';
import { DistanceRunView } from './components/DistanceRunView';
import { DEFAULT_AMENITY_RULES, type AmenitySet } from './lib/amenities';
import {
  ALL_REPORT_SECTIONS,
  REPORT_SECTIONS,
  buildReportHtml,
  downloadReport,
  type ReportSections,
} from './lib/report';
import { FolderPicker } from './components/FolderPicker';
import { KmlDropzone } from './components/KmlDropzone';
import { PaceBandForm, type DistanceFormRow } from './components/PaceBandForm';
import { SettingsPanel, type Settings } from './components/SettingsPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { StationScheduleTable } from './components/StationScheduleTable';
import { TimingMatrix } from './components/TimingMatrix';
import { parseResultsCsv, summarizeProfile, type ContestProfile } from './lib/results';
import type { Course } from './lib/snap';
import { parseKml } from './lib/kml';
import { buildCourses } from './lib/snap';
import {
  listPlacemarkFolders,
  runPipeline,
  type DistanceInput,
  applyStationOrder,
  type FolderSummary,
  type PipelineResult,
} from './lib/pipeline';
import {
  DEFAULT_ACTIVITY_THRESHOLDS,
  DEFAULT_CUTOFF_GRACE_MINUTES,
  DEFAULT_HISTOGRAM_BIN_MINUTES,
  DEFAULT_SETUP_BUFFER_MINUTES,
  DEFAULT_TEARDOWN_BUFFER_MINUTES,
} from './lib/config';
import { DEFAULT_START_SPREAD_MINUTES } from './lib/paceModel';

interface LoadedKml {
  text: string;
  fileName: string;
}

const DEFAULT_SETTINGS: Settings = {
  setupBufferMinutes: DEFAULT_SETUP_BUFFER_MINUTES,
  teardownBufferMinutes: DEFAULT_TEARDOWN_BUFFER_MINUTES,
  cutoffGraceMinutes: DEFAULT_CUTOFF_GRACE_MINUTES,
  binMinutes: DEFAULT_HISTOGRAM_BIN_MINUTES,
  mediumRunnersPerHour: DEFAULT_ACTIVITY_THRESHOLDS.mediumRunnersPerHour,
  highRunnersPerHour: DEFAULT_ACTIVITY_THRESHOLDS.highRunnersPerHour,
};

/** Seeds a plausible pace band from the course length so the form starts usable. */
function seedRow(courseName: string, measuredKm: number): DistanceFormRow {
  const isLong = measuredKm > 30;
  return {
    courseName,
    measuredKm,
    startTimeClock: '05:00',
    startSpreadMinutes: DEFAULT_START_SPREAD_MINUTES,
    runnerCountText: '500',
    fastestMinPerKm: isLong ? 3.2 : 3.5,
    typicalMinPerKm: isLong ? 6.5 : 6.8,
    slowestMinPerKm: isLong ? 10 : 11,
  };
}

/**
 * Folders to schedule when a map contains one, most specific first. Most operational
 * questions are asked about a single class of position at a time, so defaulting to
 * every folder buries the answer in a hundred rows.
 */
const PREFERRED_DEFAULT_FOLDERS = ['TIMING', 'SIGNAGE: STATION'];

function defaultSelection(folders: FolderSummary[]): string[] {
  for (const preferred of PREFERRED_DEFAULT_FOLDERS) {
    const match = folders.find((f) => f.folder.trim().toLowerCase() === preferred.toLowerCase());
    if (match) return [match.folder];
  }
  return folders.map((f) => f.folder);
}

/**
 * Pairs each contest in a results file with the course it should drive, by matching the
 * contest's own distance against each course's measured length. A "Half Marathon" from
 * last year's export lands on this year's 21 km route without the operator wiring it up
 * by hand, and a course with no comparable contest is simply left unmapped.
 */
function autoMapContests(profiles: ContestProfile[], courses: Course[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();

  for (const profile of profiles) {
    if (profile.distanceKm <= 0) continue;
    let best: Course | undefined;
    let bestDelta = Infinity;
    for (const course of courses) {
      if (taken.has(course.name)) continue;
      const delta = Math.abs(course.totalKm - profile.distanceKm);
      if (delta < bestDelta) {
        best = course;
        bestDelta = delta;
      }
    }
    // Allow for GPS-traced routes running long, but never pair a 10K with a marathon.
    if (best && bestDelta <= Math.max(1, profile.distanceKm * 0.1)) {
      mapping[profile.contest] = best.name;
      taken.add(best.name);
    }
  }

  return mapping;
}

export default function App() {
  const [kml, setKml] = useState<LoadedKml | null>(null);
  const [rows, setRows] = useState<DistanceFormRow[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [renumber, setRenumber] = useState(true);
  const [renumberPrefix, setRenumberPrefix] = useState('Station');
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ fileName: string; profiles: ContestProfile[] } | null>(null);
  const [contestMapping, setContestMapping] = useState<Record<string, string>>({});
  const [courses, setCourses] = useState<Course[]>([]);
  const [stationOrder, setStationOrder] = useState<string[]>([]);
  const [amenityOverrides, setAmenityOverrides] = useState<Record<string, Partial<AmenitySet>>>({});
  const [raceName, setRaceName] = useState('');
  const [removedStations, setRemovedStations] = useState<string[]>([]);
  const [removedPasses, setRemovedPasses] = useState<string[]>([]);
  const [reportSections, setReportSections] = useState<ReportSections>(ALL_REPORT_SECTIONS);

  function loadKml(text: string, fileName: string) {
    setError(null);
    setResult(null);
    try {
      const parsed = parseKml(text);
      const courses = buildCourses(parsed.courses);
      if (courses.length === 0) {
        setKml(null);
        setRows([]);
        setFolders([]);
        setError(
          parsed.warnings[0] ??
            'No race routes found. Expected a folder named "RACE ROUTE" holding one line per distance.'
        );
        return;
      }
      const detected = listPlacemarkFolders(parsed.placemarks);
      setKml({ text, fileName });
      setRows(courses.map((c) => seedRow(c.name, c.totalKm)));
      setCourses(courses);
      setFolders(detected);
      setSelectedFolders(defaultSelection(detected));
      if (results) setContestMapping(autoMapContests(results.profiles, courses));
    } catch (e) {
      setKml(null);
      setRows([]);
      setFolders([]);
      setError(e instanceof Error ? e.message : 'Could not parse that KML.');
    }
  }

  /** Courses whose arrivals come from the results file rather than the pace band. */
  const mappedCourses = useMemo(() => {
    const names = new Set<string>();
    for (const profile of results?.profiles ?? []) {
      const courseName = contestMapping[profile.contest];
      if (courseName && profile.samples.length > 0) names.add(courseName);
    }
    return names;
  }, [results, contestMapping]);

  const invalidRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          !/^\d{1,2}:\d{2}/.test(r.startTimeClock) ||
          !Number.isFinite(Number(r.runnerCountText)) ||
          Number(r.runnerCountText) <= 0 ||
          !(r.fastestMinPerKm <= r.typicalMinPerKm && r.typicalMinPerKm <= r.slowestMinPerKm)
      ),
    [rows]
  );

  /**
   * Rewrites each mapped distance's pace band and field size from the real results, so
   * the numbers on screen are the ones actually driving the schedule. Runs on every
   * mapping change, not just on load — assigning a contest to a distance by hand is
   * exactly when the band needs to catch up.
   */
  function applyProfilesToRows(profiles: ContestProfile[], mapping: Record<string, string>) {
    const profileByCourse = new Map(
      profiles.filter((p) => mapping[p.contest]).map((p) => [mapping[p.contest], p])
    );

    setRows((current) =>
      current.map((row) => {
        const profile = profileByCourse.get(row.courseName);
        const summary = profile ? summarizeProfile(profile) : null;
        if (!profile || !summary) return row;
        return {
          ...row,
          fastestMinPerKm: Number(summary.pace.p1.toFixed(2)),
          typicalMinPerKm: Number(summary.pace.p50.toFixed(2)),
          slowestMinPerKm: Number(summary.pace.p99.toFixed(2)),
          runnerCountText: String(profile.finishers),
        };
      })
    );
  }

  function changeContestMapping(mapping: Record<string, string>) {
    setContestMapping(mapping);
    setResult(null);
    if (results) applyProfilesToRows(results.profiles, mapping);
  }

  function loadResults(text: string, fileName: string) {
    setError(null);
    setResult(null);
    const parsed = parseResultsCsv(text);
    if (parsed.profiles.length === 0) {
      setError(parsed.warnings[0] ?? 'No contests found in that results file.');
      return;
    }
    const mapping = autoMapContests(parsed.profiles, courses);
    setResults({ fileName, profiles: parsed.profiles });
    setContestMapping(mapping);
    applyProfilesToRows(parsed.profiles, mapping);
  }

  function calculate(overrides?: { stations?: string[]; passes?: string[] }) {
    if (!kml) return;
    const excludeStations = overrides?.stations ?? removedStations;
    const excludePasses = overrides?.passes ?? removedPasses;
    setError(null);
    try {
      const samplesByCourse = new Map<string, ContestProfile['samples']>();
      for (const profile of results?.profiles ?? []) {
        const courseName = contestMapping[profile.contest];
        if (courseName && profile.samples.length > 0) samplesByCourse.set(courseName, profile.samples);
      }

      const inputs: DistanceInput[] = rows.map((r) => ({
        courseName: r.courseName,
        startTimeClock: r.startTimeClock,
        startSpreadMinutes: r.startSpreadMinutes,
        runnerCount: Number(r.runnerCountText),
        fastestMinPerKm: r.fastestMinPerKm,
        typicalMinPerKm: r.typicalMinPerKm,
        slowestMinPerKm: r.slowestMinPerKm,
        samples: samplesByCourse.get(r.courseName),
      }));

      const computed = runPipeline(kml.text, inputs, {
          stationFolders: selectedFolders,
          excludeStations,
          excludePasses,
          renumberStationsAs: renumber ? renumberPrefix.trim() || 'Station' : undefined,
          setupBufferMinutes: settings.setupBufferMinutes,
          teardownBufferMinutes: settings.teardownBufferMinutes,
          cutoffGraceMinutes: settings.cutoffGraceMinutes,
          binMinutes: settings.binMinutes,
          activityThresholds: {
            mediumRunnersPerHour: settings.mediumRunnersPerHour,
            highRunnersPerHour: settings.highRunnersPerHour,
          },
        });

      setResult({ ...computed, stations: applyStationOrder(computed.stations, stationOrder) });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Calculation failed.');
    }
  }

  return (
    <div className="app">
      <div className="masthead">
        {/* Phosphor map-pin, per the brand's icon set. */}
        <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
          <path d="M128 16a88.1 88.1 0 0 0-88 88c0 75.3 80 132.17 83.41 134.55a8 8 0 0 0 9.18 0C136 236.17 216 179.3 216 104a88.1 88.1 0 0 0-88-88Zm0 56a32 32 0 1 1-32 32 32 32 0 0 1 32-32Z" />
        </svg>
        <span className="wordmark">EnduranceMap</span>
      </div>

      <header>
        <h1>Race CP Operations Calculator</h1>
        <p>Turn a course map into a checkpoint operating schedule. Runs entirely in your browser.</p>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="card">
        <h2>
          <span className="step">1</span>Course map
        </h2>
        <p className="hint">A KML exported from Google My Maps.</p>
        <KmlDropzone fileName={kml?.fileName} onLoad={loadKml} onError={setError} />
      </section>

      {rows.length > 0 && (
        <>
          <section className="card">
            <h2>
              <span className="step">2</span>Which positions to schedule
            </h2>
            <p className="hint">Map folders holding point placemarks. Tick the ones you need staffing for.</p>
            <FolderPicker
              folders={folders}
              selected={selectedFolders}
              onChange={setSelectedFolders}
              renumber={renumber}
              renumberPrefix={renumberPrefix}
              onRenumberChange={setRenumber}
              onRenumberPrefixChange={setRenumberPrefix}
            />
          </section>

          <section className="card">
            <h2>
              <span className="step">3</span>Previous race results
            </h2>
            <p className="hint">
              Optional. A finish-line export from a comparable race replaces the estimated pace band with the
              real field — every runner's own pace and start offset.
            </p>
            <ResultsPanel
              fileName={results?.fileName}
              profiles={results?.profiles ?? []}
              courses={courses}
              mapping={contestMapping}
              onLoad={loadResults}
              onMappingChange={changeContestMapping}
              onClear={() => {
                setResults(null);
                setContestMapping({});
                setResult(null);
              }}
              onError={setError}
            />
          </section>

          <section className="card">
            <h2>
              <span className="step">4</span>Pace bands and field size
            </h2>
            <p className="hint">
              {mappedCourses.size > 0
                ? `Start time and field size apply to every distance. Pace is taken from the results file for ${[...mappedCourses].join(', ')} — the band shown there is for reference only.`
                : 'One row per distance found in the map. These stand in for a results CSV until you have one.'}
            </p>
            <PaceBandForm rows={rows} onChange={setRows} drivenByResults={mappedCourses} />
          </section>

          <section className="card">
            <h2>
              <span className="step">5</span>Operating assumptions
            </h2>
            <SettingsPanel settings={settings} onChange={setSettings} />
          </section>

          <div className="actions" style={{ marginBottom: '1.75rem' }}>
            <button onClick={() => calculate()} disabled={invalidRows.length > 0 || selectedFolders.length === 0}>
              Calculate schedule
            </button>
            {selectedFolders.length === 0 && (
              <span className="hint" style={{ margin: 0 }}>
                Tick at least one folder to schedule.
              </span>
            )}
            {invalidRows.length > 0 && (
              <span className="hint" style={{ margin: 0 }}>
                Check {invalidRows.map((r) => r.courseName).join(', ')}: needs a start time, a runner count above
                zero, and fastest ≤ typical ≤ slowest.
              </span>
            )}
          </div>
        </>
      )}

      {result && (
        <>
          <section className="card">
            <h2>Export</h2>
            <p className="hint">
              A single self-contained HTML file — no scripts, no external styles. The organiser can open it
              offline, print it, or forward it without needing this tool.
            </p>
            <div className="folder-list" style={{ marginBottom: '1rem' }}>
              {REPORT_SECTIONS.map((section) => (
                <label
                  key={section.key}
                  className={reportSections[section.key] ? 'folder-item on' : 'folder-item'}
                  title={section.hint}
                >
                  <input
                    type="checkbox"
                    checked={reportSections[section.key]}
                    onChange={(e) =>
                      setReportSections({ ...reportSections, [section.key]: e.target.checked })
                    }
                  />
                  <span className="folder-name">{section.label}</span>
                </label>
              ))}
            </div>

            <div className="actions">
              <label className="field" style={{ margin: 0, flex: '1 1 260px' }}>
                Race name
                <input
                  type="text"
                  value={raceName}
                  placeholder={kml?.fileName.replace(/\.kml$/i, '') ?? 'Race'}
                  onChange={(e) => setRaceName(e.target.value)}
                  style={{ marginTop: '0.25rem' }}
                />
              </label>
              <button
                onClick={() => {
                  const name = raceName.trim() || kml?.fileName.replace(/\.kml$/i, '') || 'Race';
                  const html = buildReportHtml(result, {
                    raceName: name,
                    sections: reportSections,
                    rules: DEFAULT_AMENITY_RULES,
                    overrides: amenityOverrides,
                    sourceFileName: kml?.fileName,
                    resultsFileName: results?.fileName,
                  });
                  downloadReport(html, `${name.replace(/[^\w\d -]+/g, '').trim() || 'race'} - CP operations.html`);
                }}
                disabled={!Object.values(reportSections).some(Boolean)}
              >
                Download report
              </button>
              {!Object.values(reportSections).some(Boolean) && (
                <span className="hint" style={{ margin: 0 }}>
                  Pick at least one section.
                </span>
              )}
            </div>
          </section>

          {result.warnings.length > 0 && (
            <div className="notice">
              <strong>{result.warnings.length} thing(s) to check in the source map</strong>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <section className="card">
            <h2>Station operating schedule</h2>
            <p className="hint">
              {result.stations.length} stations across {result.courses.length} distances. Open is the first
              modeled arrival minus the setup buffer; close is the official cut-off where one exists, otherwise
              the last modeled arrival plus teardown. A station shared by several distances closes on the latest
              of them.
            </p>
            {removedStations.length > 0 && (
              <div className="actions" style={{ marginBottom: '0.85rem' }}>
                <span className="hint" style={{ margin: 0 }}>
                  {removedStations.length} removed:
                </span>
                {removedStations.map((name) => (
                  <button
                    key={name}
                    className="secondary"
                    title="Put this station back"
                    onClick={() => {
                      const next = removedStations.filter((n) => n !== name);
                      setRemovedStations(next);
                      calculate({ stations: next });
                    }}
                  >
                    {name} ↩
                  </button>
                ))}
              </div>
            )}
            <StationScheduleTable
              stations={result.stations}
              showSourceNames={renumber}
              onReorder={(order) => {
                setStationOrder(order);
                setResult((current) =>
                  current ? { ...current, stations: applyStationOrder(current.stations, order) } : current
                );
              }}
              onRemove={(mapName) => {
                const next = [...removedStations, mapName];
                setRemovedStations(next);
                calculate({ stations: next });
              }}
            />
          </section>

          <section className="card">
            <h2>Course amenities</h2>
            <p className="hint">
              The points a runner meets in order, with the gap from the previous one and what each one stocks
              — the view for spacing water and aid.
            </p>
            {removedPasses.length > 0 && (
              <div className="actions" style={{ marginBottom: '0.85rem' }}>
                <span className="hint" style={{ margin: 0 }}>
                  {removedPasses.length} pass{removedPasses.length === 1 ? '' : 'es'} removed:
                </span>
                {removedPasses.map((key) => {
                  const [station, courseName] = key.split('|');
                  return (
                    <button
                      key={key}
                      className="secondary"
                      title="Put this pass back"
                      onClick={() => {
                        const next = removedPasses.filter((k) => k !== key);
                        setRemovedPasses(next);
                        calculate({ passes: next });
                      }}
                    >
                      {station} · {courseName} ↩
                    </button>
                  );
                })}
              </div>
            )}
            <DistanceRunView
              result={result}
              rules={DEFAULT_AMENITY_RULES}
              overrides={amenityOverrides}
              onOverridesChange={setAmenityOverrides}
              onRemovePass={(key) => {
                const next = [...removedPasses, key];
                setRemovedPasses(next);
                calculate({ passes: next });
              }}
            />
          </section>

          <section className="card">
            <h2>Split calculation</h2>
            <p className="hint">
              Every point each distance runs through, with the kilometre it falls at on that distance's own
              route and the hours the position is staffed.
            </p>
            <TimingMatrix result={result} />
          </section>

          <section className="card">
            <h2>Crossing time distribution</h2>
            <p className="hint">
              Runner arrivals per {result.binMinutes} minutes, stacked by distance, on one shared clock. Rows
              run in course order, so the field can be seen moving down the route. The cap marks each station’s
              busiest window.
            </p>
            <CrossingDistribution result={result} />
          </section>

          <section className="card">
            <h2>Cut-off times</h2>
            <CutoffTable result={result} graceMinutes={settings.cutoffGraceMinutes} />
          </section>


          {result.skipped.length > 0 && (
            <section className="card">
              <details>
                <summary>{result.skipped.length} placemark(s) left out of the schedule</summary>
                <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Placemark</th>
                        <th>Folder</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.skipped.map((s, i) => (
                        <tr key={i}>
                          <td>{s.name}</td>
                          <td className="muted small">{s.folder}</td>
                          <td className="muted small">{s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}
        </>
      )}

      <footer className="powered-by">
        <span>Powered by</span>
        <span className="chip">
          <img src="/sportstats-logo.png" alt="Sportstats" />
        </span>
      </footer>
    </div>
  );
}
