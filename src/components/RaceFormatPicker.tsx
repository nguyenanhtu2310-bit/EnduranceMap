import { MULTISPORT_TEMPLATES, type MultisportTemplateKey } from '../lib/multisport';

interface Props {
  /** Null is single sport — one route, one pace band, as the tool has always worked. */
  value: MultisportTemplateKey | null;
  onChange: (next: MultisportTemplateKey | null) => void;
}

const ORDER: MultisportTemplateKey[] = ['triathlon', 'duathlon', 'aquathlon'];

/**
 * Picks what kind of race is being planned. Switching away from a multisport format
 * throws the legs away, so it asks first — the same courtesy closing a race tab gets.
 */
export function RaceFormatPicker({ value, onChange }: Props) {
  function choose(next: MultisportTemplateKey | null) {
    if (next === value) return;
    if (value !== null && !window.confirm('Change the race format? The legs you set up are lost.')) return;
    onChange(next);
  }

  return (
    <div className="chart-legend" style={{ marginBottom: '0.9rem' }}>
      <button className={value === null ? undefined : 'secondary'} onClick={() => choose(null)}>
        Single sport
      </button>
      {ORDER.map((key) => (
        <button
          key={key}
          className={value === key ? undefined : 'secondary'}
          onClick={() => choose(key)}
        >
          {MULTISPORT_TEMPLATES[key].label}
        </button>
      ))}
    </div>
  );
}
