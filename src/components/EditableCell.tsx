interface Props<T extends string | number> {
  /** What the model computed — shown when nothing has been edited. */
  computed: T;
  /** The hand edit, if there is one. */
  override?: T;
  type: 'text' | 'time' | 'number';
  onChange: (value: T | undefined) => void;
  /** Formats the computed value for display in the input. */
  format?: (value: T) => string;
  step?: number;
  align?: 'left' | 'right';
  title?: string;
}

/**
 * A computed value that can be typed over. The input always shows the effective value,
 * so a reader sees the plan rather than a mix of filled and empty boxes; an edited cell
 * is marked and carries a revert control, because the point of separating edits from
 * the computation is being able to get back to it.
 */
export function EditableCell<T extends string | number>({
  computed,
  override,
  type,
  onChange,
  format,
  step,
  align = 'left',
  title,
}: Props<T>) {
  const edited = override !== undefined && override !== ('' as T);
  const value = edited ? override : computed;
  const display = format && !edited ? format(computed) : String(value ?? '');

  return (
    <span className={edited ? 'editable edited' : 'editable'}>
      <input
        type={type}
        value={display}
        step={step}
        style={{ textAlign: align }}
        title={edited ? `${title ?? 'Edited'} — model says ${format ? format(computed) : computed}` : title}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          onChange((type === 'number' ? Number(raw) : raw) as T);
        }}
      />
      {edited && (
        <button
          type="button"
          className="revert"
          title={`Revert to ${format ? format(computed) : computed}`}
          onClick={() => onChange(undefined)}
        >
          ↺
        </button>
      )}
    </span>
  );
}
