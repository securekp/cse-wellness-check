// Orchestrate a wellness run: load deployment data, evaluate every check,
// and produce initial CheckState (with suggested customer status pre-filled).

import { loadDeploymentContext } from '../api';
import type { CheckResult, CheckState, DeploymentContext, RunReport, WorkerGroup } from '../types';
import { CHECKS } from './catalog';

function initialState(checkId: string, result: CheckResult): CheckState {
  return {
    checkId,
    result,
    customerStatus: result.suggestedCustomerStatus,
    notes: '',
  };
}

export async function runWellnessCheck(group: WorkerGroup): Promise<RunReport> {
  const ctx: DeploymentContext = await loadDeploymentContext(group);

  const states: CheckState[] = CHECKS.map((check) => {
    // On-prem-only checks are auto-marked N/A for Cribl.Cloud groups.
    if (check.onPremOnly && ctx.isCloud) {
      return initialState(check.id, {
        status: 'na',
        suggestedCustomerStatus: 'N/A',
        evidence: { summary: 'On-prem-only check — not applicable to this Cribl.Cloud group.' },
      });
    }

    if (check.mode === 'manual' || !check.evaluator) {
      return initialState(check.id, {
        status: 'manual',
        suggestedCustomerStatus: '',
        evidence: { summary: 'Manual review required — see “How to check”.' },
      });
    }

    try {
      return initialState(check.id, check.evaluator(ctx));
    } catch (err) {
      return initialState(check.id, {
        status: 'error',
        suggestedCustomerStatus: '',
        evidence: { summary: `Evaluator error: ${(err as Error).message}` },
      });
    }
  });

  return {
    group,
    generatedAt: new Date().toISOString(),
    states,
  };
}
