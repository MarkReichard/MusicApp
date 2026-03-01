import React, { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { loadPiano } from './lib/pianoSynth';
import { LessonsPage } from './pages/LessonsPage';
import { TrainerPage } from './pages/TrainerPage';
import { SingTrainerV2Page } from './pages/SingTrainerV2Page';
import { PitchLabPage } from './pages/PitchLabPage';
import { PitchRangePage } from './pages/PitchRangePage';
import { PitchMatchPage } from './pages/PitchMatchPage';
import { SingGraphV2LabPage } from './pages/SingGraphV2LabPage';
import { HomePage } from './pages/HomePage';

export function App() {
  useEffect(() => { loadPiano(); }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" end className="topbar-brand">Music Trainer</NavLink>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/lessons">Lessons</NavLink>
          <NavLink to="/pitch-match">Pitch Match</NavLink>
          <NavLink to="/pitch-range">Pitch Range</NavLink>
        </nav>
      </header>

      <main className="page-body">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/trainer/:lessonId" element={<TrainerPage />} />
          <Route path="/trainer/:lessonId/sing" element={<SingTrainerV2Page />} />
          <Route path="/trainer/:lessonId/sing-v2" element={<SingTrainerV2Page />} />
          <Route path="/pitch-lab" element={<PitchLabPage />} />
          <Route path="/pitch-range" element={<PitchRangePage />} />
          <Route path="/pitch-match" element={<PitchMatchPage />} />
          <Route path="/pitch-lab" element={<PitchLabPage />} />
          <Route path="/sing-graph-v2" element={<SingGraphV2LabPage />} />
        </Routes>
      </main>
    </div>
  );
}
