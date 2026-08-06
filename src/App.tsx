import { useEffect, useMemo, useRef, useState } from 'react';
import { CrossingDistribution } from './components/CrossingDistribution';
import { EnduranceMapLogo } from './components/Logo';
import {
  EMPTY_OVERRIDES,
  applyRaceOverrides,
  countOverrides,
  setCrossingOverride,
  setStationOverride,
  type CrossingOverride,
  type RaceOverrides,
  type StationOverride,
} from './lib/overrides';
import { CutoffTable } from './components/CutoffTable';
import { DistanceRunView } from './components/DistanceRunView';
import {
  DEFAULT_AMENITIES,
  DEFAULT_AMENITY_RULES,
  migrateAmenityOverrides,
  type Amenity,
  type AmenitySet,
} from './lib/amenities';
import { AmenityEditor } from './components/AmenityEditor';
import {
  ALL_REPORT_SECTIONS,
  REPORT_SECTIONS,
  buildReportHtml,
  downloadReport,
  type ReportSections,
} from './lib/report';
import { buildCrewSheetsHtml } from './lib/crewSheets';
import { buildReportSheets } from './lib/workbook';
import { downloadXlsx } from './lib/xlsx';
import { FolderPicker } from './components/FolderPicker';
import { KmlDropzone } from './components/KmlDropzone';
import { GpxPanel, type LoadedGpx } from './components/GpxPanel';
import { TimingPointsPanel } from './components/TimingPointsPanel';
import { StationNamingTable } from './components/StationNamingTable';
import { CourseCommandView } from './components/CourseCommandView';
import { FieldSlider } from './components/FieldSlider';
import { readCourseProfile, type CourseProfile } from './lib/courseProfile';
import { parseTimingPoints, type TimingPoint } from './lib/timingPoints';
import { timingStations, TIMING_FOLDER } from './lib/timingStations';
import { parseGpx } from './lib/gpx';
import { mergeCourseSources } from './lib/courseSources';
import { PaceBandForm, type DistanceFormRow } from './components/PaceBandForm';
import { MultisportPaceBandForm } from './components/MultisportPaceBandForm';
import { RaceFormatPicker } from './components/RaceFormatPicker';
import {
  autoBindCourses,
  detectPlacemarkLeg,
  instantiateTemplate,
  planFromCourses,
  skipsNamingOwnRace,
  validatePlan,
  type MultisportLeg,
  type MultisportPlan,
  type MultisportTemplateKey,
} from './lib/multisport';
import { autoMapMultisport, buildCourseRestriction, buildLegDistanceInputs } from './lib/multisportInputs';
import { SettingsPanel, type Settings } from './components/SettingsPanel';
import { ResultSection } from './components/ResultSection';
import { StationTrafficList } from './components/StationTrafficList';
import { seriesVar } from './lib/series';
import { useLanguage } from './lib/i18n';
import { ResultsPanel } from './components/ResultsPanel';
import { MultisportResultsPanel } from './components/MultisportResultsPanel';
import { StationScheduleTable } from './components/StationScheduleTable';
import { TimingMatrix } from './components/TimingMatrix';
import { parseResultsCsv, summarizeProfile, withContestDistance, type ContestProfile } from './lib/results';
import {
  detectResultsFormat,
  parseMultisportResultsCsv,
  summarizeMultisportProfile,
  withLegDistances,
  type MultisportProfile,
} from './lib/multisportResults';
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

/** The five sections of the RESULT part, in the order they are produced. */
type ResultSectionKey =
  | 'command'
  | 'naming'
  | 'schedule'
  | 'amenities'
  | 'splits'
  | 'distribution'
  | 'traffic'
  | 'cutoffs';

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
    organizerCutoffClock: '',
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

/**
 * A loaded results file. Multisport exports have no contest column and a time per leg,
 * so they cannot be described as `ContestProfile[]` and are kept apart rather than
 * squeezed into the same shape.
 */
type LoadedResults =
  | { kind: 'single'; fileName: string; profiles: ContestProfile[] }
  | { kind: 'multisport'; fileName: string; profiles: MultisportProfile[] };

/**
 * Everything one race's planning session holds. Tabs swap these wholesale, and the
 * saved .race.json is this minus what can be recomputed (the result) or re-derived
 * from the KML text (courses, folders).
 */
interface RaceSnapshot {
  kml: LoadedKml | null;
  /** Route files, one per distance. Their courses carry the elevation a KML loses. */
  gpx: LoadedGpx[];
  /** Timing split configs, one per distance. Stations take their names from these. */
  lvs: LoadedGpx[];
  /**
   * Stations the operator has said do or do not have a mat, against what the timing
   * config implied. Only the ones actually corrected are kept.
   */
  timedOverrides: Record<string, boolean>;
  /**
   * The event's first date, "YYYY-MM-DD". Optional — without one the tool counts days
   * instead of naming them, which is still better than a clock time that could mean
   * either of two mornings.
   */
  raceDate: string;
  rows: DistanceFormRow[];
  folders: FolderSummary[];
  selectedFolders: string[];
  settings: Settings;
  renumber: boolean;
  renumberPrefix: string;
  result: PipelineResult | null;
  results: LoadedResults | null;
  contestMapping: Record<string, string>;
  courses: Course[];
  stationOrder: string[];
  amenityOverrides: Record<string, Partial<AmenitySet>>;
  /** The amenity columns as this race names them — every race stocks differently. */
  amenities: Amenity[];
  raceName: string;
  removedStations: string[];
  removedPasses: string[];
  reportSections: ReportSections;
  stationNotes: Record<string, string>;
  raceOverrides: RaceOverrides;
  /**
   * Set only for a multisport race. Null is what makes a race single-sport — there is no
   * separate format flag that could disagree with the legs it holds.
   */
  multisport: MultisportPlan | null;
  /** Comma-separated name fragments whose placemarks are left out of the schedule. */
  skipNames: string;
}

function blankSnapshot(): RaceSnapshot {
  return {
    kml: null,
    gpx: [],
    lvs: [],
    timedOverrides: {},
    raceDate: '',
    rows: [],
    folders: [],
    selectedFolders: [],
    settings: DEFAULT_SETTINGS,
    renumber: true,
    renumberPrefix: 'Station',
    result: null,
    results: null,
    contestMapping: {},
    courses: [],
    stationOrder: [],
    amenityOverrides: {},
    amenities: DEFAULT_AMENITIES,
    raceName: '',
    removedStations: [],
    removedPasses: [],
    reportSections: ALL_REPORT_SECTIONS,
    stationNotes: {},
    raceOverrides: EMPTY_OVERRIDES,
    multisport: null,
    skipNames: '',
  };
}

