export function drawChart(canvas, points, minPitchHz, maxPitchHz, minDb, maxDb) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#020617';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = '#1e293b';
  context.lineWidth = 1;
  for (let i = 1; i <= 6; i += 1) {
    const y = (height / 6) * i;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  const validPitchPoints = points.filter((point) => Number.isFinite(point.pitchHz));
  if (validPitchPoints.length > 1) {
    context.strokeStyle = '#22d3ee';
    context.lineWidth = 2;
    context.beginPath();
    validPitchPoints.forEach((point, index) => {
      const x = point.x * width;
      const normalized = (point.pitchHz - minPitchHz) / Math.max(1, maxPitchHz - minPitchHz);
      const y = height - Math.max(0, Math.min(1, normalized)) * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

  const validDbPoints = points.filter((point) => Number.isFinite(point.db));
  if (validDbPoints.length > 1) {
    context.strokeStyle = '#f59e0b';
    context.lineWidth = 1.8;
    context.beginPath();
    validDbPoints.forEach((point, index) => {
      const x = point.x * width;
      const normalized = (point.db - minDb) / Math.max(1, maxDb - minDb);
      const y = height - Math.max(0, Math.min(1, normalized)) * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }
}
