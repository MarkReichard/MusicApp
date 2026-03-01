import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { lessons } from '../lib/lessons';

export function LessonsPage() {
  const [query, setQuery] = useState('');
  const [openCategories, setOpenCategories] = useState({}); // undefined = open by default

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lessons;
    return lessons.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.category ?? '').toLowerCase().includes(q) ||
        (l.difficulty ?? '').toLowerCase().includes(q) ||
        (l.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [query]);

  const lessonsByCategory = useMemo(() =>
    filtered.reduce((grouped, lesson) => {
      const cat = lesson.category ?? 'uncategorized';
      (grouped[cat] ??= []).push(lesson);
      return grouped;
    }, {}),
  [filtered]);

  const sortedCategories = useMemo(
    () => Object.keys(lessonsByCategory).sort((a, b) => a.localeCompare(b)),
    [lessonsByCategory],
  );

  function toggleCategory(cat) {
    setOpenCategories((prev) => ({ ...prev, [cat]: !(prev[cat] ?? true) }));
  }

  function isCategoryOpen(cat) {
    return openCategories[cat] ?? true;
  }

  const totalCount = filtered.length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Search bar */}
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: '#64748b', fontSize: 16, pointerEvents: 'none',
        }}>🔍</span>
        <input
          type="search"
          placeholder="Search lessons…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%', padding: '10px 12px 10px 36px',
            background: '#111827', border: '1px solid #334155', borderRadius: 10,
            color: '#e2e8f0', fontSize: 14, outline: 'none',
          }}
        />
        {query && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 12 }}>
            {totalCount} result{totalCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {totalCount === 0 && (
        <p style={{ color: '#64748b', textAlign: 'center', padding: '32px 0' }}>
          No lessons match "{query}"
        </p>
      )}

      {/* Accordion categories */}
      {sortedCategories.map((cat) => {
        const items = lessonsByCategory[cat];
        const open = isCategoryOpen(cat);
        return (
          <div key={cat} className="card" style={{ overflow: 'hidden' }}>
            {/* Category header */}
            <button
              onClick={() => toggleCategory(cat)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', padding: '12px 16px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#e2e8f0', textAlign: 'left',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{formatCategoryLabel(cat)}</span>
                <span style={{
                  background: '#1e293b', color: '#94a3b8',
                  fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                }}>
                  {items.length}
                </span>
              </span>
              <span style={{
                fontSize: 18, color: '#64748b',
                transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.2s',
              }}>
                ▾
              </span>
            </button>

            {/* Lesson rows */}
            {open && (
              <div style={{ borderTop: '1px solid #1e293b' }}>
                {items.map((lesson, i) => (
                  <div
                    key={lesson._sourcePath ?? lesson.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '11px 16px', gap: 12, flexWrap: 'wrap',
                      borderTop: i > 0 ? '1px solid #1e293b' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {lesson.name}
                      </span>
                      <DifficultyBadge difficulty={lesson.difficulty} />
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Link className="button secondary" style={{ fontSize: 12, padding: '5px 12px' }} to={`/trainer/${lesson.id}?mode=solfege`}>
                        Solfege
                      </Link>
                      <Link className="button secondary" style={{ fontSize: 12, padding: '5px 12px' }} to={`/trainer/${lesson.id}?mode=piano`}>
                        Piano
                      </Link>
                      <Link className="button" style={{ fontSize: 12, padding: '5px 12px' }} to={`/trainer/${lesson.id}/sing`}>
                        🎤 Sing
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DifficultyBadge({ difficulty }) {
  if (!difficulty) return null;
  const styles = {
    beginner:     { background: '#14532d', color: '#86efac' },
    intermediate: { background: '#713f12', color: '#fde68a' },
    advanced:     { background: '#7f1d1d', color: '#fca5a5' },
  };
  const s = styles[difficulty.toLowerCase()] ?? { background: '#1e293b', color: '#94a3b8' };
  return (
    <span style={{
      ...s, fontSize: 10, padding: '2px 8px',
      borderRadius: 20, fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {difficulty}
    </span>
  );
}

function formatCategoryLabel(category) {
  return category
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
