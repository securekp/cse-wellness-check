// Export a completed run as the customer-facing deliverable — Markdown (rich)
// or CSV (recreates the Excel checklist columns).

import { CATEGORIES, CHECKS } from './checks/catalog';
import type { Check, CheckState, RunReport } from './types';

function checkById(id: string): Check | undefined {
  return CHECKS.find((c) => c.id === id);
}

function statusIcon(s: CheckState): string {
  switch (s.result.status) {
    case 'pass':
      return '✅';
    case 'warn':
      return '⚠️';
    case 'fail':
      return '❌';
    case 'na':
      return '➖';
    case 'error':
      return '⁉️';
    default:
      return '📝';
  }
}

function evidenceText(s: CheckState): string {
  const ev = s.result.evidence;
  if (!ev) return '';
  let out = ev.summary;
  if (ev.measured) out += ` (measured: ${ev.measured})`;
  if (ev.items?.length) out += '\n' + ev.items.map((i) => `  • ${i}`).join('\n');
  return out;
}

export function toMarkdown(report: RunReport): string {
  const name = report.group.name ?? report.group.id;
  const date = report.generatedAt.slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Cribl Cloud Wellness Review — ${name}`);
  lines.push('');
  lines.push(`**Worker Group:** ${name} (\`${report.group.id}\`)`);
  lines.push(`**Date completed:** ${date}`);
  lines.push('');

  // Summary counts.
  const counts = { pass: 0, warn: 0, fail: 0, manual: 0, na: 0, error: 0 };
  for (const s of report.states) counts[s.result.status]++;
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `✅ ${counts.pass} pass · ⚠️ ${counts.warn} warn · ❌ ${counts.fail} fail · 📝 ${counts.manual} manual · ➖ ${counts.na} N/A`,
  );
  lines.push('');

  for (const category of CATEGORIES) {
    const states = report.states.filter((s) => checkById(s.checkId)?.category === category);
    if (!states.length) continue;
    lines.push(`## ${category}`);
    lines.push('');
    for (const s of states) {
      const check = checkById(s.checkId);
      if (!check) continue;
      lines.push(`### ${statusIcon(s)} ${check.question}`);
      lines.push('');
      lines.push(`- **Customer Status:** ${s.customerStatus || '—'}`);
      const ev = evidenceText(s);
      if (ev) {
        lines.push(`- **Finding:** ${ev.split('\n')[0]}`);
        for (const extra of ev.split('\n').slice(1)) lines.push(`  ${extra.trim()}`);
      }
      if (s.notes.trim()) lines.push(`- **Notes:** ${s.notes.trim()}`);
      if (check.description) {
        lines.push(`- **Best Practice & Implications:**`);
        for (const dl of check.description.split('\n')) lines.push(`  > ${dl}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function csvCell(v: string): string {
  const needsQuote = /[",\n]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

// Recreates the Excel "Step 3 Checklist" columns.
export function toCsv(report: RunReport): string {
  const header = [
    'Category',
    'Best Practice',
    'Customer Status?',
    'Automated Finding',
    'Additional Notes',
    'Best Practice Description and Implications',
  ];
  const rows: string[] = [header.map(csvCell).join(',')];
  for (const category of CATEGORIES) {
    for (const s of report.states.filter((st) => checkById(st.checkId)?.category === category)) {
      const check = checkById(s.checkId);
      if (!check) continue;
      rows.push(
        [
          category,
          check.question,
          s.customerStatus,
          evidenceText(s),
          s.notes,
          check.description ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return rows.join('\n');
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportReport(report: RunReport, format: 'md' | 'csv'): void {
  const name = (report.group.name ?? report.group.id).replace(/[^a-z0-9]+/gi, '-');
  const date = report.generatedAt.slice(0, 10);
  if (format === 'md') {
    downloadFile(`${name}-wellness-review-${date}.md`, toMarkdown(report), 'text/markdown');
  } else {
    downloadFile(`${name}-wellness-review-${date}.csv`, toCsv(report), 'text/csv');
  }
}
