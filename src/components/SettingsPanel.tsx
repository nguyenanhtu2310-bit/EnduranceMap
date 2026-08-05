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

export function SettingsPanel({ settings, onChange }: Props) {
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
    </>
  );
}
