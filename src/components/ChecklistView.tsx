import { Collapse, Pill, Text } from '@capra/core';
import { CATEGORIES, CHECKS } from '../checks/catalog';
import type { Check, CheckState, CheckStatus, CustomerStatus } from '../types';

interface Props {
  states: CheckState[];
  onUpdate: (checkId: string, patch: Partial<Pick<CheckState, 'customerStatus' | 'notes'>>) => void;
}

const STATUS_PILL: Record<
  CheckStatus,
  { label: string; appearance: 'success' | 'warning' | 'danger' | 'default' }
> = {
  pass: { label: 'Pass', appearance: 'success' },
  warn: { label: 'Warn', appearance: 'warning' },
  fail: { label: 'Fail', appearance: 'danger' },
  manual: { label: 'Manual', appearance: 'default' },
  na: { label: 'N/A', appearance: 'default' },
  error: { label: 'Error', appearance: 'danger' },
};

const CUSTOMER_OPTIONS: CustomerStatus[] = ['YES', 'NO', 'N/A'];

function checkById(id: string): Check | undefined {
  return CHECKS.find((c) => c.id === id);
}

// Split a description into paragraphs, linkifying bare URLs.
function renderText(text: string) {
  return text.split('\n').map((line, i) => (
    <Text key={i} as="p" variant="body-sm-normal" color="subtle">
      {linkify(line)}
    </Text>
  ));
}

function linkify(line: string) {
  const parts = line.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function ChecklistView({ states, onUpdate }: Props) {
  return (
    <div className="checklist">
      {CATEGORIES.map((category) => {
        const rows = states.filter((s) => checkById(s.checkId)?.category === category);
        if (!rows.length) return null;
        return (
          <section key={category} className="checklist-category">
            <Text as="h3" variant="heading-sm">
              {category}
            </Text>
            {rows.map((s) => (
              <CheckRow key={s.checkId} state={s} onUpdate={onUpdate} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function CheckRow({
  state,
  onUpdate,
}: {
  state: CheckState;
  onUpdate: Props['onUpdate'];
}) {
  const check = checkById(state.checkId);
  if (!check) return null;
  const pill = STATUS_PILL[state.result.status];
  const ev = state.result.evidence;

  return (
    <div className="check-row">
      <div className="check-head">
        <Pill appearance={pill.appearance} variant="bold">
          {pill.label}
        </Pill>
        <Text variant="body-sm-semibold">{check.question}</Text>
        {check.onPremOnly && (
          <Pill appearance="default" variant="outline">
            on-prem only
          </Pill>
        )}
      </div>

      {ev && (
        <div className="check-finding">
          <Text variant="body-sm-normal">
            {ev.summary}
            {ev.measured ? ` (measured: ${ev.measured})` : ''}
          </Text>
          {ev.items && ev.items.length > 0 && (
            <ul className="finding-items">
              {ev.items.map((it, i) => (
                <li key={i}>
                  <Text as="span" variant="body-sm-normal" color="subtle">
                    {it}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="check-controls">
        <div className="status-toggle" role="group" aria-label="Customer status">
          {CUSTOMER_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`status-btn ${state.customerStatus === opt ? 'active' : ''}`}
              onClick={() =>
                onUpdate(state.checkId, {
                  customerStatus: state.customerStatus === opt ? '' : opt,
                })
              }
            >
              {opt}
            </button>
          ))}
        </div>
        <input
          className="notes-input"
          type="text"
          placeholder="Additional notes…"
          value={state.notes}
          onChange={(e) => onUpdate(state.checkId, { notes: e.target.value })}
        />
      </div>

      {(check.howTo || check.description) && (
        <div className="check-details">
          <Collapse title="Guidance & best practice">
            <div className="details-body">
              {check.howTo && (
                <div className="details-section">
                  <Text variant="body-sm-semibold">How to check</Text>
                  {renderText(check.howTo)}
                </div>
              )}
              {check.description && (
                <div className="details-section">
                  <Text variant="body-sm-semibold">Best practice &amp; implications</Text>
                  {renderText(check.description)}
                </div>
              )}
            </div>
          </Collapse>
        </div>
      )}
    </div>
  );
}
