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
          <Link className="button" to={`/trainer/${lesson.id}`}>Open Trainer</Link>
        </div>
      ))}
    </div>
  );
}
