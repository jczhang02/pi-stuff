import {Effect, Record} from 'effect';
import {Labels, WorkflowInput} from './contracts';
import {decodeJson, decodeYaml} from './parse';

// Fixtures use the production codecs. These helpers require the portions each
// mutation test edits, so a broken fixture fails during setup, not by accident.
export function labelsFixture(text: string) {
  const labels = Effect.runSync(decodeJson(text, Labels));
  return labels.map(label => {
    if (!label) throw new Error('Fixture needs a label mapping');
    return label;
  });
}
export function workflowFixture(text: string) {
  const data = Effect.runSync(decodeYaml(text, WorkflowInput));
  if (!data) throw new Error('Fixture needs a workflow mapping');
  const job = data.jobs?.checks;
  const pr = data.on?.pull_request;
  if (!data.on || !pr || !data.permissions || !data.jobs || !job?.steps)
    throw new Error('Fixture needs triggers, permissions, jobs and steps');
  const steps = job.steps.map(step => {
    if (!step) throw new Error('Fixture needs a step mapping');
    return step;
  });
  const checks = {...job, steps};
  const jobs = Record.map(data.jobs, item => (item === job ? checks : item));
  return {
    ...data,
    on: {...data.on, pull_request: pr},
    permissions: data.permissions,
    jobs: {...jobs, checks},
  };
}
