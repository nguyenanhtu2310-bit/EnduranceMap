import type { Course } from './snap';

/**
 * Where a course came from, and therefore what it can answer.
 *
 * The two file types carry different halves of a race and neither can express the
 * other's: a GPX has elevation on every point and no idea what a checkpoint is, while a
 * KML has the station layers, the folder structure and the cut-off labels but usually
 * arrives with its altitudes flattened to zero.
 */
export type CourseOrigin = 'gpx' | 'kml';

export interface SourcedCourse {
  course: Course;
  origin: CourseOrigin;
}

/** A map's own route that a GPX of the same distance stood in for. */
export interface ReplacedCourse {
  kml: Course;
  gpx: Course;
}

export interface MergedCourses {
  courses: Course[];
  sources: SourcedCourse[];
  /**
   * What the merge decided, for the screen to show rather than hide. Structured rather
   * than a sentence so the screen can say it in the reader's own language.
   */
  replaced: ReplacedCourse[];
}

/**
 * How far apart two measured lengths may be and still be the same contest, as a share of
 * the longer one.
 *
 * Deliberately generous. A KML route drawn by hand and a GPX surveyed on the ground
 * disagree by a few percent on the same road, and trail races advertise distances that
 * run 8–10% under what anyone actually covers. This is asking "are these both the 100 km"
 * — not "is this the same route", which length cannot answer at all: two editions of one
 * real course measured 330 metres apart in total while 20 km of the route had moved.
 */
const SAME_CONTEST_TOLERANCE = 0.08;

function sameContest(a: number, b: number): boolean {
  const longer = Math.max(a, b);
  if (longer === 0) return false;
  return Math.abs(a - b) / longer <= SAME_CONTEST_TOLERANCE;
}

/**
 * Combines the courses a KML holds with the courses a set of GPX files hold.
 *
 * Where both describe the same distance the GPX wins, because it is the one carrying
 * elevation — and a schedule built on a course with no profile cannot warn anybody about
 * a climb. The KML's own routes are kept wherever no GPX covers them, so a map that
 * already worked keeps working.
 */
export function mergeCourseSources(kmlCourses: Course[], gpxCourses: Course[]): MergedCourses {
  const sources: SourcedCourse[] = gpxCourses.map((course) => ({ course, origin: 'gpx' }));
  const replaced: ReplacedCourse[] = [];

  for (const kmlCourse of kmlCourses) {
    const covered = gpxCourses.find((g) => sameContest(g.totalKm, kmlCourse.totalKm));
    if (covered) {
      replaced.push({ kml: kmlCourse, gpx: covered });
      continue;
    }
    sources.push({ course: kmlCourse, origin: 'kml' });
  }

  // Longest first, the order every list in the tool is read down: the long course sets
  // the day's outer envelope, first start to last finish.
  sources.sort((a, b) => b.course.totalKm - a.course.totalKm);

  return { courses: sources.map((s) => s.course), sources, replaced };
}
