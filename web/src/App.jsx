import React from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { LessonsPage } from './pages/LessonsPage';
import { TrainerPage } from './pages/TrainerPage';
import { PitchLabPage } from './pages/PitchLabPage';
import { PitchGraphTestPage } from './pages/PitchGraphTestPage';

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Music Trainer</h1>
        <nav>
          <NavLink to="/lessons">Lessons</NavLink>
          <NavLink to="/pitch-lab">Mic Settings</NavLink>
          <NavLink to="/pitch-graph-test">Graph Test</NavLink>
        </nav>
      </header>

      <main className="page-body">
        <Routes>
          <Route path="/" element={<Navigate to="/lessons" replace />} />
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/trainer/:lessonId" element={<TrainerPage />} />
          <Route path="/pitch-lab" element={<PitchLabPage />} />
          <Route path="/pitch-graph-test" element={<PitchGraphTestPage />} />
        </Routes>
      </main>
    </div>
  );
}
