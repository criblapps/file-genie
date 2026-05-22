import { useState, useMemo, useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  filename: string;
  readOnly?: boolean;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        cells.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

function serializeCSV(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(','),
    )
    .join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LookupEditor({ value, onChange, filename, readOnly = false }: Props) {
  const [mode, setMode] = useState<'table' | 'text'>('table');
  const [colFilter, setColFilter] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const lineNumRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const allRows = useMemo(() => parseCSV(value), [value]);
  const headers = allRows[0] ?? [];
  const dataRows = allRows.slice(1);

  const visibleCols = useMemo(() => {
    if (!colFilter.trim()) return headers.map((_, i) => i);
    const q = colFilter.toLowerCase();
    return headers.map((h, i) => ({ h, i })).filter(({ h }) => h.toLowerCase().includes(q)).map(({ i }) => i);
  }, [headers, colFilter]);

  const lines = useMemo(() => value.split('\n'), [value]);
  const byteCount = new TextEncoder().encode(value).length;
  const allSelected = dataRows.length > 0 && selectedRows.size === dataRows.length;

  // ── Table mutations ──────────────────────────────────────────────────────────

  function updateCell(rowIdx: number, colIdx: number, val: string) {
    const newRows = [headers.map((h) => h), ...dataRows.map((r) => [...r])];
    if (!newRows[rowIdx + 1]) return;
    newRows[rowIdx + 1][colIdx] = val;
    onChange(serializeCSV(newRows));
  }

  function updateHeader(colIdx: number, val: string) {
    const newH = [...headers];
    newH[colIdx] = val;
    onChange(serializeCSV([newH, ...dataRows]));
  }

  function addRow() {
    const cols = Math.max(headers.length, 1);
    const base = headers.length ? headers : new Array(cols).fill('');
    onChange(serializeCSV([base, ...dataRows, new Array(cols).fill('')]));
  }

  function deleteSelected() {
    if (selectedRows.size === 0) return;
    const remaining = dataRows.filter((_, i) => !selectedRows.has(i));
    onChange(serializeCSV([headers, ...remaining]));
    setSelectedRows(new Set());
  }

  function toggleRow(i: number) {
    setSelectedRows((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  }

  function toggleAll() {
    setSelectedRows(allSelected ? new Set() : new Set(dataRows.map((_, i) => i)));
  }

  // ── File actions ─────────────────────────────────────────────────────────────

  function handleDownload() {
    const blob = new Blob([value], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleReplace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange((ev.target?.result as string) ?? '');
    reader.readAsText(file);
    e.target.value = '';
  }

  function syncScroll() {
    if (lineNumRef.current && textareaRef.current) {
      lineNumRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="lookup-editor">
      {/* ── Top toolbar ── */}
      <div className="editor-toolbar">
        <span className="editor-mode-label">Edit Mode:</span>
        <div className="editor-tabs">
          <button className={`editor-tab ${mode === 'table' ? 'editor-tab--active' : ''}`} onClick={() => setMode('table')}>
            Table
          </button>
          <button className={`editor-tab ${mode === 'text' ? 'editor-tab--active' : ''}`} onClick={() => setMode('text')}>
            Text
          </button>
        </div>
        {mode === 'table' && (
          <div className="col-filter-wrap">
            <FilterIcon />
            <input
              className="col-filter-input"
              placeholder="Filter columns"
              value={colFilter}
              onChange={(e) => setColFilter(e.target.value)}
            />
          </div>
        )}
        <span className="editor-referenced muted">
          {dataRows.length} rows · {headers.length} cols · {formatBytes(byteCount)}
        </span>
      </div>

      {/* ── Table mode ── */}
      {mode === 'table' && (
        <div className="csv-table-scroll">
          <table className="csv-edit-table">
            <thead>
              <tr>
                <th className="csv-check-col">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={readOnly || dataRows.length === 0}
                    aria-label="Select all rows"
                  />
                </th>
                <th className="csv-id-col">ID</th>
                {visibleCols.map((ci) => (
                  <th key={ci}>
                    <input
                      className="csv-header-input"
                      value={headers[ci] ?? ''}
                      onChange={(e) => updateHeader(ci, e.target.value)}
                      readOnly={readOnly}
                      spellCheck={false}
                      placeholder="column"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr
                  key={ri}
                  className={selectedRows.has(ri) ? 'csv-row--selected' : ''}
                >
                  <td className="csv-check-col">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(ri)}
                      onChange={() => toggleRow(ri)}
                      disabled={readOnly}
                    />
                  </td>
                  <td className="csv-id-col muted">{ri + 1}</td>
                  {visibleCols.map((ci) => (
                    <td key={ci}>
                      <input
                        className="csv-cell-input"
                        value={row[ci] ?? ''}
                        onChange={(e) => updateCell(ri, ci, e.target.value)}
                        readOnly={readOnly}
                        spellCheck={false}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {dataRows.length === 0 && (
                <tr>
                  <td colSpan={visibleCols.length + 2} className="csv-empty-row muted">
                    No data rows — click Add Row to start.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Text mode ── */}
      {mode === 'text' && (
        <div className="text-editor-wrap">
          <p className="text-editor-note muted">
            Note: values in header and data rows should be comma delimited.
          </p>
          <div className="text-editor-container">
            <div className="text-editor-lines" ref={lineNumRef} aria-hidden="true">
              {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onScroll={syncScroll}
              readOnly={readOnly}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Lookup file content"
            />
          </div>
        </div>
      )}

      {/* ── Bottom toolbar ── */}
      <div className="editor-bottom-toolbar">
        {mode === 'table' && !readOnly && (
          <div className="editor-row-actions">
            <button className="btn btn--sm btn--ghost" onClick={addRow}>Add Row</button>
            <button
              className="btn btn--sm btn--ghost"
              onClick={deleteSelected}
              disabled={selectedRows.size === 0}
            >
              {selectedRows.size > 0 ? `Delete Row${selectedRows.size > 1 ? 's' : ''} (${selectedRows.size})` : 'Delete Row'}
            </button>
          </div>
        )}
        <div className="editor-file-actions">
          {!readOnly && (
            <>
              <button className="btn btn--sm btn--ghost" onClick={() => replaceInputRef.current?.click()}>
                Replace File
              </button>
              <input
                ref={replaceInputRef}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleReplace}
                style={{ display: 'none' }}
                aria-hidden="true"
              />
            </>
          )}
          <button className="btn btn--sm btn--ghost" onClick={handleDownload}>
            Download File
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.5 }}>
      <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
