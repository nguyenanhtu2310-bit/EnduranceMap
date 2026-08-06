import { useMemo, useRef, useState } from 'react';
import { parseGpx } from '../lib/gpx';
import { readCourseProfile, type CourseProfile } from '../lib/courseProfile';
import { CourseProfileView } from './CourseProfileView';
import { useT } from '../lib/i18n';

/** A race file as loaded, kept as text so a saved race can be reopened from it. */
export interface LoadedGpx {
  fileName: string;
  text: string;
}

interface ReadFile {
  fileName: string;
  courses: CourseProfile[];
  warnings: string[];
  error?: string;
}

interface Props {
  files: LoadedGpx[];
  onChange: (files: LoadedGpx[]) => void;
}

/**
 * Route files, dropped in as many at a time as a race has distances.
 *
 * One file per distance is how every timing provider and race website hands courses out,
 * so taking six at once is taking the native shape rather than asking anyone to merge
 * them first — and a merge is exactly where the elevation was lost on the files this was
 * built against.
 *
 * A file that fails is reported beside the ones that worked rather than stopping the
 * batch, because the failures come in ones and twos out of a set of six.
 */
export function GpxPanel({ files, onChange }: Props) {
  const t = useT();
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * Read once per set of files rather than on every render. These are 4 MB and 65,699
   * points each, and re-parsing six of them because a slider moved elsewhere on the page
   * would stall the tab for half a minute.
   */
  const read = useMemo<ReadFile[]>(() => {
    const out = files.map((file) => {
      try {
        const parsed = parseGpx(file.text);
        return {
          fileName: file.fileName,
          courses: parsed.tracks.map((track) =>
            readCourseProfile(track, { fallbackName: file.fileName.replace(/\.gpx$/i, '') })
          ),
          warnings: parsed.warnings,
        };
      } catch (e) {
        return {
          fileName: file.fileName,
          courses: [],
          warnings: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });
    // Longest first, matching how every other list in the tool is read down.
    out.sort((a, b) => (b.courses[0]?.totalKm ?? 0) - (a.courses[0]?.totalKm ?? 0));
    return out;
  }, [files]);

  async function accept(list: FileList | null | undefined) {
    if (!list || list.length === 0) return;
    const loaded: LoadedGpx[] = [];
    for (const file of Array.from(list)) {
      // Anything that is not a route file is turned away here rather than carried in to
      // fail later, so the course list never holds a file the panel calls unreadable.
      if (!/\.gpx$/i.test(file.name)) continue;
      loaded.push({ fileName: file.name, text: await file.text() });
    }
    onChange(loaded);
  }

  return (
    <div className="gpx-panel">
      <div
        className={isOver ? 'drop over' : 'drop'}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsOver(false);
          void accept(e.dataTransfer.files);
        }}
      >
        <p style={{ margin: 0 }}>
          {t('Drop route GPX files here, or')} <strong>{t('browse')}</strong>
        </p>
        <p className="hint" style={{ margin: '0.4rem 0 0' }}>
          {t('One file per distance is fine — drop them all at once.')}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".gpx"
          multiple
          onChange={(e) => accept(e.target.files)}
        />
      </div>

      {read.length > 0 && (
        <div className="gpx-results">
          {read.map((file) => (
            <div className="gpx-file" key={file.fileName}>
              <div className="gpx-file-head">
                <strong className="loaded-file">{file.fileName}</strong>
                {file.error && <span className="tag bad">{t('Unreadable')}</span>}
              </div>
              {file.error && <p className="hint error-text">{file.error}</p>}
              {file.warnings.map((warning) => (
                <p className="hint" key={warning}>
                  {warning}
                </p>
              ))}
              {file.courses.map((course) => (
                <CourseProfileView course={course} key={course.name} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
