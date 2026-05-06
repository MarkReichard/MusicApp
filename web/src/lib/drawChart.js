import { frequencyToMidi, midiToNoteLabel } from './musicTheory';

export function drawChart(canvas, points, minPitchHz, maxPitchHz, minDb, maxDb, options = {}) {
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
  const minMidiRaw = frequencyToMidi(safeMinHz);
  const maxMidiRaw = frequencyToMidi(safeMaxHz);
  const minMidi = minMidiRaw ?? 0;
  const maxMidi = maxMidiRaw ?? 12;
  const inRangeStrokeColor = options.inRangeStrokeColor ?? '#22d3ee';
  const outOfRangeStrokeColor = options.outOfRangeStrokeColor ?? '#ef4444';
  const isOutOfRange = typeof options.isOutOfRange === 'function'
    ? options.isOutOfRange
    : (point) => Boolean(point?.isOutOfRange);

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
    context.lineWidth = 2;
    for (let index = 1; index < validPitchPoints.length; index += 1) {
      const previousPoint = validPitchPoints[index - 1];
      const currentPoint = validPitchPoints[index];
      const previousMidi = frequencyToMidi(previousPoint.pitchHz);
      const currentMidi = frequencyToMidi(currentPoint.pitchHz);
      if (!Number.isFinite(previousMidi) || !Number.isFinite(currentMidi)) {
        continue;
      }

      const x1 = plotLeft + previousPoint.x * plotWidth;
      const y1 = midiToY(previousMidi, minMidi, maxMidi, height);
      const x2 = plotLeft + currentPoint.x * plotWidth;
      const y2 = midiToY(currentMidi, minMidi, maxMidi, height);

      context.strokeStyle = (isOutOfRange(previousPoint) || isOutOfRange(currentPoint))
        ? outOfRangeStrokeColor
        : inRangeStrokeColor;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    }
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
