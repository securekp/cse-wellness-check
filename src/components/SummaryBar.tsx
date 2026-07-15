import { Pill, Text } from '@capra/core';
import type { CheckState, CheckStatus } from '../types';

interface Props {
  states: CheckState[];
}

const PILL: Record<CheckStatus, { label: string; appearance: 'success' | 'warning' | 'danger' | 'default' }> = {
  pass: { label: 'Pass', appearance: 'success' },
  warn: { label: 'Warn', appearance: 'warning' },
  fail: { label: 'Fail', appearance: 'danger' },
  manual: { label: 'Manual', appearance: 'default' },
  na: { label: 'N/A', appearance: 'default' },
  error: { label: 'Error', appearance: 'danger' },
};

const ORDER: CheckStatus[] = ['fail', 'warn', 'pass', 'manual', 'na', 'error'];

export function SummaryBar({ states }: Props) {
  const counts = {} as Record<CheckStatus, number>;
  for (const s of states) counts[s.result.status] = (counts[s.result.status] ?? 0) + 1;

  return (
    <div className="summary-bar">
      <Text variant="body-sm-semibold" color="subtle">
        {states.length} checks
      </Text>
      <div className="summary-pills">
        {ORDER.filter((k) => counts[k]).map((k) => (
          <Pill key={k} appearance={PILL[k].appearance} variant="muted">
            {`${counts[k]} ${PILL[k].label}`}
          </Pill>
        ))}
      </div>
    </div>
  );
}
