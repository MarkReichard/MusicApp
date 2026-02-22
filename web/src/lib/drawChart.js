export function drawChart(canvas, points, minPitchHz, maxPitchHz, minDb, maxDb) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  const plotLeft = 64;
  const plotRight = width - 8;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const safeMinHz = Math.max(1, Number(minPitchHz) || 1);
  const safeMaxHz = Math.max(safeMinHz + 1, Number(maxPitchHz) || safeMinHz + 1);
  const minMidi = frequencyToMidi(safeMinHz);
  const maxMidi = frequencyToMidi(safeMaxHz);

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#020617';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = '#334155';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(plotLeft - 0.5, 0);
  context.lineTo(plotLeft - 0.5, height);
  context.stroke();

  const noteMarks = buildNoteMarks(minMidi, maxMidi);
  context.font = '11px Inter, Segoe UI, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';

  noteMarks.forEach((mark) => {
    const y = midiToY(mark.midi, minMidi, maxMidi, height);

    context.strokeStyle = '#1e293b';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plotLeft, y);
    context.lineTo(plotRight, y);
    context.stroke();

    context.fillStyle = '#94a3b8';
    context.fillText(mark.label, 6, y);
  });

  const validPitchPoints = points.filter((point) => Number.isFinite(point.pitchHz));
  if (validPitchPoints.length > 1) {
    context.strokeStyle = '#22d3ee';
    context.lineWidth = 2;
    context.beginPath();
    validPitchPoints.forEach((point, index) => {
      const x = plotLeft + point.x * plotWidth;
      const midi = frequencyToMidi(point.pitchHz);
      const y = midiToY(midi, minMidi, maxMidi, height);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

}

function buildNoteMarks(minMidi, maxMidi) {
  const firstMidi = Math.ceil(minMidi);
  const lastMidi = Math.floor(maxMidi);
  const marks = [];
  for (let midi = firstMidi; midi <= lastMidi; midi += 1) {
    marks.push({
      midi,
      label: midiToNoteLabel(midi),
    });
  }

  return marks;
}

function midiToY(midi, minMidi, maxMidi, height) {
  const normalized = (midi - minMidi) / Math.max(1e-6, maxMidi - minMidi);
  return height - Math.max(0, Math.min(1, normalized)) * height;
}

function frequencyToMidi(frequencyHz) {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

function midiToNoteLabel(midi) {
  const roundedMidi = Math.round(midi);
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = noteNames[((roundedMidi % 12) + 12) % 12] ?? 'C';
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${name}${octave}`;
}
