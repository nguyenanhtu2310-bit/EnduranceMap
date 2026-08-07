import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';

export interface NavItem {
  /** The element id this jumps to. */
  id: string;
  label: string;
  /**
   * Whether the section exists yet. A section that needs a file nobody has dropped is
   * shown but not offered, because hiding it would make the shape of the work change as
   * you go and leave an operator wondering what they missed.
   */
  ready: boolean;
  /** Short state — "6 distances", "not yet" — so the rail says where the work stands. */
  note?: string;
}

interface Props {
  request: NavItem[];
  result: NavItem[];
  /** Null before Calculate has been pressed, so RESULT reads as not there yet. */
  hasResult: boolean;
}

/**
 * Where everything is, in one rail.
 *
 * The app grew to thirteen sections down a single scroll, which is fine while you are
 * building it and hostile once you are using it: an organiser arrives wanting the station
 * schedule and has to recognise it going past. This says what the parts are, which of
 * them are ready, and takes you there.
 *
 * The two halves are named rather than merely spaced. REQUEST is what you tell the tool
 * and RESULT is what it works out, and every question about this app has turned out to be
 * a question about which side of that line something belongs on.
 */
export function NavPanel({ request, result, hasResult }: Props) {
  const t = useT();
  const [active, setActive] = useState<string | null>(null);

  // Highlights whichever section is nearest the top of the viewport, so the rail tracks
  // an ordinary scroll as well as a click.
  useEffect(() => {
    const ids = [...request, ...result].filter((i) => i.ready).map((i) => i.id);
    if (ids.length === 0) return;

    const onScroll = () => {
      let best: string | null = null;
      let bestTop = Infinity;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (!element) continue;
        const top = element.getBoundingClientRect().top;
        // Anything whose top has passed the header line is a candidate; the last one to
        // do so is the one being read.
        if (top <= 120 && Math.abs(top) < Math.abs(bestTop)) {
          bestTop = top;
          best = id;
        }
      }
      setActive(best);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [request, result]);

  function go(item: NavItem) {
    if (!item.ready) return;
    document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const group = (title: string, items: NavItem[], enabled: boolean) => (
    <div className={enabled ? 'nav-group' : 'nav-group waiting'}>
      <h3>{title}</h3>
      <ol>
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className={
                [
                  'nav-item',
                  item.ready && enabled ? '' : 'off',
                  active === item.id ? 'on' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
              onClick={() => go(item)}
              disabled={!item.ready || !enabled}
              title={item.ready ? item.label : t('Not available yet')}
            >
              <span className="nav-index">{index + 1}</span>
              <span className="nav-label">{item.label}</span>
              {item.note && <span className="nav-note">{item.note}</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );

  return (
    <nav className="nav-panel" aria-label={t('Sections')}>
      {group(t('REQUEST'), request, true)}
      {group(t('RESULT'), result, hasResult)}
      {!hasResult && <p className="nav-hint">{t('Press Calculate to build the plan.')}</p>}
    </nav>
  );
}
