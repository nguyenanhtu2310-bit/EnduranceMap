import { useT } from '../lib/i18n';

export interface Settings {
  setupBufferMinutes: number;
  teardownBufferMinutes: number;
  cutoffGraceMinutes: number;
  binMinutes: number;
  mediumRunnersPerHour: number;
  highRunnersPerHour: number;
}

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  /**
   * The two decisions that are neither a buffer nor a threshold, gathered here anyway.
   *
   * They used to sit in the sections they happen to affect — station numbering beside the
   * folder list, recorded crossings beside the results file — which is tidy by topic and
   * useless in practice: they are the two switches that most change what comes out, and
   * an organiser who misses one gets a plan that looks right and is not. Everything that
   * has to be checked before pressing Calculate is now checked in one place.
   */
  renumber: boolean;
  renumberPrefix: string;
  onRenumberChange: (renumber: boolean) => void;
  onRenumberPrefixChange: (prefix: string) => void;
  /** Only offered where a results file carrying real crossings has been loaded. */
  canUseRecorded?: boolean;
  useRecorded?: boolean;
  onUseRecordedChange?: (value: boolean) => void;
}

interface Field {
  key: keyof Settings;
  label: string;
  hint: string;
  step?: number;
  /**
   * Shown and typed as a count per counting window, though stored per hour.
   *
   * The stored figure has to stay hourly: it is the one number that must not move when
   * the bin width changes, or narrowing the window would silently reclassify every
   * station on the course. But every count on screen and in the report is per window,
   * and a threshold in a different unit to the figure it is compared against is a
   * threshold nobody can set with confidence.
   */
  perWindow?: boolean;
}

const FIELDS: Field[] = [
  { key: 'setupBufferMinutes', label: 'Setup buffer (min)', hint: 'Opens this long before the first arrival' },
  { key: 'teardownBufferMinutes', label: 'Teardown buffer (min)', hint: 'Stays open this long after the last' },
  {
    key: 'cutoffGraceMinutes',
    label: 'Cut-off grace (min)',
    hint: 'Added to the slowest arrival, then rounded up to five minutes',
  },
  { key: 'binMinutes', label: 'Histogram bin (min)', hint: 'Width of each arrival bucket' },
  {
    key: 'mediumRunnersPerHour',
    label: 'Medium at',
    hint: 'Runners through in the busiest window before a station is tagged Medium',
    step: 5,
    perWindow: true,
  },
  {
    key: 'highRunnersPerHour',
    label: 'High at',
    hint: 'Runners through in the busiest window before a station is tagged High',
    step: 5,
    perWindow: true,
  },
];

export function SettingsPanel({
  settings,
  onChange,
  renumber,
  renumberPrefix,
  onRenumberChange,
  onRenumberPrefixChange,
  canUseRecorded,
  useRecorded,
  onUseRecordedChange,
}: Props) {
  const t = useT();
  return (
    <>
      <div className="settings-grid">
        {FIELDS.map((field) => {
          const perHour = 60 / settings.binMinutes;
          const shown = field.perWindow
            ? Math.round(settings[field.key] / perHour)
            : settings[field.key];
          const label = field.perWindow
            ? `${t(field.label)} (/${settings.binMinutes} ${t('min')})`
            : t(field.label);

          return (
            <div key={field.key}>
              <label className="field" htmlFor={field.key} title={t(field.hint)}>
                {label}
              </label>
              <input
                id={field.key}
                type="number"
                min={0}
                step={field.step ?? 5}
                value={shown}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    [field.key]: field.perWindow
                      ? Number(e.target.value) * perHour
                      : Number(e.target.value),
                  })
                }
              />
            </div>
          );
        })}
      </div>
      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        {t(
          'Activity tags come from the busiest counting window at each station, the same figure the schedule and the report show. A mass-start road race and a trail race with a rolling start need very different numbers.'
        )}
      </p>

      <div className="setting-switches">
        <label className={renumber ? 'folder-item on' : 'folder-item'} style={{ flex: '0 1 auto' }}>
          <input type="checkbox" checked={renumber} onChange={(e) => onRenumberChange(e.target.checked)} />
          <span className="folder-name">{t('Number stations along the course')}</span>
        </label>
        {renumber && (
          <label className="field" style={{ margin: 0 }}>
            {t('Label')}
            <input
              type="text"
              value={renumberPrefix}
              placeholder="Station"
              onChange={(e) => onRenumberPrefixChange(e.target.value)}
              style={{ marginTop: '0.25rem' }}
            />
          </label>
        )}
      </div>
      <p className="hint" style={{ margin: '0.5rem 0 0' }}>
        {t(
          'Renames stations "Station 1" onward in course order. The map’s own names stay listed underneath so the numbering can be checked against the signs on the ground.'
        )}
      </p>

      {canUseRecorded && (
        <>
          <div className="setting-switches">
            <label className={useRecorded ? 'folder-item on' : 'folder-item'} style={{ flex: '0 1 auto' }}>
              <input
                type="checkbox"
                checked={!!useRecorded}
                onChange={(e) => onUseRecordedChange?.(e.target.checked)}
              />
              <span className="folder-name">{t('This file is this race — use its recorded crossings')}</span>
            </label>
          </div>
          <p className="hint" style={{ margin: '0.5rem 0 0' }}>
            {useRecorded
              ? t(
                  'Traffic at every mat in the file is counted from chip reads rather than modelled. Turn this off to plan a future race from the same file as a pace model.'
                )
              : t(
                  'The file is being used as a pace model only. Turn this on where it describes the race being reported.'
                )}
          </p>
        </>
      )}
    </>
  );
}
