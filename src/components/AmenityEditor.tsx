import { useState } from 'react';
import { AMENITY_ICONS, nextAmenityKey, type Amenity } from '../lib/amenities';

interface Props {
  amenities: Amenity[];
  onChange: (next: Amenity[]) => void;
  /** Restores the shipped list. */
  onReset: () => void;
}

/**
 * Renames the amenity columns and picks their icons.
 *
 * Every race provisions differently — gels at one, salt tablets and sponges at the next —
 * so the columns are the operator's to define. Keys never change with a label, so
 * renaming "Watermelon" to "Orange" keeps every station that already had it ticked.
 */
export function AmenityEditor({ amenities, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  function update(key: string, patch: Partial<Amenity>) {
    onChange(amenities.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  }

  function remove(key: string) {
    const amenity = amenities.find((a) => a.key === key);
    if (amenity && !window.confirm(`Remove the ${amenity.label} column from every station?`)) return;
    onChange(amenities.filter((a) => a.key !== key));
  }

  function add() {
    onChange([
      ...amenities,
      { key: nextAmenityKey(amenities), label: 'New item', icon: '⭐', group: 'station' },
    ]);
  }

  function move(key: string, by: number) {
    const from = amenities.findIndex((a) => a.key === key);
    const to = from + by;
    if (from < 0 || to < 0 || to >= amenities.length) return;
    const next = [...amenities];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  }

  if (!open) {
    return (
      <div className="sort-bar">
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          Edit columns
        </button>
        <span className="hint sort-note">
          Rename what each column stands for and pick its icon — every race stocks differently.
        </span>
      </div>
    );
  }

  return (
    <div className="amenity-editor">
      <div className="sort-bar">
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Done
        </button>
        <button type="button" className="secondary" onClick={add}>
          + Add a column
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (window.confirm('Restore the standard columns? Anything you renamed or added is lost.')) onReset();
          }}
        >
          Reset to standard
        </button>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th aria-label="Order" />
              <th>Icon</th>
              <th>Column name</th>
              <th>Group</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {amenities.map((amenity, i) => (
              <tr key={amenity.key}>
                <td className="drag-cell">
                  <button
                    type="button"
                    className="row-remove"
                    title="Move this column earlier"
                    disabled={i === 0}
                    onClick={() => move(amenity.key, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="row-remove"
                    title="Move this column later"
                    disabled={i === amenities.length - 1}
                    onClick={() => move(amenity.key, 1)}
                  >
                    ↓
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="amenity on icon-button"
                    title="Pick an icon"
                    onClick={() => setPicking(picking === amenity.key ? null : amenity.key)}
                  >
                    {amenity.icon}
                  </button>
                  {picking === amenity.key && (
                    <div className="icon-palette">
                      {AMENITY_ICONS.map((icon) => (
                        <button
                          key={icon}
                          type="button"
                          className={icon === amenity.icon ? 'amenity on' : 'amenity'}
                          onClick={() => {
                            update(amenity.key, { icon });
                            setPicking(null);
                          }}
                        >
                          {icon}
                        </button>
                      ))}
                      <input
                        type="text"
                        value={amenity.icon}
                        maxLength={4}
                        title="Or paste any emoji"
                        onChange={(e) => update(amenity.key, { icon: e.target.value })}
                      />
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="text"
                    value={amenity.label}
                    placeholder="Water"
                    onChange={(e) => update(amenity.key, { label: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={amenity.group}
                    onChange={(e) => update(amenity.key, { group: e.target.value as Amenity['group'] })}
                  >
                    <option value="station">Station</option>
                    <option value="medical">Medical</option>
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="row-remove"
                    title={`Remove ${amenity.label}`}
                    onClick={() => remove(amenity.key)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ margin: '0.7rem 0 0' }}>
        Renaming a column keeps whatever each station already had ticked, so changing
        "Watermelon" to "Orange" does not undo anyone's decisions. A column you add starts
        unticked everywhere until you set it.
      </p>
    </div>
  );
}
