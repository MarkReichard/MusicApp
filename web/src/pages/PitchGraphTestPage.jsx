import React from 'react';
import { MicPitchGraphPanel } from '../components/MicPitchGraphPanel';

export function PitchGraphTestPage() {
  return (
    <div>
      <MicPitchGraphPanel title="Mic Graph Test" autoStart />
    </div>
  );
}
