import {Record} from 'effect';
import type {
  ActionInputs,
  IssueConfig,
  LabelInput,
  PackageInput,
  Permissions,
  Template,
  WorkflowInput,
} from './contracts';
import {REQUIRED_SCRIPTS} from './contracts';
import {trimWhitespace} from './text';

function mapping<T>(
  value: T | null | undefined,
  message = 'expected a mapping',
): T {
  if (value == null) throw new Error(message);
  return value;
}

export function checkLabels(value: typeof LabelInput.Type): Set<string> {
  if (!value) throw new Error('label manifest must be a list');
  const names = new Set<string>();
  for (const item of value) {
    const label = mapping(item);
    if (!label.name || names.has(label.name.toLowerCase()))
      throw new Error('invalid or duplicate label name');
    // JavaScript lowercasing does not perform full Unicode case folding (ß to ss).
    names.add(label.name.toLowerCase());
    if (label.color == null || !/^[0-9a-f]{6}$/i.test(label.color))
      throw new Error(`invalid color for ${label.name}`);
    if (label.description == null || [...label.description].length > 100)
      throw new Error(`invalid description for ${label.name}`);
  }
  for (const name of [
    'needs-triage',
    'needs-info',
    'ready-for-agent',
    'ready-for-human',
    'wontfix',
  ]) {
    if (!names.has(name)) throw new Error('missing canonical triage labels');
  }
  return names;
}

export function checkTemplateData(
  value: typeof Template.Type,
  labelNames: Set<string>,
): void {
  const data = mapping(value);
  for (const [key, value] of [
    ['name', data.name],
    ['about', data.about],
  ]) {
    if (value == null || !trimWhitespace(value))
      throw new Error(`missing template ${key}`);
  }
  if (!data.labels || data.labels.some(label => !labelNames.has(label)))
    throw new Error('template labels must be a list of known labels');
  if (!data.labels.includes('needs-triage'))
    throw new Error('new issues must have needs-triage');
}

function sameKeys(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    expected.every(key => actual.includes(key))
  );
}
function readOnly(value: typeof Permissions.Type | null | undefined): boolean {
  const permissions = mapping(value, 'CI must use contents: read');
  return (
    sameKeys(Object.keys(permissions), ['contents']) &&
    permissions.contents === 'read'
  );
}
const PR_EVENTS = [
  'opened',
  'synchronize',
  'reopened',
  'edited',
  'ready_for_review',
  'converted_to_draft',
];
const REQUIRED_COMMANDS = [
  'bun install --frozen-lockfile --ignore-scripts',
  'bun run format:check',
  'bun run lint',
  'bun run typecheck',
  'bun run test',
  'bun run check:repo',
  'bun run check:pr',
];

function pinnedBun(
  inputs: typeof ActionInputs.Type | null | undefined,
): boolean {
  const data = mapping(inputs);
  return (
    sameKeys(Object.keys(data), ['bun-version-file']) &&
    data['bun-version-file'] === 'package.json'
  );
}

export function checkWorkflow(value: typeof WorkflowInput.Type): void {
  const data = mapping(value, 'workflow must be a mapping');
  const events = mapping(data.on, 'CI must run on every pull request');
  if (!Object.hasOwn(events, 'pull_request'))
    throw new Error('CI must run on every pull request');
  if (
    Object.keys(events).some(
      key => !['pull_request', 'push', 'workflow_dispatch'].includes(key),
    )
  )
    throw new Error('CI has an unexpected or privileged trigger');
  const prEvents = mapping(events.pull_request);
  if (!sameKeys(Object.keys(prEvents), ['types']))
    throw new Error(
      'required PR CI must declare evidence events without branch or path filters',
    );
  const eventTypes = prEvents.types;
  if (
    !eventTypes ||
    eventTypes.length !== PR_EVENTS.length ||
    !PR_EVENTS.every(event => eventTypes.includes(event))
  )
    throw new Error(
      'PR CI must run for code/body updates and both draft/readiness transitions',
    );
  if (!readOnly(data.permissions))
    throw new Error('CI must use contents: read');
  const jobs = mapping(data.jobs, 'CI must expose a checks job');
  const required = mapping(jobs.checks, 'CI must expose a checks job');
  if (
    required.name !== 'checks' ||
    'if' in required ||
    'continue-on-error' in required
  )
    throw new Error(
      'required checks job must have a stable name and run unconditionally',
    );
  for (const item of Object.values(jobs)) {
    const job = mapping(item);
    if (job['runs-on'] !== 'ubuntu-24.04')
      throw new Error('CI must use the approved GitHub-hosted runner');
    const timeout = job['timeout-minutes'];
    if (
      timeout == null ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 30
    )
      throw new Error('CI jobs need a timeout of 1-30 minutes');
    if ('permissions' in job && !readOnly(job.permissions))
      throw new Error('CI jobs must not expand token permissions');
    if (!job.steps?.length) throw new Error('CI jobs need steps');
    const steps = job.steps.map(step => mapping(step));
    if (job === required) {
      for (const command of REQUIRED_COMMANDS) {
        const matching = steps.filter(step => step.run === command);
        if (
          matching.length !== 1 ||
          ['if', 'continue-on-error', 'env'].some(key => key in matching[0]!)
        )
          throw new Error(
            `checks must run ${command} unconditionally without overrides`,
          );
      }
      const setup = steps.filter(step =>
        step.uses?.startsWith('oven-sh/setup-bun@'),
      );
      if (setup.length !== 1 || !pinnedBun(setup[0]!.with))
        throw new Error(
          'CI must install the Bun version pinned in package.json',
        );
    }
    for (const step of steps) {
      const action = step.uses;
      if (
        action !== undefined &&
        (action === null || !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(action))
      )
        throw new Error('external actions must be pinned to a full commit SHA');
      if (
        action?.startsWith('actions/checkout@') &&
        mapping(step.with)['persist-credentials'] !== false
      )
        throw new Error('checkout must not persist credentials');
    }
  }
}

export function checkToolchain(value: typeof PackageInput.Type): void {
  const data = mapping(value);
  if (!data.packageManager || !/^bun@\d+\.\d+\.\d+$/.test(data.packageManager))
    throw new Error('packageManager must pin an exact Bun version');
  if (mapping(data.engines).bun !== data.packageManager.slice(4))
    throw new Error('engines.bun must match packageManager');
  const scripts = mapping(data.scripts);
  for (const name of Record.keys(REQUIRED_SCRIPTS)) {
    const command = REQUIRED_SCRIPTS[name];
    if (scripts[name] !== command)
      throw new Error(`script ${name} must run ${command}`);
  }
  const dependencies = mapping(data.dependencies);
  const tooling = mapping(data.devDependencies);
  if (
    !dependencies.effect ||
    !/^4\.\d+\.\d+(?:-rc\.\d+)?$/.test(dependencies.effect)
  )
    throw new Error('Effect must pin v4; RC versions are explicitly supported');
  for (const version of Object.values(tooling)) {
    if (version === null || !/^\d+\.\d+\.\d+$/.test(version))
      throw new Error('direct tooling dependencies must use exact versions');
  }
  if (tooling.oxlint !== tooling['@oxlint/plugins'])
    throw new Error('Oxlint and its plugin API must have matching versions');
}

export function checkIssueConfig(value: typeof IssueConfig.Type): void {
  if (mapping(value).blank_issues_enabled !== true)
    throw new Error('keep blank issues available');
}
