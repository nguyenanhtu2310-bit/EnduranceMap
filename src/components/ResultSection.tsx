import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Shown beside the title when collapsed, so a shut section still says what it holds. */
  summary?: string;
  /** Anchor the navigation panel jumps to. */
  id?: string;
  /**
   * Takes this one section away on its own.
   *
   * The whole report is six sections and dozens of pages, and most of the time what
   * somebody needs to send is one of them — the schedule to the crew chiefs, the split
   * table to the timing provider. Doing that meant unticking five boxes in Export,
   * downloading, and ticking them back.
   */
  onExport?: (format: 'html' | 'xlsx') => void;
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
export function ResultSection({ title, summary, id, open, onToggle, onExport, children }: Props) {
  return (
    <section className="card result-section" id={id}>
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
      {/* Outside the toggle button, because a button inside a button is not a thing the
          browser will give you — the inner one never receives the click. */}
      {onExport && (
        <span className="section-export">
          <button
            type="button"
            className="secondary small-button"
            title={`Download just "${title}" as an HTML page`}
            onClick={() => onExport('html')}
          >
            HTML
          </button>
          <button
            type="button"
            className="secondary small-button"
            title={`Download just "${title}" as a spreadsheet`}
            onClick={() => onExport('xlsx')}
          >
            XLSX
          </button>
        </span>
      )}
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
