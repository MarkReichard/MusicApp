import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { loadPitchRangeSettings } from '../lib/pitchRangeSettings';
import { lessons } from '../lib/lessons';

export function HomePage() {
  const pitchRange    = useMemo(() => loadPitchRangeSettings(), []);
  const hasPitchRange = Number.isFinite(pitchRange.minMidi) && Number.isFinite(pitchRange.maxMidi);
  const lessonCount   = lessons.length;

  return (
    <div className="home-page">
      <div className="home-hero">
        <h2 className="home-hero-title">Music Trainer</h2>
        <p className="home-hero-sub">Ear training, solfege, and pitch practice — all in one place.</p>
      </div>

      {!hasPitchRange && (
        <div className="card home-prompt">
          <div className="home-prompt-icon">🎤</div>
          <div className="home-prompt-body">
            <strong>Set up your vocal range</strong>
            <p>We haven't measured your vocal range yet. Take the quick range test so lessons and pitch match can pick the right notes for your voice.</p>
          </div>
          <Link className="button" to="/pitch-range">Test my range →</Link>
        </div>
      )}

      <div className="home-cards">

        <div className="card home-card">
          <div className="home-card-icon">🎵</div>
          <div className="home-card-content">
            <h3>Lessons</h3>
            <p>{lessonCount} exercise{lessonCount !== 1 ? 's' : ''} covering solfege, arpeggios, melodies, and more. Sing or play along on a piano keyboard.</p>
          </div>
          <Link className="button" to="/lessons">Browse lessons</Link>
        </div>

        <div className="card home-card">
          <div className="home-card-icon">🎯</div>
          <div className="home-card-content">
            <h3>Pitch Match</h3>
            <p>Listen to a diatonic note and sing it back. Earn strikes for wrong pitches — replay misses to keep improving.</p>
          </div>
          <Link className="button" to="/pitch-match">Start matching</Link>
        </div>

        <div className="card home-card">
          <div className="home-card-icon">📊</div>
          <div className="home-card-content">
            <h3>Vocal Range</h3>
            <p>{hasPitchRange ? 'Your range is saved and used to pick comfortable keys.' : 'Discover your vocal range so lessons choose the right keys and octaves for you.'}</p>
          </div>
          <Link className="button secondary" to="/pitch-range">{hasPitchRange ? 'Update range' : 'Find my range'}</Link>
        </div>

      </div>
    </div>
  );
}
