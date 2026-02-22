import React from 'react';
import { Link } from 'react-router-dom';
import { lessons } from '../lib/lessons';

export function LessonsPage() {
  const lessonsByCategory = lessons.reduce((grouped, lesson) => {
    const category = lesson.category ?? 'uncategorized';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(lesson);
    return grouped;
  }, {});

  const sortedCategories = Object.keys(lessonsByCategory).sort((a, b) => a.localeCompare(b));

  return (
    <div className="list">
      {sortedCategories.map((category) => (
        <section className="lesson-category-group" key={category}>
          <h3 className="lesson-category-title">{formatCategoryLabel(category)}</h3>
          {lessonsByCategory[category].map((lesson) => (
            <div className="card lesson-item" key={lesson.id}>
              <div>
                <div>{lesson.name}</div>
                <small>{lesson.category} · {lesson.difficulty}</small>
              </div>
              <div className="lesson-actions">
                <Link className="button" to={`/trainer/${lesson.id}?mode=solfege`}>Solfege</Link>
                <Link className="button" to={`/trainer/${lesson.id}?mode=piano`}>Piano</Link>
                <Link className="button" to={`/trainer/${lesson.id}/sing`}>Sing</Link>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function formatCategoryLabel(category) {
  return category
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
