import type { AttritionReading } from '../lib/measuredSplits';
import { useT } from '../lib/i18n';

interface Props {
  readings: AttritionReading[];
}

/**
 * Who did not finish, and which stretch of course they were last seen on.
 *
 * The count is the least of it. That a 75 km lost 173 runners is a line for a report;
 * that 106 of them were last read at one checkpoint is a fact about a particular stretch
 * of trail, and it says where the sweep goes and where the casualties will come from.
 * Every results file already knows this and none of them have been asked.
 *
 * Where they stopped is not known — only where they were last counted. The distinction is
 * kept in the wording throughout ("last seen at", never "stopped at"), because the gap
 * between two mats on a real course runs to fourteen kilometres and a crew sent to the
 * wrong end of it is a crew in the wrong place.
 */
export function AttritionPanel({ readings }: Props) {
  const t = useT();
  const withRetirements = readings.filter((r) => r.retired > 0);
  if (withRetirements.length === 0) return null;

  return (
    <div className="attrition">
      <h4>{t('Who did not finish')}</h4>
      <p className="hint">
        {t(
          'Counted from the file, not modelled. Each bar is the runners last read at that checkpoint and never again — they left the course somewhere after it.'
        )}
      </p>

      {withRetirements.map((reading) => {
        const worst = [...reading.byLastSeen].sort((a, b) => b.count - a.count)[0];
        const share = reading.starters > 0 ? (reading.retired / reading.starters) * 100 : 0;
        const scale = Math.max(1, ...reading.byLastSeen.map((p) => p.count));

        return (
          <div className="attrition-contest" key={reading.contest}>
            <div className="attrition-head">
              <strong>{reading.contest}</strong>
              <span className="muted small">
                {reading.finishers.toLocaleString()} {t('finished')} ·{' '}
                <b className="attrition-count">{reading.retired.toLocaleString()}</b>{' '}
                {t('did not')} ({share.toFixed(0)}%) {t('of')}{' '}
                {reading.starters.toLocaleString()} {t('starters')}
              </span>
              <span
                className={reading.basis === 'stated' ? 'tag counted' : 'tag'}
                title={
                  reading.basis === 'stated'
                    ? t('The file states each of these, adjudicated by the timing team')
                    : t('Worked out from a missing finish time, because the file states no status')
                }
              >
                {reading.basis === 'stated' ? t('stated by the file') : t('worked out')}
              </span>
            </div>

            {reading.byLastSeen.length > 0 && (
              <table className="attrition-table">
                <thead>
                  <tr>
                    <th>{t('Last seen at')}</th>
                    <th className="num">{t('Retirements')}</th>
                    <th aria-label={t('Share')} />
                  </tr>
                </thead>
                <tbody>
                  {reading.byLastSeen.map((point) => (
                    <tr
                      key={point.lastSeen ?? 'start'}
                      className={point === worst && reading.byLastSeen.length > 1 ? 'worst' : undefined}
                    >
                      <td>{point.lastSeen ?? t('the start, and no checkpoint after')}</td>
                      <td className="num">{point.count.toLocaleString()}</td>
                      <td className="attrition-bar">
                        <span style={{ width: `${(point.count / scale) * 100}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Stated rather than left to be discovered: every one of these makes the
                number above read differently, and none of them are visible in the file. */}
            {reading.caveats.map((caveat) => (
              <p className="hint attrition-caveat" key={caveat}>
                {caveat}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
