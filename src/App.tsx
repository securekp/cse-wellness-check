import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Menu, Spinner, Text } from '@capra/core';
import { ChevronDown } from '@capra/icons';
import { GroupSelector } from './components/GroupSelector';
import { SummaryBar } from './components/SummaryBar';
import { ChecklistView } from './components/ChecklistView';
import { runWellnessCheck } from './checks/run';
import { exportReport } from './report';
import type { CheckState, RunReport, WorkerGroup } from './types';

function App() {
  const [report, setReport] = useState<RunReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async (group: WorkerGroup) => {
    setRunning(true);
    setError(null);
    try {
      const result = await runWellnessCheck(group);
      setReport(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }, []);

  const handleUpdate = useCallback(
    (checkId: string, patch: Partial<Pick<CheckState, 'customerStatus' | 'notes'>>) => {
      setReport((prev) =>
        prev
          ? {
              ...prev,
              states: prev.states.map((s) => (s.checkId === checkId ? { ...s, ...patch } : s)),
            }
          : prev,
      );
    },
    [],
  );

  const groupName = useMemo(
    () => (report ? report.group.name ?? report.group.id : ''),
    [report],
  );

  return (
    <div className="app">
      <header className="app-header">
        <Text as="h1" variant="heading-lg">
          CSE Wellness Check
        </Text>
        <Text variant="body-sm-normal" color="subtle">
          Cribl Cloud health &amp; wellness review — automated best-practice checks with a
          customer-ready deliverable.
        </Text>
      </header>

      <main className="app-main">
        <GroupSelector onRun={handleRun} running={running} />

        {error && (
          <Alert appearance="danger" title="Could not complete the review">
            {error}
          </Alert>
        )}

        {running && !report && (
          <div className="loading-row">
            <Spinner size="sm" /> <Text variant="body-sm-normal">Evaluating checks…</Text>
          </div>
        )}

        {report && (
          <div className="report">
            <div className="report-header">
              <div>
                <Text as="h2" variant="heading-md">
                  {groupName}
                </Text>
                <Text variant="body-sm-normal" color="subtle">
                  Reviewed {report.generatedAt.slice(0, 10)}
                </Text>
              </div>
              <Menu
                trigger={
                  <Button variant="secondary" trailingIcon={ChevronDown}>
                    Export
                  </Button>
                }
              >
                <Menu.Item label="Markdown (.md)" onPress={() => exportReport(report, 'md')} />
                <Menu.Item label="CSV (.csv)" onPress={() => exportReport(report, 'csv')} />
              </Menu>
            </div>

            <SummaryBar states={report.states} />
            <ChecklistView states={report.states} onUpdate={handleUpdate} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
