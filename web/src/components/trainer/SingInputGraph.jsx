import React from 'react';
import { MicPitchGraphPanel } from '../MicPitchGraphPanel';

export function SingInputGraph({ settings, current, history }) {
  return (
    <MicPitchGraphPanel
      title="Sung Pitch"
      settings={settings}
      externalCurrent={current}
      externalHistory={history}
      showHeader={false}
      showControls={false}
      showReadouts={false}
      maxHistoryPoints={220}
    />
  );
}
