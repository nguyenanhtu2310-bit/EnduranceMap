import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Shown beside the title when collapsed, so a shut section still says what it holds. */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * One section of the RESULT part, openable and shuttable.
 *
 * A finished plan runs to five sections and several hundred rows, and an organiser
 * arrives looking for one of them. Collapsing the rest turns a long scroll into a short
 * list — the headings stay put so the shape of the plan is still readable, which a
 * tabbed layout would lose.
 */
export function ResultSection({ title, summary, open, onToggle, children }: Props) {
  return (
    <section className="card result-section">
      <button
        type="button"
        className="section-toggle"
        aria-expanded={open}
        onClick={onToggle}
        title={open ? `Collapse ${title}` : `Expand ${title}`}
      >
        <span className="section-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <h2>{title}</h2>
        {!open && summary && <span className="section-summary muted small">{summary}</span>}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
