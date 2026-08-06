import { useRef, useState } from 'react';
import { parseGpx } from '../lib/gpx';
import { readCourseProfile, type CourseProfile } from '../lib/courseProfile';
import { CourseProfileView } from './CourseProfileView';
import { useT } from '../lib/i18n';

interface LoadedFile {
  fileName: string;
  courses: CourseProfile[];
  warnings: string[];
  error?: string;
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
export function GpxPanel() {
  const t = useT();
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function accept(list: FileList | null | undefined) {
    if (!list || list.length === 0) return;

    const loaded: LoadedFile[] = [];
    for (const file of Array.from(list)) {
      if (!/\.gpx$/i.test(file.name)) {
        loaded.push({
          fileName: file.name,
          courses: [],
          warnings: [],
          error: t('Not a .gpx file.'),
        });
        continue;
      }
      try {
        const parsed = parseGpx(await file.text());
        loaded.push({
          fileName: file.name,
          courses: parsed.tracks.map((track) =>
            readCourseProfile(track, { fallbackName: file.name.replace(/\.gpx$/i, '') })
          ),
          warnings: parsed.warnings,
        });
      } catch (e) {
        loaded.push({
          fileName: file.name,
          courses: [],
          warnings: [],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Longest first, matching how every other list in the tool is read down.
    loaded.sort((a, b) => (b.courses[0]?.totalKm ?? 0) - (a.courses[0]?.totalKm ?? 0));
    setFiles(loaded);
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

      {files.length > 0 && (
        <div className="gpx-results">
          {files.map((file) => (
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
