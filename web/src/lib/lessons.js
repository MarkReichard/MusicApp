const lessonModules = import.meta.glob('../../../content/lessons/**/*.json', {
  eager: true,
});

export const lessons = Object.entries(lessonModules)
  .map(([sourcePath, module]) => {
    const lesson = module.default ?? module;
    return {
      ...lesson,
      _sourcePath: sourcePath,
    };
  })
  .filter((lesson) => {
    if (!lesson || typeof lesson.id !== 'string') {
      return false;
    }

    const hasMeasures = Array.isArray(lesson.measures) && lesson.measures.length > 0;

    return hasMeasures;
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export function getLessonById(lessonId) {
  return lessons.find((lesson) => lesson.id === lessonId);
}
