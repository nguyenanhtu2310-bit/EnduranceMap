import { useMemo, useState } from 'react';
import { FolderPicker } from './components/FolderPicker';
import { KmlDropzone } from './components/KmlDropzone';
import { PaceBandForm, type DistanceFormRow } from './components/PaceBandForm';
import { SettingsPanel, type Settings } from './components/SettingsPanel';
import { StationScheduleTable } from './components/StationScheduleTable';
import { parseKml } from './lib/kml';
import { buildCourses } from './lib/snap';
import {
  listPlacemarkFolders,
  runPipeline,
  type DistanceInput,
  type FolderSummary,
  type PipelineResult,
} from './lib/pipeline';
import {
  DEFAULT_ACTIVITY_THRESHOLDS,
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
 * Folder to schedule when a map contains one. Most operational questions are asked
 * about a single class of position at a time, so defaulting to every folder buries the
 * answer in a hundred rows.
 */
const PREFERRED_DEFAULT_FOLDER = 'SIGNAGE: STATION';

function defaultSelection(folders: FolderSummary[]): string[] {
  const preferred = folders.find((f) => f.folder.trim().toLowerCase() === PREFERRED_DEFAULT_FOLDER.toLowerCase());
  return preferred ? [preferred.folder] : folders.map((f) => f.folder);
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
      setFolders(detected);
      setSelectedFolders(defaultSelection(detected));
    } catch (e) {
      setKml(null);
      setRows([]);
      setFolders([]);
      setError(e instanceof Error ? e.message : 'Could not parse that KML.');
    }
  }

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

  function calculate() {
    if (!kml) return;
    setError(null);
    try {
      const inputs: DistanceInput[] = rows.map((r) => ({
        courseName: r.courseName,
        startTimeClock: r.startTimeClock,
        startSpreadMinutes: r.startSpreadMinutes,
        runnerCount: Number(r.runnerCountText),
        fastestMinPerKm: r.fastestMinPerKm,
        typicalMinPerKm: r.typicalMinPerKm,
        slowestMinPerKm: r.slowestMinPerKm,
      }));

      setResult(
        runPipeline(kml.text, inputs, {
          stationFolders: selectedFolders,
          renumberStationsAs: renumber ? renumberPrefix.trim() || 'Station' : undefined,
          setupBufferMinutes: settings.setupBufferMinutes,
          teardownBufferMinutes: settings.teardownBufferMinutes,
          binMinutes: settings.binMinutes,
          activityThresholds: {
            mediumRunnersPerHour: settings.mediumRunnersPerHour,
            highRunnersPerHour: settings.highRunnersPerHour,
          },
        })
      );
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Calculation failed.');
    }
  }

  return (
    <div className="app">
      <header>
        <h1>EnduranceMap — Race CP Operations Calculator</h1>
        <p>
          Turn a course map into a checkpoint operating schedule. Runs entirely in your browser.
        </p>
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
              <span className="step">3</span>Pace bands and field size
            </h2>
            <p className="hint">
              One row per distance found in the map. These stand in for a results CSV until you have one.
            </p>
            <PaceBandForm rows={rows} onChange={setRows} />
          </section>

          <section className="card">
            <h2>
              <span className="step">4</span>Operating assumptions
            </h2>
            <SettingsPanel settings={settings} onChange={setSettings} />
          </section>

          <div className="actions" style={{ marginBottom: '1.75rem' }}>
            <button onClick={calculate} disabled={invalidRows.length > 0 || selectedFolders.length === 0}>
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
            <StationScheduleTable stations={result.stations} showSourceNames={renumber} />
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
    </div>
  );
}
