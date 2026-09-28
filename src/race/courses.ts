import { Course, parseCourse } from './course';

/** The racing venues' courses (content/race/courses/*.yaml), by file name; problems collected in errors. */
const files = import.meta.glob('../../content/race/courses/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function loadCourses(): { courses: Map<string, Course>; errors: string[] } {
  const errors: string[] = [];
  const courses = new Map<string, Course>();
  for (const [path, text] of Object.entries(files)) {
    const name = path.split('/').pop()!.replace(/\.yaml$/, '');
    const def = parseCourse(`content/race/courses/${name}.yaml`, text, errors);
    if (def) courses.set(name, new Course(def));
  }
  return { courses, errors };
}
