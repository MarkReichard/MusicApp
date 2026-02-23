#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

const SOLFEGE_BY_SEMITONE = ['Do', 'Do', 'Re', 'Re', 'Mi', 'Fa', 'Fa', 'Sol', 'Sol', 'La', 'La', 'Ti'];
const PITCH_CLASS_BY_SEMITONE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function sanitizeId(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function maybeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function midiFromPitch(step, alter = 0, octave = 4) {
  const stepOffsets = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const base = stepOffsets[step];
  if (!Number.isFinite(base)) return null;
  return (octave + 1) * 12 + base + alter;
}

function degreeFromMidi(midi, keyRootSemitone = 0) {
  const rel = ((midi - keyRootSemitone) % 12 + 12) % 12;
  return SOLFEGE_BY_SEMITONE[rel] ?? 'Do';
}

function keyRootFromFifths(fifths = 0, mode = 'major') {
  const majorByFifths = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  const minorByFifths = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
  const idx = Math.max(0, Math.min(14, maybeNumber(fifths, 0) + 7));
  const keyName = String(mode).toLowerCase().startsWith('min') ? minorByFifths[idx] : majorByFifths[idx];
  const normalized = keyName.replace('b', '#');
  const map = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  return map[normalized] ?? 0;
}

function parseXmlFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mxl') {
    const zip = new AdmZip(filePath);
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) {
      throw new Error('Invalid MXL: META-INF/container.xml not found');
    }
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const containerObj = parser.parse(containerEntry.getData().toString('utf8'));
    const rootfiles = asArray(containerObj?.container?.rootfiles?.rootfile);
    const fullPath = rootfiles[0]?.['full-path'];
    if (!fullPath) {
      throw new Error('Invalid MXL: cannot locate root MusicXML file');
    }
    const scoreEntry = zip.getEntry(fullPath);
    if (!scoreEntry) {
      throw new Error(`Invalid MXL: score entry not found at ${fullPath}`);
    }
    return scoreEntry.getData().toString('utf8');
  }

  return fs.readFileSync(filePath, 'utf8');
}

function firstPart(score) {
  return score?.['score-partwise']?.part ?? score?.['score-timewise']?.part;
}


// Returns a single lesson object with an exercises array, each exercise is two measures
function parseScoreToLessonWithExercises(scoreXml, filePath, defaults) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
  });

  const parsed = parser.parse(scoreXml);
  const scoreRoot = parsed?.['score-partwise'] ?? parsed?.['score-timewise'];
  if (!scoreRoot) {
    throw new Error('Unsupported MusicXML format: missing score-partwise/score-timewise');
  }

  const workTitle = scoreRoot?.work?.['work-title'];
  const movementTitle = scoreRoot?.['movement-title'];
  const scoreTitle = movementTitle || workTitle || path.basename(filePath, path.extname(filePath));

  const part = asArray(firstPart(parsed))[0];
  if (!part) {
    throw new Error('No part found in score');
  }

  const measures = asArray(part.measure);
  let divisions = 1;
  let detectedTempo = defaults.defaultTempoBpm;
  let keyFifths = 0;
  let keyMode = 'major';
  let beatsPerMeasure = 4;
  let beatType = 4;
  let selectedVoice = null;

  // Split measures into chunks of 2, each becomes an exercise
  const exercises = [];
  for (let i = 0; i < measures.length; i += 2) {
    const lessonMeasures = measures.slice(i, i + 2);
    const notes = [];
    for (const measure of lessonMeasures) {
      const attrs = measure?.attributes;
      if (attrs) {
        divisions = maybeNumber(attrs?.divisions, divisions);
        keyFifths = maybeNumber(attrs?.key?.fifths, keyFifths);
        keyMode = attrs?.key?.mode ?? keyMode;
        beatsPerMeasure = maybeNumber(attrs?.time?.beats, beatsPerMeasure);
        beatType = maybeNumber(attrs?.time?.['beat-type'], beatType);
      }

      const direction = asArray(measure?.direction)[0];
      const dirTempo = direction?.sound?.tempo ?? direction?.['direction-type']?.metronome?.['per-minute'];
      detectedTempo = maybeNumber(dirTempo, detectedTempo);

      for (const note of asArray(measure?.note)) {
        if (note?.grace !== undefined) {
          continue;
        }

        const voice = note?.voice;
        if (selectedVoice === null && voice !== undefined) {
          selectedVoice = String(voice);
        }
        if (selectedVoice !== null && voice !== undefined && String(voice) !== selectedVoice) {
          continue;
        }

        if (note?.chord !== undefined) {
          continue;
        }

        const durationDivisions = maybeNumber(note?.duration, 0);
        if (durationDivisions <= 0) {
          continue;
        }

        const durationBeats = Number((durationDivisions / Math.max(1, divisions)).toFixed(4));
        if (note?.rest !== undefined) {
          notes.push({
            type: 'rest',
            durationBeats,
          });
          continue;
        }

        const step = note?.pitch?.step;
        const alter = maybeNumber(note?.pitch?.alter, 0);
        const octave = maybeNumber(note?.pitch?.octave, defaults.defaultOctave);
        const midi = midiFromPitch(step, alter, octave);
        if (!Number.isFinite(midi)) {
          continue;
        }

        const pitchName = `${PITCH_CLASS_BY_SEMITONE[((midi % 12) + 12) % 12]}${octave}`;
        const keyRoot = keyRootFromFifths(keyFifths, keyMode);
        notes.push({
          type: 'note',
          pitch: pitchName,
          midi,
          degree: degreeFromMidi(midi, keyRoot),
          durationBeats,
        });
      }
    }
    if (notes.length) {
      exercises.push({
        id: `ex_${i / 2 + 1}`,
        notes
      });
    }
  }

  const rawId = sanitizeId(scoreTitle);
  const lessonId = rawId.startsWith('song_') ? rawId : `song_${rawId}`;
  const normalizedTempo = Math.round(Math.max(30, Math.min(240, detectedTempo || defaults.defaultTempoBpm)));
  const inferredChunk = Math.max(2, Math.min(12, Math.round(beatsPerMeasure * (4 / Math.max(1, beatType)))));

  return {
    id: lessonId,
    name: scoreTitle,
    category: defaults.category,
    type: 'song',
    difficulty: defaults.difficulty,
    tags: defaults.tags,
    defaultKey: defaults.defaultKey,
    allowedKeys: defaults.allowedKeys,
    defaultTempoBpm: normalizedTempo,
    tempoRange: defaults.tempoRange,
    defaultChunkSize: inferredChunk,
    chunkSizeRange: defaults.chunkSizeRange,
    defaultOctave: defaults.defaultOctave,
    allowedOctaves: defaults.allowedOctaves,
    notes: [],
    exercises,
    source: {
      kind: 'preloaded',
      version: defaults.version,
    },
    updatedAt: new Date().toISOString(),
  };
}

