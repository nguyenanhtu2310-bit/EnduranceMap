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
    hint: 'Added to the slowest arrival before rounding up to the quarter hour',
  },
  { key: 'binMinutes', label: 'Histogram bin (min)', hint: 'Width of each arrival bucket' },
  { key: 'mediumRunnersPerHour', label: 'Medium at (/hr)', hint: 'Peak load to tag Medium', step: 10 },
  { key: 'highRunnersPerHour', label: 'High at (/hr)', hint: 'Peak load to tag High', step: 10 },
];

export function SettingsPanel({ settings, onChange }: Props) {
  return (
    <>
      <div className="settings-grid">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label className="field" htmlFor={field.key} title={field.hint}>
              {field.label}
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
        Activity thresholds are per-station peak crossings per hour. A mass city race puts thousands per hour
        through its early stations, so raise these well above trail-race levels or everything reads High.
      </p>
    </>
  );
}
