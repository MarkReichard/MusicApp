import React from 'react';
import PropTypes from 'prop-types';

export function DetectorLogDebugControls({
  detectorLogSummary,
  clearDetectorLog,
  getDetectorLogRows,
  filePrefix,
}) {
  function handleExportDetectorLog() {
    const rows = getDetectorLogRows();
    if (!rows.length) {
      return;
    }

    const header = [
      'tick',
      'timeSec',
      'db',
      'rawHz',
      'rawClarity',
      'acceptedHz',
      'midi',
      'clarity',
      'voiced',
      'gateReason',
      'minDbThreshold',
      'minClarityThreshold',
      'minFreqHz',
      'maxFreqHz',
    ];
    const csvLines = [header.join(',')];
    rows.forEach((row) => {
      csvLines.push([
        row.tick,
        formatCsvNumber(row.timeSec),
        formatCsvNumber(row.db),
        formatCsvNumber(row.rawHz),
        formatCsvNumber(row.rawClarity),
        formatCsvNumber(row.acceptedHz),
        formatCsvNumber(row.midi),
        formatCsvNumber(row.clarity),
        row.voiced ? '1' : '0',
        row.gateReason,
        formatCsvNumber(row.minDbThreshold),
        formatCsvNumber(row.minClarityThreshold),
        formatCsvNumber(row.minFreqHz),
        formatCsvNumber(row.maxFreqHz),
      ].join(','));
    });

    const blob = new Blob([`${csvLines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url;
    anchor.download = `${filePrefix}-detector-log-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      <button type="button" className="button secondary" onClick={handleExportDetectorLog}>
        Export Detector Log CSV
      </button>
      <button type="button" className="button secondary" onClick={clearDetectorLog}>
        Clear Log
      </button>
      <span className="badge">Log Rows: {detectorLogSummary.count}</span>
      <span className="badge">Last Gate: {detectorLogSummary.lastGate}</span>
      <span className="badge">Last Raw Hz: {Number.isFinite(detectorLogSummary.lastRawHz) ? detectorLogSummary.lastRawHz.toFixed(2) : '-'}</span>
    </div>
  );
}

function formatCsvNumber(value) {
  return Number.isFinite(value) ? String(value) : '';
}

DetectorLogDebugControls.propTypes = {
  detectorLogSummary: PropTypes.shape({
    count: PropTypes.number,
    lastGate: PropTypes.string,
    lastRawHz: PropTypes.number,
  }).isRequired,
  clearDetectorLog: PropTypes.func.isRequired,
  getDetectorLogRows: PropTypes.func.isRequired,
  filePrefix: PropTypes.string,
};

DetectorLogDebugControls.defaultProps = {
  filePrefix: 'trainer',
};