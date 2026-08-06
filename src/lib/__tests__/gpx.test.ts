import { describe, expect, it } from 'vitest';
import { describeTrack, parseGpx } from '../gpx';

const wrap = (body: string, attrs = 'creator="test" version="1.1"') =>
  `<?xml version="1.0" encoding="utf-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" ${attrs}>${body}</gpx>`;

describe('parseGpx', () => {
  it('reads trackpoints with elevation', () => {
    const gpx = wrap(
      `<trk><name>100K</name><trkseg>
        <trkpt lat="22.3" lon="103.8"><ele>1501.0</ele></trkpt>
        <trkpt lat="22.31" lon="103.81"><ele>1520.5</ele></trkpt>
      </trkseg></trk>`
    );
    const result = parseGpx(gpx);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].name).toBe('100K');
    expect(result.tracks[0].points).toEqual([
      { lat: 22.3, lon: 103.8, ele: 1501.0 },
      { lat: 22.31, lon: 103.81, ele: 1520.5 },
    ]);
  });

  it('leaves elevation undefined rather than zero when a point has none', () => {
    // Zero is a real altitude. A course whose points all read 0 must be reported as
    // having no profile, not as running along the coast.
    const gpx = wrap(
      `<trk><trkseg>
        <trkpt lat="22.3" lon="103.8"></trkpt>
        <trkpt lat="22.31" lon="103.81"></trkpt>
      </trkseg></trk>`
    );
    const points = parseGpx(gpx).tracks[0].points;
    expect(points[0].ele).toBeUndefined();
    expect(describeTrack({ name: 't', points }).elevationCoverage).toBe(0);
  });

  it('joins segments within one track', () => {
    // A <trkseg> break is a pause in recording, not a break in the course.
    const gpx = wrap(
      `<trk><trkseg>
        <trkpt lat="22.3" lon="103.8"><ele>1</ele></trkpt>
        <trkpt lat="22.31" lon="103.8"><ele>2</ele></trkpt>
      </trkseg><trkseg>
        <trkpt lat="22.32" lon="103.8"><ele>3</ele></trkpt>
      </trkseg></trk>`
    );
    const result = parseGpx(gpx);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].points).toHaveLength(3);
  });

  it('keeps separate tracks separate', () => {
    const gpx = wrap(
      `<trk><name>A</name><trkseg>
        <trkpt lat="22.3" lon="103.8"/><trkpt lat="22.31" lon="103.8"/>
      </trkseg></trk>
      <trk><name>B</name><trkseg>
        <trkpt lat="22.4" lon="103.9"/><trkpt lat="22.41" lon="103.9"/>
      </trkseg></trk>`
    );
    expect(parseGpx(gpx).tracks.map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('reads waypoints and the creator attribute', () => {
    const gpx = wrap(
      `<wpt lat="22.3" lon="103.8"><name>CP3</name><ele>1738</ele></wpt>
       <trk><trkseg><trkpt lat="22.3" lon="103.8"/><trkpt lat="22.31" lon="103.8"/></trkseg></trk>`,
      'creator="Garmin Connect" version="1.1"'
    );
    const result = parseGpx(gpx);
    expect(result.creator).toBe('Garmin Connect');
    expect(result.waypoints).toEqual([{ name: 'CP3', coord: { lat: 22.3, lon: 103.8, ele: 1738 } }]);
  });

  it('reads GPX 1.0 as readily as 1.1', () => {
    const gpx =
      `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/0" version="1.0" ` +
      `creator="race result AG"><trk><trkseg>` +
      `<trkpt lat="22.33515" lon="103.84122"><ele>1501.0</ele></trkpt>` +
      `<trkpt lat="22.33514" lon="103.84121"><ele>1501.0</ele></trkpt>` +
      `</trkseg></trk></gpx>`;
    expect(parseGpx(gpx).tracks[0].points).toHaveLength(2);
  });

  it('tolerates the stray ">" a real timing export writes after every point', () => {
    // Every trackpoint in the supplied VMM files is followed by "</trkpt>>". A bare ">"
    // is legal in XML character data, so this parses — but it must keep parsing.
    const gpx =
      `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/0" version="1.0"><trk><trkseg>` +
      `<trkpt lat="22.3" lon="103.8"><ele>1492.7</ele></trkpt>>` +
      `<trkpt lat="22.31" lon="103.81"><ele>1492.6</ele></trkpt>>` +
      `</trkseg></trk></gpx>`;
    const points = parseGpx(gpx).tracks[0].points;
    expect(points).toHaveLength(2);
    expect(points[1].ele).toBe(1492.6);
  });

  it('reads timestamps where a recording carries them', () => {
    const gpx = wrap(
      `<trk><trkseg>
        <trkpt lat="22.3" lon="103.8"><ele>1</ele><time>2024-09-20T04:00:00Z</time></trkpt>
        <trkpt lat="22.31" lon="103.8"><ele>2</ele><time>2024-09-20T04:00:30Z</time></trkpt>
      </trkseg></trk>`
    );
    const points = parseGpx(gpx).tracks[0].points;
    expect(points[1].timeSeconds! - points[0].timeSeconds!).toBe(30);
    expect(describeTrack({ name: 't', points }).hasTimestamps).toBe(true);
  });

  it('warns rather than throws on an empty file', () => {
    const result = parseGpx('   ');
    expect(result.tracks).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/empty/i);
  });

  it('names a failed download for what it is', () => {
    // Four of the route files supplied to this tool were sixteen bytes of placeholder
    // from an export that had failed. "Text data outside of root node" sends someone
    // hunting a parser bug; naming the real problem sends them to re-download.
    expect(() => parseGpx('################')).toThrow(/not a GPX file/i);
    expect(() => parseGpx('################')).toThrow(/16 bytes/);
    expect(() => parseGpx('################')).toThrow(/exporting it again/);
  });

  it('warns when a file has no tracks at all', () => {
    expect(parseGpx(wrap('')).warnings[0]).toMatch(/no tracks/i);
  });

  it('skips a track with fewer than two points, naming it', () => {
    const gpx = wrap(`<trk><name>Stub</name><trkseg><trkpt lat="22.3" lon="103.8"/></trkseg></trk>`);
    const result = parseGpx(gpx);
    expect(result.tracks).toHaveLength(0);
    expect(result.warnings[0]).toContain('Stub');
  });

  it('throws on a file that is not GPX', () => {
    expect(() => parseGpx('<?xml version="1.0"?><kml><Document/></kml>')).toThrow(/not a gpx/i);
  });
});

describe('describeTrack', () => {
  it('reports partial elevation coverage', () => {
    // The 100-mile track inside the supplied KML had kept elevation on 1.6% of its
    // points, which looked like a working file until the numbers came out wrong.
    const points = [
      { lat: 22.3, lon: 103.8, ele: 1000 },
      { lat: 22.31, lon: 103.8 },
      { lat: 22.32, lon: 103.8 },
      { lat: 22.33, lon: 103.8 },
    ];
    expect(describeTrack({ name: 't', points }).elevationCoverage).toBe(0.25);
  });
});
