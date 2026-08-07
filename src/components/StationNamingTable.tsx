import type { PipelineResult } from '../lib/pipeline';
import type { CrossingOverride, RaceOverrides, StationOverride } from '../lib/overrides';
import { EditableCell } from './EditableCell';
import { CutoffStack } from './CutoffStack';
import { useT } from '../lib/i18n';

interface Props {
  result: PipelineResult;
  /** Flips whether a station is treated as having a mat on it. */
  onToggleTimed: (mapName: string) => void;
  /** True when only timed stations are being carried into the rest of the plan. */
  filterToTimed: boolean;
  onFilterChange: (only: boolean) => void;
  /** Renames every matched station to the column it produces in the results file. */
  onUseResultNames: () => void;
  /** Names the operator has typed over the computed ones. */
  overrides: RaceOverrides;
  onStationEdit: <K extends keyof StationOverride>(
    mapName: string,
    field: K,
    value: StationOverride[K] | undefined
  ) => void;
  /** The event's first date, so a cut-off's day can be named rather than counted. */
  raceDate?: string;
  /** Sets the cut-off for one distance's pass through one station. */
  onCrossingEdit?: <K extends keyof CrossingOverride>(
    key: string,
    field: K,
    value: CrossingOverride[K] | undefined
  ) => void;
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
export function StationNamingTable({
  result,
  filterToTimed,
  onFilterChange,
  onUseResultNames,
  onToggleTimed,
  overrides,
  onStationEdit,
  raceDate,
  onCrossingEdit,
}: Props) {
  const t = useT();
  const timed = result.stations.filter((s) => s.isTimed).length;

  if (result.stations.length === 0) {
    return <p className="hint">{t('No stations to review.')}</p>;
  }

  return (
    <>
      <label className="inline-field" style={{ marginBottom: '0.5rem' }}>
        <input
          type="checkbox"
          checked={filterToTimed}
          onChange={(e) => onFilterChange(e.target.checked)}
        />
        {t('Plan only the stations with a timing mat')}
      </label>
      <p className="hint">
        {timed} {t('of')} {result.stations.length}{' '}
        {filterToTimed
          ? t('stations have a mat. Only these carry through — untick one and it leaves every section below.')
          : t('stations have a mat. Every station is being planned, timed or not.')}
      </p>

      <div className="actions" style={{ marginBottom: '0.6rem' }}>
        <button className="secondary" onClick={onUseResultNames} disabled={timed === 0}>
          {t('Use RACERESULT names for all')}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {t('Renames every matched station to the column it produces in the results file.')}
        </span>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('Station')}</th>
              <th>{t('Name on the map')}</th>
              <th>{t('Name in RACERESULT')}</th>
              <th className="num">{t('Match')}</th>
              <th className="num">{t('Timed')}</th>
              {onCrossingEdit && <th>{t('Cut-off here')}</th>}
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
                    <EditableCell
                      computed={station.schedule.name}
                      override={overrides.stations?.[station.mapName]?.name}
                      type="text"
                      title={t('Station name')}
                      onChange={(value) => onStationEdit(station.mapName, 'name', value)}
                    />
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
                  {/*
                    One field per distance that passes here, not one per station. A real
                    card closes the same checkpoint at two different times for two groups
                    — CP3 at eleven for the 70 km and at eight in the evening for the
                    ultras — and both are real: the shorter field has to be through by
                    one, and the crew stands until the other.
                  */}
                  {onCrossingEdit && (
                    <td>
                      <CutoffStack
                        station={station}
                        overrides={overrides}
                        raceDate={raceDate}
                        onCrossingEdit={onCrossingEdit}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ margin: '0.85rem 0 0' }}>
        {t(
          'Names come from the timing configuration where a mat was found within reach of the pin, and can be typed over. A match measured further than 0.8 km is flagged for a second look.'
        )}
      </p>
    </>
  );
}