function parseArgs(argv) {
  const args = {
    input: null,
    outputDir: path.resolve(process.cwd(), 'content', 'lessons'),
    category: 'imported_scores',
    difficulty: 'intermediate',
    defaultKey: 'C',
    allowedKeys: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    defaultOctave: 4,
    defaultTempoBpm: 90,
    tags: ['imported', 'musicxml'],
    tempoRange: { min: 30, max: 200 },
    chunkSizeRange: { min: 2, max: 12 },
    allowedOctaves: [2, 3, 4, 5],
    version: '1.0.0',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--input' || token === '-i') {
      args.input = next;
      i += 1;
    } else if (token === '--output' || token === '-o') {
      args.outputDir = path.resolve(process.cwd(), next);
      i += 1;
    } else if (token === '--category') {
      args.category = next;
      i += 1;
    } else if (token === '--difficulty') {
      args.difficulty = next;
      i += 1;
    } else if (token === '--default-key') {
      args.defaultKey = next;
      i += 1;
    } else if (token === '--tags') {
      args.tags = String(next || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      i += 1;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    }
  }

  return args;
}

function usage() {
  return [
    'Convert MusicXML/MXL files to MusicApp lesson JSON.',
    '',
    'Usage:',
    '  node scripts/convert-mxml-to-lessons.mjs --input <file-or-dir> [options]',
    '',
    'Options:',
    '  -i, --input <path>        Input .musicxml/.xml/.mxl file or directory (required)',
    '  -o, --output <path>       Output directory (default: content/lessons)',
    '      --category <value>    Lesson category (default: imported_scores)',
    '      --difficulty <value>  beginner|intermediate|advanced (default: intermediate)',
    '      --default-key <value> Default key string (default: C)',
    '      --tags <csv>          Comma-separated tags (default: imported,musicxml)',
  ].join('\n');
}

function collectInputFiles(inputPath) {
  const absolute = path.resolve(process.cwd(), inputPath);
  const stat = fs.statSync(absolute);

  if (stat.isFile()) {
    return [absolute];
  }

  const files = fs.readdirSync(absolute)
    .map((entry) => path.join(absolute, entry))
    .filter((entry) => fs.statSync(entry).isFile())
    .filter((entry) => ['.musicxml', '.xml', '.mxl', '.mxml'].includes(path.extname(entry).toLowerCase()));

  return files;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const files = collectInputFiles(args.input);
  if (!files.length) {
    throw new Error('No MusicXML files found at input path');
  }

  fs.mkdirSync(args.outputDir, { recursive: true });

  const results = [];

  for (const filePath of files) {
    const xml = parseXmlFromFile(filePath);
    const lesson = parseScoreToLessonWithExercises(xml, filePath, args);
    const outputName = `${lesson.id}.json`;
    const outputPath = path.join(args.outputDir, outputName);
    fs.writeFileSync(outputPath, `${JSON.stringify(lesson, null, 2)}\n`, 'utf8');
    results.push({ input: filePath, output: outputPath, exercises: lesson.exercises.length });
  }

  console.log(`Converted ${results.length} file(s):`);
  for (const item of results) {
    console.log(`- ${path.basename(item.input)} -> ${item.output} (${item.notes} events)`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
