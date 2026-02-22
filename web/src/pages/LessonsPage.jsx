import React from 'react';
import { Link } from 'react-router-dom';
import { lessons } from '../lib/lessons';

export function LessonsPage() {
  return (
    <div className="list">
      {lessons.map((lesson) => (
        <div className="card lesson-item" key={lesson.id}>
          <div>
            <div>{lesson.name}</div>
            <small>{lesson.category} · {lesson.difficulty}</small>
          </div>
          <div className="lesson-actions">
            <Link className="button" to={`/trainer/${lesson.id}`}>Open Trainer</Link>
            <Link className="button secondary" to={`/trainer/${lesson.id}/sing`}>Open Sing Trainer</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
