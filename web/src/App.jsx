import React, { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { loadPiano } from './lib/pianoSynth';
import { LessonsPage } from './pages/LessonsPage';
import { TrainerPage } from './pages/TrainerPage';
import { SingTrainerPage } from './pages/SingTrainerPage';
import { PitchLabPage } from './pages/PitchLabPage';
import { PitchRangePage } from './pages/PitchRangePage';
import { PitchMatchPage } from './pages/PitchMatchPage';

export function App() {
  useEffect(() => { loadPiano(); }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Music Trainer</h1>
        <nav>
          <NavLink to="/lessons">Lessons</NavLink>
          <NavLink to="/pitch-match">Pitch Match</NavLink>
          <NavLink to="/pitch-lab">Mic Settings</NavLink>
          <NavLink to="/pitch-range">Pitch Range</NavLink>
        </nav>
      </header>

      <main className="page-body">
        <Routes>
          <Route path="/" element={<Navigate to="/lessons" replace />} />
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/trainer/:lessonId" element={<TrainerPage />} />
          <Route path="/trainer/:lessonId/sing" element={<SingTrainerPage />} />
          <Route path="/pitch-lab" element={<PitchLabPage />} />
          <Route path="/pitch-range" element={<PitchRangePage />} />
          <Route path="/pitch-match" element={<PitchMatchPage />} />
        </Routes>
      </main>
    </div>
  );
}
