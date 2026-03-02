#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

const SOLFEGE_BY_SEMITONE = ['Do', 'Do', 'Re', 'Re', 'Mi', 'Fa', 'Fa', 'Sol', 'Sol', 'La', 'La', 'Ti'];
const PITCH_CLASS_BY_SEMITONE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MAX_LESSON_ID_LENGTH = 80;       // character limit for sanitized lesson IDs
const FIFTHS_ARRAY_LENGTH = 15;        // circle-of-fifths lookup arrays span Cb(−7) … C#(+7)
const FIFTHS_CENTER_OFFSET = 7;        // index of C (0 fifths) in those arrays
const MIN_TEMPO_BPM = 30;
const MAX_TEMPO_BPM = 240;

// ── Utility functions ────────────────────────────────────────────────────────

function sanitizeId(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_LESSON_ID_LENGTH);
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
  const idx = Math.max(0, Math.min(FIFTHS_ARRAY_LENGTH - 1, maybeNumber(fifths, 0) + FIFTHS_CENTER_OFFSET));
  const keyName = String(mode).toLowerCase().startsWith('min') ? minorByFifths[idx] : majorByFifths[idx];
  const normalized = keyName.replace('b', '#');
  const map = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  return map[normalized] ?? 0;
}

// Normalise MusicXML kind strings to our compact set
function normalizeChordKind(mxmlKind) {
  const map = {
    'major': 'major',
    'minor': 'minor',
    'dominant': 'dominant',
    'major-seventh': 'major-seventh',
    'minor-seventh': 'minor-seventh',
    'diminished': 'diminished',
    'augmented': 'augmented',
    'suspended-fourth': 'sus4',
    'suspended-second': 'sus2',
    'major-sixth': 'major-sixth',
    'minor-sixth': 'minor-sixth',
  };
  return map[String(mxmlKind ?? '').toLowerCase()] ?? (mxmlKind || 'major');
}

// ── preserveOrder XML helpers ────────────────────────────────────────────────
// With preserveOrder:true each element is { tagName: [children], ":@": {attrs} }
// Text nodes are { "#text": "value" }

function poFirst(arr, tag) {
  return arr?.find((item) => item[tag] !== undefined)?.[tag] ?? null;
}

function poAll(arr, tag) {
  return arr?.filter((item) => item[tag] !== undefined).map((item) => item[tag]) ?? [];
}

function poText(arr) {
  const t = arr?.find((c) => c['#text'] !== undefined);
  return t ? String(t['#text']) : null;
}

function poAttrs(item) {
  return item?.[':@'] ?? {};
}

// ── File I/O ─────────────────────────────────────────────────────────────────

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
    const rootfiles = containerObj?.container?.rootfiles?.rootfile;
    const rootfilesArr = Array.isArray(rootfiles) ? rootfiles : rootfiles ? [rootfiles] : [];
    const fullPath = rootfilesArr[0]?.['full-path'];
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

// ── Core parser ──────────────────────────────────────────────────────────────

