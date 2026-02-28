const DEFAULT_CAPACITY = 4096;

export function createPitchRingBuffer(capacity = DEFAULT_CAPACITY) {
  const safeCapacity = Math.max(64, Math.floor(capacity));

  return {
    capacity: safeCapacity,
    timeSec: new Float64Array(safeCapacity),
    midi: new Float32Array(safeCapacity),
    clarity: new Float32Array(safeCapacity),
    db: new Float32Array(safeCapacity),
    voiced: new Uint8Array(safeCapacity),
    writeIndex: 0,
    size: 0,
  };
}

export function clearPitchRingBuffer(buffer) {
  if (!buffer) {
    return;
  }

  buffer.writeIndex = 0;
  buffer.size = 0;
}

export function pushPitchSample(buffer, sample) {
  if (!buffer) {
    return;
  }

  const index = buffer.writeIndex;
  buffer.timeSec[index] = Number.isFinite(sample.timeSec) ? sample.timeSec : 0;
  buffer.midi[index] = Number.isFinite(sample.midi) ? sample.midi : Number.NaN;
  buffer.clarity[index] = Number.isFinite(sample.clarity) ? sample.clarity : Number.NaN;
  buffer.db[index] = Number.isFinite(sample.db) ? sample.db : -120;
  buffer.voiced[index] = sample.voiced ? 1 : 0;

  buffer.writeIndex = (index + 1) % buffer.capacity;
  buffer.size = Math.min(buffer.capacity, buffer.size + 1);
}

export function forEachSampleInTimeRange(buffer, minTimeSec, maxTimeSec, callback) {
  if (!buffer || typeof callback !== 'function' || buffer.size <= 0) {
    return;
  }

  const startIndex = (buffer.writeIndex - buffer.size + buffer.capacity) % buffer.capacity;
  for (let offset = 0; offset < buffer.size; offset += 1) {
    const index = (startIndex + offset) % buffer.capacity;
    const timeSec = buffer.timeSec[index];
    if (timeSec < minTimeSec || timeSec > maxTimeSec) {
      continue;
    }

    callback({
      timeSec,
      midi: buffer.midi[index],
      clarity: buffer.clarity[index],
      db: buffer.db[index],
      voiced: buffer.voiced[index] === 1,
      index,
    });
  }
}
