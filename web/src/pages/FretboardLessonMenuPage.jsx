import React from 'react';
import { Link } from 'react-router-dom';

const LESSONS = [
  {
    id: 'lesson-1',
    title: 'Lesson One - Open Strings',
    description: 'Match staff notes to open guitar strings only (frets 0 shown on the neck).',
  },
  {
    id: 'lesson-2',
    title: 'Lesson Two - Single String Mapping',
    description: 'Work one selected string at a time with key-based note mapping.',
  },
  {
    id: 'lesson-3',
    title: 'Lesson Three - First Position',
    description: 'Map notes across strings in first position while viewing the full fretboard.',
  },
];

export function FretboardLessonMenuPage() {
  return (
    <div className="fretboard-menu-page">
      <div className="card fretboard-menu-header">
        <h2>Fretboard Lessons</h2>
        <p>Choose a lesson to start. Each lesson opens in its own practice page.</p>
      </div>

      <div className="fretboard-menu-grid">
        {LESSONS.map((lesson) => (
          <div key={lesson.id} className="card fretboard-menu-card">
            <h3>{lesson.title}</h3>
            <p>{lesson.description}</p>
            <Link className="button" to={`/fretboard-game/${lesson.id}`}>Start lesson</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