// Produces a song lesson with a flat measures[] array.
// Each measure has: index, beats, notes[], chords[]
// Harmony (chord) elements are extracted in document order alongside notes,
// giving accurate beat positions for mid-measure chord changes.
function parseScoreToLesson(scoreXml, filePath, defaults) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    preserveOrder: true,
  });

  const parsed = parser.parse(scoreXml);

  // Find score root element
  const scoreItem = parsed.find((item) => item['score-partwise'] || item['score-timewise']);
  const scoreTag = scoreItem?.['score-partwise'] ? 'score-partwise' : 'score-timewise';
  const scoreChildren = scoreItem?.[scoreTag];
  if (!scoreChildren) {
    throw new Error('Unsupported MusicXML format: missing score-partwise/score-timewise');
  }

  // Title
  const workTitle = poText(poFirst(poFirst(scoreChildren, 'work'), 'work-title'));
  const movementTitle = poText(poFirst(scoreChildren, 'movement-title'));
  const scoreTitle = movementTitle || workTitle || path.basename(filePath, path.extname(filePath));

  // First part
  const partChildren = poFirst(scoreChildren, 'part');
  if (!partChildren) throw new Error('No part found in score');

  const measureItems = poAll(partChildren, 'measure');

  let divisions = 1;
  let detectedTempo = defaults.defaultTempoBpm;
  let keyFifths = 0;
  let keyMode = 'major';
  let beatsPerMeasure = 4;
  let beatType = 4;
  let selectedVoice = null;

  const measures = [];

  for (const measureChildren of measureItems) {
    // ── Attributes (key, time, divisions) ──────────────────────────────────
    const attrsChildren = poFirst(measureChildren, 'attributes');
    if (attrsChildren) {
      const divText = poText(poFirst(attrsChildren, 'divisions'));
      divisions = maybeNumber(divText, divisions);

      const keyChildren = poFirst(attrsChildren, 'key');
      if (keyChildren) {
        keyFifths = maybeNumber(poText(poFirst(keyChildren, 'fifths')), keyFifths);
        keyMode = poText(poFirst(keyChildren, 'mode')) ?? keyMode;
      }

      const timeChildren = poFirst(attrsChildren, 'time');
      if (timeChildren) {
        beatsPerMeasure = maybeNumber(poText(poFirst(timeChildren, 'beats')), beatsPerMeasure);
        beatType = maybeNumber(poText(poFirst(timeChildren, 'beat-type')), beatType);
      }
    }

    // ── Tempo from direction ───────────────────────────────────────────────
    for (const dirChildren of poAll(measureChildren, 'direction')) {
      // <sound tempo="90"/>  — tempo is an attribute, stored under ":@" on the sound item
      const soundItem = dirChildren.find((c) => c['sound'] !== undefined);
      if (soundItem) {
        detectedTempo = maybeNumber(poAttrs(soundItem).tempo, detectedTempo);
      }
      // <metronome><per-minute>90</per-minute></metronome>
      const dirTypeChildren = poFirst(dirChildren, 'direction-type');
      if (dirTypeChildren) {
        const metronomeChildren = poFirst(dirTypeChildren, 'metronome');
        if (metronomeChildren) {
          detectedTempo = maybeNumber(poText(poFirst(metronomeChildren, 'per-minute')), detectedTempo);
        }
      }
    }

    // ── Notes + harmonies in document order ───────────────────────────────
    const measureNotes = [];
    const measureChords = [];
    let pendingHarmony = null;
    let cumulativeDivisions = 0;
    const keyRoot = keyRootFromFifths(keyFifths, keyMode);

    for (const elem of measureChildren) {
      // ── Harmony element ─────────────────────────────────────────────────
      if (elem['harmony'] !== undefined) {
        const harmChildren = elem['harmony'];
        const rootChildren = poFirst(harmChildren, 'root');
        if (rootChildren) {
          const rootStep = poText(poFirst(rootChildren, 'root-step'));
          const rootAlterRaw = poText(poFirst(rootChildren, 'root-alter'));
          const rootAlter = maybeNumber(rootAlterRaw, 0);
          const rootAlterSuffix = rootAlter === 1 ? '#' : rootAlter === -1 ? 'b' : '';

          const kindRaw = poText(poFirst(harmChildren, 'kind'));

          if (rootStep) {
            pendingHarmony = {
              root: rootStep + rootAlterSuffix,
              kind: normalizeChordKind(kindRaw),
            };
          }
        }
      }

      // ── Note element ────────────────────────────────────────────────────
      if (elem['note'] !== undefined) {
        const noteChildren = elem['note'];

        // Skip grace notes
        if (noteChildren.some((c) => c['grace'] !== undefined)) {
          continue;
        }

        // Voice filtering — lock to first voice encountered
        const voiceText = poText(poFirst(noteChildren, 'voice'));
        if (selectedVoice === null && voiceText !== null) selectedVoice = voiceText;
        if (selectedVoice !== null && voiceText !== null && voiceText !== selectedVoice) continue;

        // Skip polyphonic chord notes (same beat, stacked pitches)
        if (noteChildren.some((c) => c['chord'] !== undefined)) continue;

        const durationDivisions = maybeNumber(poText(poFirst(noteChildren, 'duration')), 0);
        if (durationDivisions <= 0) continue;

        const durationBeats = Number((durationDivisions / Math.max(1, divisions)).toFixed(4));

        // Assign pending harmony to this note's beat position (1-indexed)
        if (pendingHarmony !== null) {
          const beat = Math.round(cumulativeDivisions / Math.max(1, divisions)) + 1;
          measureChords.push({ beat, root: pendingHarmony.root, kind: pendingHarmony.kind });
          pendingHarmony = null;
        }

        // Rest
        if (noteChildren.some((c) => c['rest'] !== undefined)) {
          measureNotes.push({ type: 'rest', durationBeats });
          cumulativeDivisions += durationDivisions;
          continue;
        }

        // Pitched note
        const pitchChildren = poFirst(noteChildren, 'pitch');
        const step = poText(poFirst(pitchChildren, 'step'));
        const alter = maybeNumber(poText(poFirst(pitchChildren, 'alter')), 0);
        const octave = maybeNumber(poText(poFirst(pitchChildren, 'octave')), defaults.defaultOctave);

        const midi = midiFromPitch(step, alter, octave);
        if (!Number.isFinite(midi)) {
          cumulativeDivisions += durationDivisions;
          continue;
        }

        const pitchName = `${PITCH_CLASS_BY_SEMITONE[((midi % 12) + 12) % 12]}${octave}`;
        measureNotes.push({
          type: 'note',
          pitch: pitchName,
          midi,
          degree: degreeFromMidi(midi, keyRoot),
          durationBeats,
        });

        cumulativeDivisions += durationDivisions;
      }
    }

    if (measureNotes.length > 0) {
      measures.push({
        index: measures.length,
        beats: beatsPerMeasure,
        notes: measureNotes,
        chords: measureChords,
      });
    }
  }

  // ── Build output lesson ────────────────────────────────────────────────────
  const rawId = sanitizeId(scoreTitle);
  const lessonId = rawId.startsWith('song_') ? rawId : `song_${rawId}`;
  const normalizedTempo = Math.round(
    Math.max(MIN_TEMPO_BPM, Math.min(MAX_TEMPO_BPM, detectedTempo || defaults.defaultTempoBpm)),
  );

  const keyRootSemitone = keyRootFromFifths(keyFifths, keyMode);
  const derivedDefaultKey = PITCH_CLASS_BY_SEMITONE[keyRootSemitone] ?? defaults.defaultKey;
  const effectiveDefaultKey = defaults.allowedKeys.includes(derivedDefaultKey) ? derivedDefaultKey : defaults.defaultKey;

  return {
    id: lessonId,
    name: scoreTitle,
    category: defaults.category,
    type: 'song',
    difficulty: defaults.difficulty,
    tags: defaults.tags,
    defaultKey: effectiveDefaultKey,
    allowedKeys: defaults.allowedKeys,
    defaultTempoBpm: normalizedTempo,
    tempoRange: defaults.tempoRange,
    defaultOctave: defaults.defaultOctave,
    allowedOctaves: defaults.allowedOctaves,
    timeSig: { beats: beatsPerMeasure, beatType },
    measures,
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
    tempoRange: { min: MIN_TEMPO_BPM, max: MAX_TEMPO_BPM },
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
    const lesson = parseScoreToLesson(xml, filePath, args);
    const outputName = `${lesson.id}.json`;
    const outputPath = path.join(args.outputDir, outputName);
    fs.writeFileSync(outputPath, `${JSON.stringify(lesson, null, 2)}\n`, 'utf8');
    results.push({ input: filePath, output: outputPath, measures: lesson.measures.length });
  }

  console.log(`Converted ${results.length} file(s):`);
  for (const item of results) {
    console.log(`- ${path.basename(item.input)} -> ${item.output} (${item.measures} measures)`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
