const lessonModules = import.meta.glob('../../../content/lessons/*.json', {
  eager: true,
});

export const lessons = Object.values(lessonModules)
  .map((module) => module.default ?? module)
  .filter((lesson) => lesson && typeof lesson.id === 'string' && Array.isArray(lesson.notes))
  .sort((a, b) => a.name.localeCompare(b.name));

export function getLessonById(lessonId) {
  return lessons.find((lesson) => lesson.id === lessonId);
}
