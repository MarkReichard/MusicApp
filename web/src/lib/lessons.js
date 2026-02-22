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

    const hasNotes = Array.isArray(lesson.notes) && lesson.notes.length > 0;
    const hasExercises = Array.isArray(lesson.exercises)
      && lesson.exercises.some((exercise) => Array.isArray(exercise?.notes) && exercise.notes.length > 0);

    return hasNotes || hasExercises;
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export function getLessonById(lessonId) {
  return lessons.find((lesson) => lesson.id === lessonId);
}
