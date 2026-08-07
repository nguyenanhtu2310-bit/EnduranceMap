import type { FolderSummary } from '../lib/pipeline';
import { useT } from '../lib/i18n';

interface Props {
  folders: FolderSummary[];
  selected: string[];
  onChange: (selected: string[]) => void;
  renumber: boolean;
  renumberPrefix: string;
  onRenumberChange: (renumber: boolean) => void;
  onRenumberPrefixChange: (prefix: string) => void;
}

export function FolderPicker({
  folders,
  selected,
  onChange,
  renumber,
  renumberPrefix,
  onRenumberChange,
  onRenumberPrefixChange,
}: Props) {
  const t = useT();
  function toggle(folder: string) {
    onChange(selected.includes(folder) ? selected.filter((f) => f !== folder) : [...selected, folder]);
  }

  const total = folders
    .filter((f) => selected.includes(f.folder))
    .reduce((sum, f) => sum + f.placemarkCount, 0);

  return (
    <>
      <div className="folder-list">
        {folders.map((f) => (
          <label key={f.folder} className={selected.includes(f.folder) ? 'folder-item on' : 'folder-item'}>
            <input type="checkbox" checked={selected.includes(f.folder)} onChange={() => toggle(f.folder)} />
            <span className="folder-name">{f.folder}</span>
            <span className="folder-count">{f.placemarkCount}</span>
          </label>
        ))}
      </div>
      <div className="actions" style={{ marginTop: '0.85rem' }}>
        <span className="hint" style={{ margin: 0 }}>
          {total} placemark{total === 1 ? '' : 's'} selected.
        </span>
        <button className="secondary" onClick={() => onChange(folders.map((f) => f.folder))}>
          Select all
        </button>
        <button className="secondary" onClick={() => onChange([])}>
          Clear
        </button>
      </div>
      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        {t(
          'Only the folders you tick get scheduled. Cut-off times are still read from the whole map, so a station that shares a spot with a cut-off point keeps that closing time even when the cut-off folder is unticked.'
        )}
      </p>

      <div className="renumber-row">
        <label className={renumber ? 'folder-item on' : 'folder-item'} style={{ flex: '0 1 auto' }}>
          <input type="checkbox" checked={renumber} onChange={(e) => onRenumberChange(e.target.checked)} />
          <span className="folder-name">{t('Number stations along the course')}</span>
        </label>
        {renumber && (
          <label className="field" style={{ margin: 0 }}>
            Label
            <input
              type="text"
              value={renumberPrefix}
              onChange={(e) => onRenumberPrefixChange(e.target.value)}
              style={{ width: 130, marginTop: '0.25rem' }}
            />
          </label>
        )}
      </div>
      <p className="hint" style={{ margin: '0.5rem 0 0' }}>
        Renames stations “{renumberPrefix || 'Station'} 1” onward in course order. The map’s own names stay
        listed underneath so the numbering can be checked against the signs on the ground.
      </p>
    </>
  );
}
