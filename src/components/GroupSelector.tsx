import { useEffect, useMemo, useState } from 'react';
import { Menu, Button, Alert, Text } from '@capra/core';
import { ChevronDown } from '@capra/icons';
import type { WorkerGroup } from '../types';
import { fetchWorkerGroups } from '../api';

interface Props {
  onRun: (group: WorkerGroup) => void;
  running: boolean;
}

export function GroupSelector({ onRun, running }: Props) {
  const [groups, setGroups] = useState<WorkerGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingGroups(true);
    fetchWorkerGroups()
      .then((g) => {
        setGroups(g);
        if (g.length > 0) setSelectedGroup(g[0].id);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoadingGroups(false));
  }, []);

  const selectedDisplay = useMemo(() => {
    const g = groups.find((x) => x.id === selectedGroup);
    return g ? g.name || g.id : '';
  }, [groups, selectedGroup]);

  const groupLabel = loadingGroups
    ? 'Loading groups…'
    : selectedDisplay || 'Choose a worker group';

  const handleRun = () => {
    const g = groups.find((x) => x.id === selectedGroup);
    if (g) onRun(g);
  };

  return (
    <div className="selector-card">
      <Text as="h2" variant="heading-md">
        Run a wellness review
      </Text>
      <Text variant="body-sm-normal" color="subtle">
        Select a worker group. Automated checks run against the live Cribl APIs; the rest are
        answered manually with in-app guidance.
      </Text>

      {error && (
        <div className="stack-sm">
          <Alert appearance="danger" title="Something went wrong">
            {error}
          </Alert>
        </div>
      )}

      <div className="selector-row">
        <div className="selector-field">
          <Text as="label" variant="body-sm-semibold" color="subtle">
            Worker Group
          </Text>
          <Menu
            trigger={
              <Button
                variant="secondary"
                trailingIcon={ChevronDown}
                disabled={loadingGroups || groups.length === 0}
                block
              >
                {groupLabel}
              </Button>
            }
          >
            {groups.map((g) => (
              <Menu.Item
                key={g.id}
                label={g.name || g.id}
                active={g.id === selectedGroup}
                onPress={() => setSelectedGroup(g.id)}
              />
            ))}
          </Menu>
        </div>

        <div className="analyze-button">
          <Button
            variant="primary"
            onClick={handleRun}
            disabled={running || !selectedGroup}
            pending={running}
          >
            {running ? 'Running…' : 'Run review'}
          </Button>
        </div>
      </div>
    </div>
  );
}