/** Fields that go into a saved race file — the recomputable ones stay out. */
const RACE_FILE_FIELDS = [
  'kml', 'rows', 'selectedFolders', 'settings', 'renumber', 'renumberPrefix',
  'results', 'contestMapping', 'stationOrder', 'amenityOverrides', 'amenities', 'raceName',
  'removedStations', 'removedPasses', 'reportSections', 'stationNotes', 'raceOverrides',
  'multisport', 'skipNames',
] as const;

/**
 * Bumped when the shape of a saved race changes. Older files still open — every field
 * is spread over a blank snapshot, so anything they lack comes out at its default — but
 * a file from a newer build is refused rather than silently half-read.
 */
const RACE_FILE_VERSION = 2;

export default function App() {
  const { lang, setLang, t } = useLanguage();
  const [kml, setKml] = useState<LoadedKml | null>(null);
  const [rows, setRows] = useState<DistanceFormRow[]>([]);

  /**
   * Which RESULT sections are open. All of them to begin with — a plan that opened
   * folded would hide the answer the operator just pressed Calculate for — and shut one
   * at a time as they work through it.
   */
  const [openSections, setOpenSections] = useState<Record<ResultSectionKey, boolean>>({
    command: true,
    naming: true,
    schedule: true,
    amenities: true,
    splits: true,
    distribution: true,
    traffic: true,
    cutoffs: true,
  });

  function toggleSection(key: ResultSectionKey) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }

  const allOpen = Object.values(openSections).every(Boolean);

  function setAllSections(open: boolean) {
    setOpenSections({
      command: open,
      naming: open,
      schedule: open,
      amenities: open,
      splits: open,
      distribution: open,
      traffic: open,
      cutoffs: open,
    });
  }
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [renumber, setRenumber] = useState(true);
  const [renumberPrefix, setRenumberPrefix] = useState('Station');
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LoadedResults | null>(null);
  const [contestMapping, setContestMapping] = useState<Record<string, string>>({});
  const [kmlCourses, setKmlCourses] = useState<Course[]>([]);
  const [gpxFiles, setGpxFiles] = useState<LoadedGpx[]>([]);
  const [lvsFiles, setLvsFiles] = useState<LoadedGpx[]>([]);
  const [timedOverrides, setTimedOverrides] = useState<Record<string, boolean>>({});
  const [raceDate, setRaceDate] = useState('');

  /*
   * The courses the plan runs on, from both file types at once.
   *
   * A GPX carries elevation on every point but has no idea what a checkpoint is; a KML
   * carries the station layers, folders and cut-off labels but usually arrives with its
   * altitudes flattened. Neither can express the other's half, so a race is allowed to
   * supply routes from one, stations from the other, or everything from a single map.
   */
  const gpxCourses = useMemo(
    () =>
      gpxFiles.flatMap((file) => {
        try {
          return buildCourses(
            parseGpx(file.text).tracks.map((track) => ({
              name: /^Track \d+$/.test(track.name) ? file.fileName.replace(/\.gpx$/i, '') : track.name,
              folder: file.fileName,
              points: track.points,
            }))
          );
        } catch {
          // A file that will not parse is reported by the panel that loaded it; the
          // course list simply goes on without it.
          return [];
        }
      }),
    [gpxFiles]
  );
  /*
   * The elevation profile behind each course, keyed by the name the plan knows it as.
   *
   * Parsed here rather than in the panel that shows them, so the command view and the
   * file list read the same 4 MB parse instead of each doing their own.
   */
  const courseProfiles = useMemo(() => {
    const byName = new Map<string, CourseProfile>();
    for (const file of gpxFiles) {
      let tracks;
      try {
        tracks = parseGpx(file.text).tracks;
      } catch {
        continue;
      }
      for (const track of tracks) {
        const read = readCourseProfile(track, { fallbackName: file.fileName.replace(/\.gpx$/i, '') });
        byName.set(read.name, read);
      }
    }
    return byName;
  }, [gpxFiles]);

  const mergedCourses = useMemo(
    () => mergeCourseSources(kmlCourses, gpxCourses),
    [kmlCourses, gpxCourses]
  );
  const courses = mergedCourses.courses;

  /*
   * Each timing config matched to the course it describes, by the length it declares
   * against the length that course measures.
   *
   * Matched rather than named: the files come out of the timing program called
   * "Splits.lvs" as often as anything else, and a race that has been told its 100 km
   * config belongs to its 10 km course would name every station wrongly and look
   * confident doing it.
   */
  const [planTimedOnly, setPlanTimedOnly] = useState(true);

  const timingPointsByCourse = useMemo(() => {
    const byCourse: Record<string, TimingPoint[]> = {};
    for (const file of lvsFiles) {
      let points: TimingPoint[];
      try {
        points = parseTimingPoints(file.text).points;
      } catch {
        continue;
      }
      if (points.length === 0) continue;

      const declaredKm = points.reduce((far, p) => Math.max(far, p.kmFromStart), 0);
      let best: { name: string; gap: number } | null = null;
      for (const course of courses) {
        const gap = Math.abs(course.totalKm - declaredKm) / Math.max(course.totalKm, declaredKm);
        if (!best || gap < best.gap) best = { name: course.name, gap };
      }
      // The same bound the course merge uses: a drawn route and a surveyed one disagree
      // by a few percent, and trail distances advertise short.
      if (best && best.gap <= 0.08) byCourse[best.name] = points;
    }
    return byCourse;
  }, [lvsFiles, courses]);

  /** Whether any course was matched to a timing configuration at all. */
  const hasTimingConfig = Object.keys(timingPointsByCourse).length > 0;

  /*
   * Stations built from the timing configuration, for a race planned without a map.
   *
   * The route says where a kilometre is and the timing system says which kilometre, so a
   * mat's position is determined between them. Supplied alongside whatever the map holds
   * rather than instead of it — a card can have both, and a station drawn on the map and
   * read by a mat lands in the same place and merges.
   */
  const timingPlacemarks = useMemo(
    () =>
      timingStations(
        timingPointsByCourse,
        new Map(courses.map((c) => [c.name, c.vertices]))
      ),
    [timingPointsByCourse, courses]
  );

  /*
   * Keeps one form row per course, from whichever file the course arrived in.
   *
   * Rows are reconciled rather than rebuilt: a row already on screen keeps every figure
   * typed into it and only takes the course's measured length, so dropping in a route
   * GPX after an hour of editing start times does not throw that hour away.
   */
  useEffect(() => {
    setRows((current) => {
      const byName = new Map(current.map((row) => [row.courseName, row]));
      const lengthOf = new Map(courses.map((course) => [course.name, course.totalKm]));
      const next = courses.map((course) => {
        const existing = byName.get(course.name);
        return existing
          ? { ...existing, measuredKm: course.totalKm }
          : seedRow(course.name, course.totalKm);
      });

      // Distances added by hand are not courses and would otherwise be reconciled away.
      // They survive as long as the course they borrow still does.
      for (const row of current) {
        if (!row.sourceCourseName) continue;
        const km = lengthOf.get(row.sourceCourseName);
        if (km === undefined) continue;
        next.push({ ...row, measuredKm: km });
      }
      const unchanged =
        next.length === current.length && next.every((row, i) => row === current[i]);
      return unchanged ? current : next;
    });
  }, [courses]);
  const [stationOrder, setStationOrder] = useState<string[]>([]);
  const [amenityOverrides, setAmenityOverrides] = useState<Record<string, Partial<AmenitySet>>>({});
  const [amenities, setAmenities] = useState<Amenity[]>(DEFAULT_AMENITIES);
  const [raceName, setRaceName] = useState('');
  const [removedStations, setRemovedStations] = useState<string[]>([]);
  const [removedPasses, setRemovedPasses] = useState<string[]>([]);
  const [reportSections, setReportSections] = useState<ReportSections>(ALL_REPORT_SECTIONS);
  const [stationNotes, setStationNotes] = useState<Record<string, string>>({});
  const [raceOverrides, setRaceOverrides] = useState<RaceOverrides>(EMPTY_OVERRIDES);
  const [multisport, setMultisport] = useState<MultisportPlan | null>(null);
  const [skipNames, setSkipNames] = useState('');

  const [tabs, setTabs] = useState<{ id: string; label: string }[]>([{ id: 'race-1', label: 'Race 1' }]);
  const [activeTab, setActiveTab] = useState('race-1');
  const snapshotsRef = useRef(new Map<string, RaceSnapshot>());
  const raceFileRef = useRef<HTMLInputElement>(null);

  const liveLabel = raceName.trim() || kml?.fileName.replace(/\.kml$/i, '') || t('Untitled race');

  /**
   * A note belongs to the physical station, not to the row it was typed in, so editing
   * it anywhere updates every section — including the other passes of an out-and-back.
   */
  function changeStationNote(mapName: string, note: string) {
    setStationNotes((current) => {
      const next = { ...current };
      if (note) next[mapName] = note;
      else delete next[mapName];
      return next;
    });
  }

  /**
   * Edits live beside the computation, so applying one re-lays the whole override set
   * over the current result rather than mutating it — the model's value stays available
   * underneath and a revert costs nothing.
   */
  function editStation<K extends keyof StationOverride>(
    mapName: string,
    field: K,
    value: StationOverride[K] | undefined
  ) {
    setRaceOverrides((current) => {
      const next = setStationOverride(current, mapName, field, value);
      setResult((r) => (r ? applyRaceOverrides(r, next) : r));
      return next;
    });
  }

  function editCrossing<K extends keyof CrossingOverride>(
    key: string,
    field: K,
    value: CrossingOverride[K] | undefined
  ) {
    setRaceOverrides((current) => {
      const next = setCrossingOverride(current, key, field, value);
      setResult((r) => (r ? applyRaceOverrides(r, next) : r));
      return next;
    });
  }

  function captureSnapshot(): RaceSnapshot {
    return {
      kml, gpx: gpxFiles, lvs: lvsFiles, timedOverrides, raceDate, rows, folders, selectedFolders, settings, renumber, renumberPrefix, result,
      // The map's own courses, not the merged view — the GPX half is re-derived from its
      // own text on the way back in, so the two can never be saved out of step.
      results, contestMapping, courses: kmlCourses, stationOrder, amenityOverrides, amenities, raceName,
      removedStations, removedPasses, reportSections, stationNotes, raceOverrides,
      multisport, skipNames,
    };
  }

  function applySnapshot(snap: RaceSnapshot) {
    setKml(snap.kml);
    setRows(snap.rows);
    setFolders(snap.folders);
    setSelectedFolders(snap.selectedFolders);
    setSettings(snap.settings);
    setRenumber(snap.renumber);
    setRenumberPrefix(snap.renumberPrefix);
    setResult(snap.result);
    setResults(snap.results);
    setContestMapping(snap.contestMapping);
    setKmlCourses(snap.courses);
    setGpxFiles(snap.gpx ?? []);
    setLvsFiles(snap.lvs ?? []);
    setTimedOverrides(snap.timedOverrides ?? {});
    setRaceDate(snap.raceDate ?? '');
    setStationOrder(snap.stationOrder);
    setAmenityOverrides(snap.amenityOverrides);
    setAmenities(snap.amenities?.length ? snap.amenities : DEFAULT_AMENITIES);
    setRaceName(snap.raceName);
    setRemovedStations(snap.removedStations);
    setRemovedPasses(snap.removedPasses);
    setReportSections(snap.reportSections);
    setStationNotes(snap.stationNotes);
    setRaceOverrides(snap.raceOverrides ?? EMPTY_OVERRIDES);
    setMultisport(snap.multisport ?? null);
    setSkipNames(snap.skipNames ?? '');
    setError(null);
  }

  /** Parks the active race before anything replaces it on screen. */
  function parkActive() {
    snapshotsRef.current.set(activeTab, captureSnapshot());
    setTabs((list) => list.map((t) => (t.id === activeTab ? { ...t, label: liveLabel } : t)));
  }

  function switchTab(id: string) {
    if (id === activeTab) return;
    parkActive();
    applySnapshot(snapshotsRef.current.get(id) ?? blankSnapshot());
    setActiveTab(id);
  }

  function newTab(label = 'New race', snap?: RaceSnapshot) {
    parkActive();
    const id = `race-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    setTabs((list) => [...list, { id, label }]);
    applySnapshot(snap ?? blankSnapshot());
    setActiveTab(id);
  }

  function closeTab(id: string) {
    if (tabs.length <= 1) return;
    const label = id === activeTab ? liveLabel : tabs.find((t) => t.id === id)?.label;
    if (!window.confirm(`Close “${label}”? Anything not saved to a race file is lost.`)) return;

    const remaining = tabs.filter((t) => t.id !== id);
    snapshotsRef.current.delete(id);
    setTabs(remaining);
    if (id === activeTab) {
      const next = remaining[remaining.length - 1];
      applySnapshot(snapshotsRef.current.get(next.id) ?? blankSnapshot());
      setActiveTab(next.id);
    }
  }

  function saveRaceFile() {
    const snap = captureSnapshot();
    const body: Record<string, unknown> = {};
    for (const key of RACE_FILE_FIELDS) body[key] = snap[key];
    const file = {
      app: 'EnduranceMap',
      kind: 'race',
      version: RACE_FILE_VERSION,
      savedAt: new Date().toISOString(),
      label: liveLabel,
      snapshot: body,
    };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${liveLabel.replace(/[^\w\d -]+/g, '').trim() || 'race'}.race.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function openRaceFile(file: File | undefined) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.app !== 'EnduranceMap' || data?.kind !== 'race' || !data?.snapshot) {
        setError(`"${file.name}" is not an EnduranceMap race file.`);
        return;
      }
      if (typeof data.version === 'number' && data.version > RACE_FILE_VERSION) {
        setError(`"${file.name}" was saved by a newer version of EnduranceMap.`);
        return;
      }
      const saved = data.snapshot as Partial<RaceSnapshot>;
      const snap: RaceSnapshot = { ...blankSnapshot(), ...saved, result: null, courses: [], folders: [] };
      snap.amenityOverrides = migrateAmenityOverrides(snap.amenityOverrides);
      // Files written before multisport support have no discriminator on their results.
      if (snap.results && !('kind' in snap.results)) {
        const legacy = snap.results as { fileName: string; profiles: ContestProfile[] };
        snap.results = { kind: 'single', fileName: legacy.fileName, profiles: legacy.profiles };
      }
      // Courses and folders are re-derived from the saved KML text rather than trusted
      // from the file, so a hand-edited file cannot desync the two.
      if (snap.kml) {
        const parsed = parseKml(snap.kml.text);
        snap.courses = buildCourses(parsed.courses);
        snap.folders = listPlacemarkFolders(parsed.placemarks);
        // Leg bindings are re-checked against those courses for the same reason.
        if (snap.multisport) snap.multisport = autoBindCourses(snap.multisport, snap.courses);
      }
      newTab(data.label || file.name.replace(/\.race\.json$/i, ''), snap);
    } catch {
      setError(`Could not read "${file.name}" as a race file.`);
    }
  }

  function loadKml(text: string, fileName: string) {
    setError(null);
    setResult(null);
    try {
      const parsed = parseKml(text);
      const kmlOwn = buildCourses(parsed.courses);
      const detected = listPlacemarkFolders(parsed.placemarks);

      // A map holding only station layers is a normal thing to load, not a failure: the
      // routes come from the per-distance GPX every timing provider hands out, and a KML
      // is the only file that can express a station, a folder or a cut-off label at all.
      // Only a map with neither routes nor placemarks has nothing to offer.
      if (kmlOwn.length === 0 && parsed.placemarks.length === 0) {
        setKml(null);
        setFolders([]);
        setError(
          parsed.warnings[0] ??
            'That map holds no race routes and no placemarks. Expected a folder named ' +
              '"RACE ROUTE" holding one line per distance, or a layer of stations.'
        );
        return;
      }

      setKml({ text, fileName });
      setKmlCourses(kmlOwn);
      setFolders(detected);
      setSelectedFolders(defaultSelection(detected));
      const nextCourses = mergeCourseSources(kmlOwn, gpxCourses).courses;
      if (multisport) setMultisport(autoBindCourses(multisport, nextCourses));
      if (results?.kind === 'single') {
        setContestMapping(autoMapContests(results.profiles, nextCourses));
      }
    } catch (e) {
      setKml(null);
      setKmlCourses([]);
      setFolders([]);
      setError(e instanceof Error ? e.message : 'Could not parse that KML.');
    }
  }

  /** Courses whose arrivals come from the results file rather than the pace band. */
  const mappedCourses = useMemo(() => {
    const names = new Set<string>();
    if (results?.kind === 'single') {
      for (const profile of results.profiles) {
        const courseName = contestMapping[profile.contest];
        if (courseName && profile.samples.length > 0) names.add(courseName);
      }
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

  /** What stops a multisport plan being calculable, named leg by leg. */
  const planProblems = useMemo(
    () => (multisport ? validatePlan(multisport, courses) : []),
    [multisport, courses]
  );

  /** Anything that would keep the calculate button disabled, in either mode. */
  const blockers = multisport ? planProblems.map((p) => p.message) : [];
  /*
   * A race needs somewhere to put stations, from either source: a map layer that has been
   * ticked, or a timing configuration that already knows where its mats are. It no longer
   * needs a map at all — GPX plus LVS is a complete card for a race that cares about
   * timing, which is most trail races.
   */
  const hasStationSource = selectedFolders.length > 0 || timingPlacemarks.placemarks.length > 0;
  const cannotCalculate =
    !hasStationSource ||
    rows.length === 0 ||
    (multisport ? blockers.length > 0 : invalidRows.length > 0);

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
    if (results?.kind === 'single') applyProfilesToRows(results.profiles, mapping);
    if (results?.kind === 'multisport') applyMultisportProfiles(results.profiles, mapping);
  }

  /** Rewrites a race's leg bands from the reference field now driving it. */
  function applyMultisportProfiles(profiles: MultisportProfile[], mapping: Record<string, string>) {
    setMultisport((plan) => {
      if (!plan) return plan;
      const byRace = new Map(profiles.map((p) => [mapping[p.key], p]));

      return {
        races: plan.races.map((race) => {
          const profile = byRace.get(race.id);
          if (!profile || profile.legs.length !== race.legs.length) return race;
          const summary = summarizeMultisportProfile(profile);

          return {
            ...race,
            runnerCountText: String(profile.usable),
            legs: race.legs.map((leg, i) => {
              const { p1Seconds, p50Seconds, p99Seconds } = summary[i];
              const km = profile.legs[i].distanceKm;
              const band: MultisportLeg['band'] =
                leg.band.mode === 'pace' && km > 0
                  ? {
                      mode: 'pace',
                      fastestMinPerKm: Number((p1Seconds / 60 / km).toFixed(3)),
                      typicalMinPerKm: Number((p50Seconds / 60 / km).toFixed(3)),
                      slowestMinPerKm: Number((p99Seconds / 60 / km).toFixed(3)),
                    }
                  : {
                      mode: 'duration',
                      fastestMinutes: Number((p1Seconds / 60).toFixed(2)),
                      typicalMinutes: Number((p50Seconds / 60).toFixed(2)),
                      slowestMinutes: Number((p99Seconds / 60).toFixed(2)),
                    };
              return { ...leg, band };
            }),
          };
        }),
      };
    });
  }

  function clearResults() {
    setResults(null);
    setContestMapping({});
    setResult(null);
  }

  function loadResults(text: string, fileName: string) {
    setError(null);
    setResult(null);

    if (detectResultsFormat(text) === 'multisport') {
      const parsed = parseMultisportResultsCsv(text, { fileName });
      if (parsed.profiles.length === 0) {
        setError(parsed.warnings[0] ?? 'No usable races found in that results file.');
        return;
      }
      const mapping = autoMapMultisport(parsed.profiles, multisport);
      setResults({ kind: 'multisport', fileName, profiles: parsed.profiles });
      setContestMapping(mapping);
      applyMultisportProfiles(parsed.profiles, mapping);
      return;
    }

    const parsed = parseResultsCsv(text);
    if (parsed.profiles.length === 0) {
      setError(parsed.warnings[0] ?? 'No contests found in that results file.');
      return;
    }
    const mapping = autoMapContests(parsed.profiles, courses);
    setResults({ kind: 'single', fileName, profiles: parsed.profiles });
    setContestMapping(mapping);
    applyProfilesToRows(parsed.profiles, mapping);
  }

  /** Builds the report once, for whichever way the user chooses to take it away. */
  function renderReport(computed: PipelineResult, theme: 'light' | 'dark'): { html: string; fileName: string } {
    const name = raceName.trim() || kml?.fileName.replace(/\.kml$/i, '') || 'Race';
    const html = buildReportHtml(computed, {
      raceName: name,
      raceDate,
      theme,
      notes: stationNotes,
      sections: reportSections,
      rules: DEFAULT_AMENITY_RULES,
      overrides: amenityOverrides,
      amenities,
      sourceFileName: kml?.fileName,
      resultsFileName: results?.fileName,
    });
    const base = name.replace(/[^\w\d -]+/g, '').trim() || 'race';
    return {
      html,
      fileName: theme === 'dark' ? `${base} - CP operations (dark).html` : `${base} - CP operations.html`,
    };
  }

  /**
   * Switches between a single-sport race and a multisport one, starting the legs off
   * bound to whatever the map already holds.
   *
   * Multisport maps are usually festival maps — a 70.3 drawn alongside a sprint and a
   * kids race — and those events' turnarounds sit on the same roads, in the same
   * folders, close enough to merge into the stations being planned. The skip list is
   * therefore seeded with the events most often carried along, left visible and editable
   * rather than applied quietly. Planning one of those events instead is caught below.
   */
  function chooseFormat(template: MultisportTemplateKey | null) {
    if (!template) {
      setMultisport(null);
      return;
    }
    setMultisport(planFromCourses(template, courses));
    if (!skipNames.trim()) setSkipNames('Kids, Sprint');
    setResult(null);
  }

  /**
   * Catches a skip fragment that names the race being planned — seeding "Sprint" is
   * right on a 70.3 map and disastrous on a sprint one, and the difference is only
   * visible once a race has been named.
   */
  const selfSkips = useMemo(() => skipsNamingOwnRace(skipNames, multisport), [skipNames, multisport]);

  /**
   * Adds a second race to the same map — a 70.3 and a 140.6 usually share most of their
   * route. Only the new race is auto-bound, so adding one cannot reshuffle the legs of
   * a race the operator has already set up.
   */
  function addRace() {
    if (!multisport) return;
    const template = multisport.races[0]?.template ?? 'triathlon';
    const fresh = autoBindCourses(
      { races: [instantiateTemplate(template, `ms-${Date.now()}`)] },
      courses
    );
    setMultisport({ races: [...multisport.races, ...fresh.races] });
  }

  function removeRace(raceId: string) {
    if (!multisport) return;
    const races = multisport.races.filter((r) => r.id !== raceId);
    setMultisport(races.length > 0 ? { races } : null);
  }

  /**
   * Corrects how far a contest was.
   *
   * Pace was worked out by dividing finishing times by the distance, so restating it is
   * arithmetic rather than a reason to read the file again — and the result invalidates
   * the schedule, which is recalculated from the corrected numbers.
   */
  function changeContestDistance(contest: string, km: number) {
    if (!results || results.kind !== 'single') return;
    setResults({
      ...results,
      profiles: results.profiles.map((p) => (p.contest === contest ? withContestDistance(p, km) : p)),
    });
    setResult(null);
  }

  /**
   * Drops a contest the file carried but nobody is planning for.
   *
   * A timing export is a working document, not a start list: it holds pacers, chip
   * tests, staff entries and last year's leftovers. Each one otherwise sits in the table
   * demanding a distance before the rest of the panel will settle.
   */
  function removeContest(contest: string) {
    if (!results || results.kind !== 'single') return;
    setResults({ ...results, profiles: results.profiles.filter((p) => p.contest !== contest) });
    setContestMapping((current) => {
      const { [contest]: _dropped, ...rest } = current;
      return rest;
    });
    setResult(null);
  }

  function changeLegDistances(key: string, distancesKm: number[]) {
    if (!results || results.kind !== 'multisport') return;
    setResults({
      ...results,
      profiles: results.profiles.map((p) => (p.key === key ? withLegDistances(p, distancesKm) : p)),
    });
    setResult(null);
  }

  /*
   * The stations the plan is actually built on.
   *
   * Only the ones with a mat: a chip is read there and nowhere else, so every arrival
   * the rest of the tool reports is a real crossing rather than a pin someone dropped
   * near the route. A map's station layer collects points nobody is planning for —
   * unnamed markers, signage positions, last year's leftovers — and carrying them
   * through only pads the schedule with rows no crew is standing on.
   *
   * The review table above still lists every one of them, so a station wrongly left out
   * is one tick away from coming back.
   */
  const planned = useMemo(() => {
    if (!result) return null;
    // Without a timing configuration nothing has been matched to a mat, so nothing is
    // known to be untimed either — and a road race, where the water stations never carry
    // one, would be filtered down to nothing.
    if (!planTimedOnly || !hasTimingConfig) return result;
    return { ...result, stations: result.stations.filter((s) => s.isTimed) };
  }, [result, planTimedOnly, hasTimingConfig]);

  /**
   * Says whether a station really has a mat on it, against what the timing config implied.
   *
   * Applied to the result in place as well as remembered, because the answer changes what
   * the traffic at that station means — counted or modelled — and an operator correcting
   * it is usually looking straight at the number they are correcting.
   */
  /**
   * Renames every matched station to the column it produces in the results file.
   *
   * The two names serve different readers: a crew sheet wants "CP Topas Ecolodge" and a
   * results file wants "CP_TEL". An operator working against the timing export all day
   * would otherwise retype thirty of them.
   */
  function useResultNames() {
    if (!result) return;
    setRaceOverrides((current) => {
      let next = current;
      for (const station of result.stations) {
        if (!station.timingPointName) continue;
        next = setStationOverride(next, station.mapName, 'name', station.timingPointName);
      }
      setResult((r) => (r ? applyRaceOverrides(r, next) : r));
      return next;
    });
  }

  function toggleTimed(mapName: string) {
    const station = result?.stations.find((s) => s.mapName === mapName);
    if (!station) return;
    const next = !station.isTimed;

    setTimedOverrides((current) => ({ ...current, [mapName]: next }));
    setResult((r) =>
      r
        ? { ...r, stations: r.stations.map((s) => (s.mapName === mapName ? { ...s, isTimed: next } : s)) }
        : r
    );
  }

  function calculate(overrides?: { stations?: string[]; passes?: string[] }) {
    // A map is no longer required: routes can come from GPX and stations from the timing
    // configuration, which is every trail race that only cares about timing.
    if (!kml && timingPlacemarks.placemarks.length === 0) return;
    const excludeStations = overrides?.stations ?? removedStations;
    const excludePasses = overrides?.passes ?? removedPasses;
    setError(null);
    try {
      const samplesByCourse = new Map<string, ContestProfile['samples']>();
      const leadersByCourse = new Map<string, ContestProfile['leaders']>();
      if (results?.kind === 'single') {
        for (const profile of results.profiles) {
          const courseName = contestMapping[profile.contest];
          if (courseName && profile.samples.length > 0) samplesByCourse.set(courseName, profile.samples);
          if (courseName && profile.leaders.length > 0) leadersByCourse.set(courseName, profile.leaders);
        }
      }

      // A multisport profile drives a whole race; which routes its legs follow is
      // already settled by the plan, so the mapping stays one profile to one race.
      const profileByRaceId = new Map<string, MultisportProfile>();
      if (results?.kind === 'multisport') {
        for (const profile of results.profiles) {
          const raceId = contestMapping[profile.key];
          if (raceId && profile.athletes.length > 0) profileByRaceId.set(raceId, profile);
        }
      }

      // A multisport race is a sequence of legs rather than a set of distances, so its
      // inputs are built from the plan; everything downstream is the same either way.
      const built = multisport
        ? buildLegDistanceInputs(multisport, { courses, profileByRaceId })
        : { inputs: null, warnings: [] as string[] };

      const inputs: DistanceInput[] =
        built.inputs ??
        rows.map(({ runnerCountText, measuredKm, ...rest }) => {
          void measuredKm;
          // Spread rather than list the fields. Listing them silently dropped the day a
          // distance starts on the moment that was added, so a Friday 100 miles and a
          // Saturday 100 km were modelled on top of each other and nothing said so.
          return {
            ...rest,
            runnerCount: Number(runnerCountText),
            organizerCutoffClock: rest.organizerCutoffClock?.trim() || undefined,
            samples: samplesByCourse.get(rest.courseName),
            leaders: leadersByCourse.get(rest.courseName),
          };
        });

      const computed = runPipeline(kml?.text ?? '', inputs, {
          extraCourses: gpxCourses,
          timingPoints: timingPointsByCourse,
          extraPlacemarks: timingPlacemarks.placemarks,
          stationFolders: [...selectedFolders, TIMING_FOLDER],
          excludeStations,
          excludePasses,
          excludePlacemarkContaining: skipNames.split(',').map((f) => f.trim()).filter(Boolean),
          restrictCoursesFor: multisport
            ? buildCourseRestriction(multisport, detectPlacemarkLeg)
            : undefined,
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

      const ordered = {
        ...computed,
        warnings: [
          ...selfSkips.map(
            (fragment) =>
              `"${fragment}" is in the skip list and also names the race being planned — ` +
              `its own points are being left out. Clear it from step 2 if that is not what you want.`
          ),
          ...built.warnings,
          ...timingPlacemarks.warnings,
          ...computed.warnings,
        ],
        stations: applyStationOrder(computed.stations, stationOrder).map((station) =>
          station.mapName in timedOverrides
            ? { ...station, isTimed: timedOverrides[station.mapName] }
            : station
        ),
      };
      setResult(applyRaceOverrides(ordered, raceOverrides));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Calculation failed.');
    }
  }

  return (
    <div className="app">
      <div className="race-tabs">
        {tabs.map((t) => (
          <span key={t.id} className={t.id === activeTab ? 'race-tab active' : 'race-tab'}>
            <button className="race-tab-label" onClick={() => switchTab(t.id)}>
              {t.id === activeTab ? liveLabel : t.label}
            </button>
            {tabs.length > 1 && (
              <button className="race-tab-close" title="Close race" onClick={() => closeTab(t.id)}>
                ×
              </button>
            )}
          </span>
        ))}
        <button className="secondary" onClick={() => newTab()}>
          + {t('New race')}
        </button>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.5rem' }}>
          {/* Left of Save race: a small organiser working in Vietnamese should find the
              switch before they need anything else on this bar. */}
          <span className="lang-switch" role="group" aria-label="Language">
            {(['vi', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                className={`lang-option${lang === code ? ' is-on' : ''}`}
                aria-pressed={lang === code}
                onClick={() => setLang(code)}
                title={code === 'vi' ? 'Chuyển sang tiếng Việt' : 'Switch to English'}
              >
                {code === 'vi' ? 'VIE' : 'ENG'}
              </button>
            ))}
          </span>
          <button className="secondary" onClick={saveRaceFile} title={t('Save this race to a file on your machine')}>
            {t('Save race')}
          </button>
          <button
            className="secondary"
            onClick={() => raceFileRef.current?.click()}
            title="Open a saved .race.json file"
          >
            {t('Open…')}
          </button>
          <input
            ref={raceFileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              void openRaceFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </span>
      </div>

      <div className="masthead">
        <EnduranceMapLogo size={60} />
        <span className="powered-by-mark">
          <span className="powered-by-label">Powered by</span>
          <span className="chip masthead-chip">
            <img src="/sportstats-logo.png" alt="Sportstats" />
          </span>
        </span>
      </div>

      <header>
        <h1>{t('Race CP Operations Calculator')}</h1>
        <p>{t('Turn a course map into a checkpoint operating schedule.')}</p>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="card">
        <h2>
          <span className="step">1</span>{t('Course map')}
        </h2>
        <p className="hint">
          {t(
            'Choose an exported KML from Google My Maps, with each CP type on its own layer. Race routes can live in a layer here too, or come from the route files below.'
          )}
        </p>
        <KmlDropzone fileName={kml?.fileName} onLoad={loadKml} onError={setError} />
      </section>

      <section className="card">
        <h2>{t('Course profile')}</h2>
        <p className="hint">
          {t(
            'Drop the route GPX for each distance to read its climbing. A GPX carries elevation on every point; a KML usually loses it.'
          )}
        </p>
        <GpxPanel files={gpxFiles} onChange={setGpxFiles} />
        <h3 style={{ margin: '1.4rem 0 0.3rem', fontSize: '1rem' }}>{t('Timing points')}</h3>
        <p className="hint">
          {t(
            'Optional. Supply the timing configuration and every station takes the name the timing system uses, so nothing needs renaming on the map.'
          )}
        </p>
                <TimingPointsPanel files={lvsFiles} onChange={setLvsFiles} courses={courses} />
        {mergedCourses.replaced.map(({ kml: drawn, gpx: surveyed }) => (
          <p className="hint" key={drawn.name}>
            {`"${drawn.name}" (${drawn.totalKm.toFixed(2)} km) `}
            {t('from the map is covered by')}
            {` "${surveyed.name}" (${surveyed.totalKm.toFixed(2)} km) `}
            {t('from GPX, which carries elevation.')}
          </p>
        ))}
      </section>

      {rows.length > 0 && (
        <>
          <section className="card">
            <h2>
              <span className="step">2</span>{t('CP type')}
            </h2>
            <p className="hint">{t('Choose the layer that contains the type of CP you want to calculate.')}</p>
            <FolderPicker
              folders={folders}
              selected={selectedFolders}
              onChange={setSelectedFolders}
              renumber={renumber}
              renumberPrefix={renumberPrefix}
              onRenumberChange={setRenumber}
              onRenumberPrefixChange={setRenumberPrefix}
              skipNames={skipNames}
              onSkipNamesChange={setSkipNames}
            />
          </section>

          <section className="card">
            <h2>
              <span className="step">3</span>{t('Pace distribution')}
            </h2>
            <p className="hint">
              Optional. Choose a CSV finish-line result from a comparable race to replace the estimated pace
              band with the real field — every runner's own pace and start offset.
            </p>
            <ResultsPanel
              fileName={results?.kind === 'single' ? results.fileName : undefined}
              profiles={results?.kind === 'single' ? results.profiles : []}
              courses={courses}
              mapping={contestMapping}
              onLoad={loadResults}
              onMappingChange={changeContestMapping}
                onDistanceChange={changeContestDistance}
                onRemoveContest={removeContest}
              onClear={clearResults}
              onError={setError}
            />

            {results?.kind === 'multisport' && (
              <MultisportResultsPanel
                fileName={results.fileName}
                profiles={results.profiles}
                onDistanceChange={changeLegDistances}
                races={multisport?.races ?? []}
                mapping={contestMapping}
                onMappingChange={changeContestMapping}
                onClear={clearResults}
              />
            )}
          </section>

          <section className="card">
            <h2>
              <span className="step">4</span>{t('Race details and pace band')}
            </h2>
            <p className="hint">
              {multisport
                ? 'One row per leg. Set how long each takes and which drawn route it follows; the legs before a checkpoint decide how late it opens.'
                : mappedCourses.size > 0
                  ? `Start time and field size apply to every distance. Pace is taken from the results file for ${[...mappedCourses].join(', ')} — the band shown there is for reference only.`
                  : 'One row per distance, from the map or the route files. These stand in for a results CSV until you have one.'}
            </p>

            <div className="actions" style={{ marginBottom: '0.9rem' }}>
              <label className="inline-field">
                {t('Race date')}
                <input
                  type="date"
                  value={raceDate}
                  onChange={(e) => setRaceDate(e.target.value)}
                  title={t('The first day of the event — every time is then named by its weekday')}
                />
              </label>
              <span className="hint" style={{ margin: 0 }}>
                {raceDate
                  ? t('Times on later days are named by their weekday.')
                  : t('Optional. Without it, later days are counted as D+1, D+2.')}
              </span>
            </div>

            <RaceFormatPicker
              value={multisport?.races[0]?.template ?? null}
              onChange={chooseFormat}
            />

            {multisport ? (
              <MultisportPaceBandForm
                plan={multisport}
                courses={courses}
                onChange={setMultisport}
                problems={planProblems}
                onAddRace={addRace}
                onRemoveRace={removeRace}
              />
            ) : (
              <PaceBandForm
                rows={rows}
                onChange={setRows}
                drivenByResults={mappedCourses}
                raceDate={raceDate}
                courses={courses}
              />
            )}
          </section>

          <section className="card">
            <h2>
              <span className="step">5</span>{t('Operating details')}
            </h2>
            <SettingsPanel settings={settings} onChange={setSettings} />
          </section>

          <div className="actions" style={{ marginBottom: '1.75rem', justifyContent: 'center' }}>
            <button className="cta" onClick={() => calculate()} disabled={cannotCalculate}>
              {t('CALCULATE')}
            </button>
            {!hasStationSource && (
              <span className="hint" style={{ margin: 0 }}>
                Tick a map layer to schedule, or drop the timing configuration.
              </span>
            )}
            {multisport
              ? blockers.length > 0 && (
                  <span className="hint" style={{ margin: 0 }}>
                    {blockers.join(' ')}
                  </span>
                )
              : invalidRows.length > 0 && (
                  <span className="hint" style={{ margin: 0 }}>
                    Check {invalidRows.map((r) => r.courseName).join(', ')}: needs a start time, a runner count
                    above zero, and fastest ≤ typical ≤ slowest.
                  </span>
                )}
          </div>
        </>
      )}

      {result && planned && (
        <>
          <section className="card">
            <h2>{t('Export')}</h2>
            <p className="hint">
            {t(
              'One report in two finishes. The dark one keeps the brand theme, for reading on a screen or hosting behind a link; the print one is the same content ink-on-white for paper and email. Both are single self-contained files that open offline.'
            )}
          </p>
            <div className="folder-list" style={{ marginBottom: '1rem' }}>
              {REPORT_SECTIONS.map((section) => (
                <label
                  key={section.key}
                  className={reportSections[section.key] ? 'folder-item on' : 'folder-item'}
                  title={t(section.hint)}
                >
                  <input
                    type="checkbox"
                    checked={reportSections[section.key]}
                    onChange={(e) =>
                      setReportSections({ ...reportSections, [section.key]: e.target.checked })
                    }
                  />
                  <span className="folder-name">{t(section.label)}</span>
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
                  const { html, fileName } = renderReport(planned, 'dark');
                  downloadReport(html, fileName);
                }}
                disabled={!Object.values(reportSections).some(Boolean)}
                title="The same report in the brand's dark theme — for screens, and for hosting behind a link"
              >
                {t('Download dark report')}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  const { html, fileName } = renderReport(planned, 'light');
                  downloadReport(html, fileName);
                }}
                disabled={!Object.values(reportSections).some(Boolean)}
                title="Ink-on-white document for printing or emailing"
              >
                {t('Download print report')}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  const name = raceName.trim() || kml?.fileName.replace(/\.kml$/i, '') || 'Race';
                  const sheets = buildReportSheets(planned, {
                    raceName: name,
                    raceDate,
                    rules: DEFAULT_AMENITY_RULES,
                    overrides: amenityOverrides,
                    amenities,
                    notes: stationNotes,
                    sections: reportSections,
                  });
                  downloadXlsx(sheets, `${name.replace(/[^\w\d -]+/g, '').trim() || 'race'} - CP operations.xlsx`);
                }}
                disabled={!Object.values(reportSections).some(Boolean)}
                title="One sheet per section — opens in Excel, Numbers or Google Sheets"
              >
                {t('Download spreadsheet')}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  const name = raceName.trim() || kml?.fileName.replace(/\.kml$/i, '') || 'Race';
                  const html = buildCrewSheetsHtml(result, { raceName: name, t });
                  const base = name.replace(/[^\w\d -]+/g, '').trim() || 'race';
                  downloadReport(html, `${base} - crew sheets.html`);
                }}
                title={t('One A4 landscape page per station, ready to print and hand out')}
              >
                {t('Download crew sheets')}
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

          {/* One control for the whole of RESULT: five sections is a long scroll, and an
              organiser usually arrives wanting one of them. */}
          <div className="actions result-actions">
            <button className="secondary" onClick={() => setAllSections(!allOpen)}>
              {allOpen ? t('Collapse all sections') : t('Expand all sections')}
            </button>
          </div>

          <ResultSection
            title={t('Course profile')}
            summary={`${planned.stations.length} ${t('stations on course')}`}
            open={openSections.command}
            onToggle={() => toggleSection('command')}
          >
            <p className="hint">
              {t(
                'The climbs and the crews on one picture. Timed stations are solid and named; the ones with no mat are hollow — a chip is read at the first and not the second.'
              )}
            </p>
            <CourseCommandView result={planned} profiles={courseProfiles} />

            <h3 style={{ margin: '1.6rem 0 0.3rem', fontSize: '1rem' }}>{t('Where the field is')}</h3>
            <p className="hint">
              {t(
                'Slide to a moment and see every distance on the course at once, under the climbs they are on and beside the stations that serve them.'
              )}
            </p>
            <FieldSlider result={planned} profiles={courseProfiles} raceDate={raceDate} />
          </ResultSection>

{hasTimingConfig && (
          <ResultSection
            title={t('Station naming')}
            summary={`${result.stations.filter((s) => s.isTimed).length}/${result.stations.length} ${t('timed')}`}
            open={openSections.naming}
            onToggle={() => toggleSection('naming')}
          >
            <StationNamingTable
              result={result}
              filterToTimed={planTimedOnly}
              onFilterChange={setPlanTimedOnly}
              onUseResultNames={useResultNames}
              onToggleTimed={toggleTimed}
              overrides={raceOverrides}
              onStationEdit={editStation}
            />
          </ResultSection>
          )}

          <ResultSection
            title={t('Station operating schedule')}
            summary={`${planned.stations.length} stations`}
            open={openSections.schedule}
            onToggle={() => toggleSection('schedule')}
          >
            <p className="hint">
              {planned.stations.length} stations across {planned.courses.length} distances. Open is the first
              modeled arrival minus the setup buffer; close is the official cut-off where one exists, otherwise
              the last modeled arrival plus teardown. A station shared by several distances closes on the latest
              of them.
            </p>
            {countOverrides(raceOverrides) > 0 && (
              <div className="actions" style={{ marginBottom: '0.85rem' }}>
                <span className="hint" style={{ margin: 0 }}>
                  <strong>{countOverrides(raceOverrides)}</strong> value
                  {countOverrides(raceOverrides) === 1 ? '' : 's'} edited by hand — these survive a
                  recalculation and are saved with the race.
                </span>
                <button
                  className="secondary"
                  onClick={() => {
                    if (!window.confirm('Drop every hand edit and go back to the calculated plan?')) return;
                    setRaceOverrides(EMPTY_OVERRIDES);
                    calculate();
                  }}
                >
                  Reset to calculated
                </button>
              </div>
            )}
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
              stations={planned.stations}
              binMinutes={planned.binMinutes}
              raceDate={raceDate}
              showSourceNames={renumber}
              onReorder={(order) => {
                setStationOrder(order);
                setResult((current) =>
                  current ? { ...current, stations: applyStationOrder(current.stations, order) } : current
                );
              }}
              notes={stationNotes}
              onNoteChange={changeStationNote}
              overrides={raceOverrides}
              onStationEdit={editStation}
              onRemove={(mapName) => {
                const next = [...removedStations, mapName];
                setRemovedStations(next);
                calculate({ stations: next });
              }}
            />
          </ResultSection>

          <ResultSection
            title={t('Course amenities')}
            summary={`${planned.courses.length} distances`}
            open={openSections.amenities}
            onToggle={() => toggleSection('amenities')}
          >
            <p className="hint">
            {t(
              'The points a runner meets in order, with the gap from the previous one and what each one stocks — the view for spacing water and aid.'
            )}
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
            <AmenityEditor
              amenities={amenities}
              onChange={setAmenities}
              onReset={() => setAmenities(DEFAULT_AMENITIES)}
            />
            <DistanceRunView
              result={planned}
              rules={DEFAULT_AMENITY_RULES}
              amenities={amenities}
              overrides={amenityOverrides}
              onOverridesChange={setAmenityOverrides}
              notes={stationNotes}
              onNoteChange={changeStationNote}
              raceOverrides={raceOverrides}
              onCrossingEdit={editCrossing}
              onRemovePass={(key) => {
                const next = [...removedPasses, key];
                setRemovedPasses(next);
                calculate({ passes: next });
              }}
            />
          </ResultSection>

          <ResultSection
            title={t('Split calculation')}
            summary="Every point, by distance"
            open={openSections.splits}
            onToggle={() => toggleSection('splits')}
          >
            <p className="hint">
            {t(
              "Every point each distance runs through, with the kilometre it falls at on that distance's own route and the hours the position is staffed."
            )}
          </p>
            <TimingMatrix
              result={planned}
              notes={stationNotes}
              onNoteChange={changeStationNote}
              overrides={raceOverrides}
              onCrossingEdit={editCrossing}
            />
          </ResultSection>

          <ResultSection
            title={t('Crossing time distribution')}
            summary="The race day on one clock"
            open={openSections.distribution}
            onToggle={() => toggleSection('distribution')}
          >
            <p className="hint">
              Runner arrivals per {planned.binMinutes} minutes, stacked by distance, on one shared clock. Rows
              run in course order, so the field can be seen moving down the route. The cap marks each station’s
              busiest window.
            </p>
            <CrossingDistribution result={planned} />
          </ResultSection>

          <ResultSection
            title={t('Traffic at each station')}
            summary={`${planned.stations.length} stations, one page each`}
            open={openSections.traffic}
            onToggle={() => toggleSection('traffic')}
          >
            
            <StationTrafficList result={planned} colourFor={seriesVar} />
          </ResultSection>

          <ResultSection
            title={t('Cut-off times')}
            summary={`${planned.cutoffTable.length} proposals`}
            open={openSections.cutoffs}
            onToggle={() => toggleSection('cutoffs')}
          >
            <CutoffTable
              result={planned}
              graceMinutes={settings.cutoffGraceMinutes}
              overrides={raceOverrides}
              onCrossingEdit={editCrossing}
            />
          </ResultSection>


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
