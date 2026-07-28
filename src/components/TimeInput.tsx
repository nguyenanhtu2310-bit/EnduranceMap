import { useState } from 'react';
import { maskClockInput, normalizeClockTime } from '../lib/time';

interface Props {
  value: string;
  onChange: (value: string) => void;
  title?: string;
  align?: 'left' | 'right';
  placeholder?: string;
}

/**
 * A clock time in 24-hour form, always.
 *
 * The native time input renders in the browser's locale, so an operator working in
 * 24-hour time is shown "04:00 AM" and no HTML attribute changes it. This is a plain text
 * field with the colon inserted as digits are typed.
 *
 * What is typed is held locally until the field is left, so a half-finished "07" never
 * reaches the schedule as though it were a time. On leaving, a readable entry settles
 * into HH:MM and anything unreadable is discarded, putting the field back as it was.
 */
export function TimeInput({ value, onChange, title, align = 'left', placeholder = 'HH:MM' }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={5}
      placeholder={placeholder}
      value={draft ?? value}
      style={{ textAlign: align }}
      title={title}
      onChange={(e) => setDraft(maskClockInput(e.target.value))}
      onBlur={() => {
        if (draft === null) return;
        const typed = draft;
        setDraft(null);
        if (typed.trim() === '') {
          onChange('');
          return;
        }
        const settled = normalizeClockTime(typed);
        if (settled) onChange(settled);
      }}
    />
  );
}
