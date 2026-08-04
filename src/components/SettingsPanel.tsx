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

const FIELDS: { key: keyof Settings; label: string; hint: string; step?: number }[] = [
  { key: 'setupBufferMinutes', label: 'Setup buffer (min)', hint: 'Opens this long before the first arrival' },
  { key: 'teardownBufferMinutes', label: 'Teardown buffer (min)', hint: 'Stays open this long after the last' },
  {
    key: 'cutoffGraceMinutes',
    label: 'Cut-off grace (min)',
    hint: 'Added to the slowest arrival, then rounded up to five minutes',
  },
  { key: 'binMinutes', label: 'Histogram bin (min)', hint: 'Width of each arrival bucket' },
  // Thresholds stay hourly on purpose: they are the one figure that must not move when
  // the bin width changes, or narrowing the window would silently reclassify every point.
  {
    key: 'mediumRunnersPerHour',
    label: 'Medium at (/hr)',
    hint: 'Peak load to tag Medium, as an hourly rate whatever the bin',
    step: 10,
  },
  {
    key: 'highRunnersPerHour',
    label: 'High at (/hr)',
    hint: 'Peak load to tag High, as an hourly rate whatever the bin',
    step: 10,
  },
];

export function SettingsPanel({ settings, onChange }: Props) {
  const t = useT();
  return (
    <>
      <div className="settings-grid">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label className="field" htmlFor={field.key} title={t(field.hint)}>
              {t(field.label)}
            </label>
            <input
              id={field.key}
              type="number"
              min={0}
              step={field.step ?? 5}
              value={settings[field.key]}
              onChange={(e) => onChange({ ...settings, [field.key]: Number(e.target.value) })}
            />
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
            {t(
              'Activity thresholds are per-station peak crossings per hour. A mass-start road race and a trail race with a rolling start need very different numbers.'
            )}
          </p>
    </>
  );
}
