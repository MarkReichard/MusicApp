/**
 * Normalises the exercises array from a lesson object.
 * Handles both lessons with an `exercises` array and flat `notes` arrays.
 * @param {object|null} lesson
 * @returns {{ id: string, notes: object[] }[]}
 */
export function normalizeLessonExercises(lesson) {
  if (!lesson) {
    return [];
  }

  if (Array.isArray(lesson.exercises) && lesson.exercises.length) {
    return lesson.exercises
      .filter((exercise) => exercise && Array.isArray(exercise.notes) && exercise.notes.length)
      .map((exercise, index) => ({
        id: exercise.id ?? `${lesson.id}-exercise-${index + 1}`,
        notes: exercise.notes,
      }));
  }

  if (Array.isArray(lesson.notes) && lesson.notes.length) {
    return [{ id: `${lesson.id}-exercise-1`, notes: lesson.notes }];
  }

  return [];
}
