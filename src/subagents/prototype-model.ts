// Throwaway FleetView prototype contracts. Not a production tool API.
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'skipped';

export interface Activity {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

export interface Steering {
  readonly text: string;
  readonly state: 'pending' | 'consumed' | 'unprocessed';
}

export interface Question {
  readonly id: string;
  readonly text: string;
  readonly answer: string | undefined;
}

export type TaskAction = 'steer' | 'reply' | 'followUp' | 'cancel';

export interface FleetTask {
  readonly id: string;
  readonly description: string;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly elapsedSeconds: number;
  readonly outputTokens: number;
  readonly activity: readonly Activity[];
  readonly steering: readonly Steering[];
  readonly question: Question | undefined;
  readonly result: string | undefined;
  readonly detail: string;
  readonly progress: string;
  readonly model: string;
  readonly actions: readonly TaskAction[];
  readonly parentTaskId: string | undefined;
}

export interface FleetAgent {
  readonly name: string;
  readonly tasks: readonly FleetTask[];
}

export interface FleetController {
  agents(): readonly FleetAgent[];
  steer(taskId: string, text: string): void;
  reply(taskId: string, questionId: string, text: string): void;
  followUp(agentName: string, text: string): void;
  cancel(taskId: string): void;
}
