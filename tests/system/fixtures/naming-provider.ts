import type {ModelRequest} from './pi-terminal';

export function modelResponse(title: string, finishReason = 'stop') {
  return new Response(
    `data: ${JSON.stringify({
      id: 'naming',
      object: 'chat.completion.chunk',
      choices: [
        {index: 0, delta: {content: title}, finish_reason: finishReason},
      ],
    })}\n\ndata: [DONE]\n\n`,
    {headers: {'content-type': 'text/event-stream'}},
  );
}

// Only the remote model is controlled. Pi still owns commands and session state.
export class NamingProvider {
  constructor(private readonly modelId = 'naming') {}
  readonly requests: ModelRequest[] = [];
  title = 'research: Investigate RTK command output';
  held = false;
  private pending: Array<() => void> = [];

  reply = async (body: ModelRequest, signal: AbortSignal) => {
    if (body.model !== this.modelId) return undefined;
    this.requests.push(body);
    if (this.held)
      await new Promise<void>(resolve => {
        this.pending.push(resolve);
        signal.addEventListener('abort', () => resolve(), {once: true});
      });
    return modelResponse(this.title);
  };

  release() {
    this.held = false;
    for (const resolve of this.pending.splice(0)) resolve();
  }
}
