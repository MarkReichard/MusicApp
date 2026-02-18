export const lessons = [
  {
    id: 'pattern_desc_arpeggio_major_triad_3',
    name: 'Descending Arpeggio (3 Notes)',
    category: '3_note_pattern',
    type: 'pattern',
    difficulty: 'beginner',
    defaultOctave: 4,
    allowedOctaves: [3, 4, 5],
    notes: [
      { pitch: 'G4', midi: 67, degree: 'Sol' },
      { pitch: 'E4', midi: 64, degree: 'Mi' },
      { pitch: 'C4', midi: 60, degree: 'Do' },
    ],
  },
  {
    id: 'song_jingle_bells_excerpt',
    name: 'Jingle Bells (Excerpt)',
    category: 'christmas_songs',
    type: 'song',
    difficulty: 'beginner',
    defaultOctave: 4,
    allowedOctaves: [3, 4, 5],
    notes: [
      { pitch: 'E4', midi: 64, degree: 'Mi' },
      { pitch: 'E4', midi: 64, degree: 'Mi' },
      { pitch: 'E4', midi: 64, degree: 'Mi' },
      { pitch: 'E4', midi: 64, degree: 'Mi' },
      { pitch: 'E4', midi: 64, degree: 'Mi' },
      { pitch: 'E4', midi: 64, degree: 'Mi' },
      { pitch: 'E4', midi: 64, degree: 'Mi' },
      { pitch: 'G4', midi: 67, degree: 'Sol' },
      { pitch: 'C4', midi: 60, degree: 'Do' },
      { pitch: 'D4', midi: 62, degree: 'Re' },
      { pitch: 'E4', midi: 64, degree: 'Mi' },
    ],
  },
];

export function getLessonById(lessonId) {
  return lessons.find((lesson) => lesson.id === lessonId);
}
