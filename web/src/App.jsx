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
import { SongBuilderPage } from './pages/SongBuilderPage';
import { HomePage } from './pages/HomePage';
import { EarTrainingPage } from './pages/EarTrainingPage';
import { FretboardGamePage } from './pages/FretboardGamePage';
import { FretboardLessonMenuPage } from './pages/FretboardLessonMenuPage';
import { AdaptiveDirectionPage } from './pages/AdaptiveDirectionPage';
import { VoiceTuningCalibrationPage } from './pages/VoiceTuningCalibrationPage';

export function App() {
  useEffect(() => { loadPiano(); }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" end className="topbar-brand">Music Trainer</NavLink>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/lessons">Lessons</NavLink>
          <NavLink to="/song-builder">Song Builder</NavLink>
          <NavLink to="/pitch-match">Pitch Match</NavLink>
          <NavLink to="/pitch-range">Vocal Range</NavLink>
          <NavLink to="/ear-training">Ear Training</NavLink>
          <NavLink to="/ear-training/direction">Direction Training</NavLink>
          <NavLink to="/ear-training/voice-calibration">Voice Calibration</NavLink>
          <NavLink to="/fretboard-game">Fretboard Game</NavLink>
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
          <Route path="/song-builder" element={<SongBuilderPage />} />
          <Route path="/ear-training" element={<EarTrainingPage />} />
          <Route path="/ear-training/direction" element={<AdaptiveDirectionPage />} />
          <Route path="/ear-training/voice-calibration" element={<VoiceTuningCalibrationPage />} />
          <Route path="/fretboard-game" element={<FretboardLessonMenuPage />} />
          <Route path="/fretboard-game/:lessonId" element={<FretboardGamePage />} />
        </Routes>
      </main>
    </div>
  );
}
