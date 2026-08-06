import type { PipelineResult } from '../lib/pipeline';
import { useT } from '../lib/i18n';

interface Props {
  result: PipelineResult;
  /** Flips whether a station is treated as having a mat on it. */
  onToggleTimed: (mapName: string) => void;
}

/** Anything past this is a match worth a second look before the plan is built on it. */
const LOOSE_MATCH_KM = 0.8;

/**
 * Which station is which, and which of them a chip is actually read at.
 *
 * Two things are being reviewed here and they fail differently. A wrong *name* is
 * cosmetic until someone radios "CP4" and two crews answer. A wrong *timed* flag is
 * worse: it decides whether this station's traffic is a count or a model, and a water
 * station quietly promoted to a timing point makes a modelled number look measured.
 *
 * So the match is shown with its distance rather than asserted — a pin that sat 0.02 km
 * from its mat and one that sat 0.79 km from it are not equally certain, and only the
 * operator standing on the ground can settle the second.
 */
export function StationNamingTable({ result, onToggleTimed }: Props) {
  const t = useT();
  const timed = result.stations.filter((s) => s.isTimed).length;

  if (result.stations.length === 0) {
    return <p className="hint">{t('No stations to review.')}</p>;
  }

  return (
    <>
      <p className="hint">
        {timed} {t('of')} {result.stations.length}{' '}
        {t(
          'stations have a timing mat. The rest are staffed the same way but nobody is counted at them, so their traffic is modelled rather than measured.'
        )}
      </p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('Station')}</th>
              <th>{t('Name on the map')}</th>
              <th>{t('Name in results')}</th>
              <th className="num">{t('Match')}</th>
              <th className="num">{t('Timed')}</th>
            </tr>
          </thead>
          <tbody>
            {result.stations.map((station) => {
              const loose =
                station.timingDeltaKm !== undefined && station.timingDeltaKm > LOOSE_MATCH_KM;
              const mapNames = station.sourceNames.join(' / ');
              return (
                <tr key={station.mapName}>
                  <td>
                    <span className="station-name">{station.schedule.name}</span>
                  </td>
                  <td className={mapNames === station.mapName ? undefined : 'muted'}>{mapNames}</td>
                  <td>
                    {station.timingPointName ? (
                      <code>{station.timingPointName}</code>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">
                    {station.timingDeltaKm === undefined ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className={loose ? 'tag Medium' : 'muted small'}>
                        {station.timingDeltaKm.toFixed(2)} km
                      </span>
                    )}
                  </td>
                  <td className="num">
                    <input
                      type="checkbox"
                      checked={station.isTimed}
                      aria-label={`${t('Timed')}: ${station.schedule.name}`}
                      onChange={() => onToggleTimed(station.mapName)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        {t(
          'Names come from the timing configuration where a mat was found within reach of the pin. Correct anything that looks wrong — a match measured further than 0.8 km is flagged, and only you can say whether a station really has a mat on it.'
        )}
      </p>
    </>
  );
}
