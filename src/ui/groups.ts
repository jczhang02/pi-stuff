import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionStartEvent,
  SessionTreeEvent,
} from '@earendil-works/pi-coding-agent';

interface Group {
  members: Set<Call>;
  leader: Call;
  open: boolean;
  counts: Map<string, number>;
}
interface Call {
  id: string;
  order: number;
  label: string;
  previous: Call | undefined;
  next?: Call;
  group?: Group;
  finished: boolean;
}

// A view-only index. Adjacent completed calls join without copying output or
// scanning history on each streamed update. Pending/failed calls separate runs.
export class RetrievalGroups {
  private readonly calls = new Map<string, Call>();
  private readonly labels = new Map([
    ['read', 'Read'],
    ['grep', 'Grep'],
    ['find', 'Find'],
    ['ls', 'Ls'],
    ['web_search', 'WebSearch'],
    ['fetch_content', 'WebFetch'],
    ['get_search_content', 'WebRead'],
  ]);
  private tail: Call | undefined;
  private expanded = () => false;

  constructor(pi: ExtensionAPI) {
    const reset = () => {
      this.calls.clear();
      this.tail = undefined;
      this.expanded = () => false;
    };
    const restore = (
      _event: SessionStartEvent | SessionTreeEvent,
      ctx: ExtensionContext,
    ) => {
      reset();
      this.expanded = () => ctx.ui.getToolsExpanded();
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === 'message') this.message(entry.message);
        else if (entry.type === 'branch_summary' || entry.type === 'compaction')
          this.tail = undefined;
      }
    };
    pi.on('session_start', restore);
    // Pi may render old components between shutdown and the next session_start.
    // Drop the old context before it becomes stale during session replacement.
    pi.on('session_shutdown', reset);
    pi.on('session_tree', restore);
    pi.on('message_end', event => this.message(event.message));
  }

  private message(message: MessageEndEvent['message']): void {
    if (message.role === 'toolResult') return;
    if (message.role !== 'assistant') {
      this.tail = undefined;
      return;
    }
    for (const block of message.content) {
      if (block.type !== 'toolCall') {
        if (
          (block.type === 'text' && block.text.trim()) ||
          (block.type === 'thinking' && block.thinking.trim())
        )
          this.tail = undefined;
        continue;
      }
      const label = this.labels.get(block.name);
      if (!label) {
        this.tail = undefined;
        continue;
      }
      if (this.calls.has(block.id)) continue;
      const call: Call = {
        id: block.id,
        order: this.calls.size,
        label,
        finished: false,
        previous: this.tail,
      };
      if (this.tail) this.tail.next = call;
      this.calls.set(block.id, call);
      this.tail = call;
    }
  }

  finish(id: string, eligible: boolean): void {
    const call = this.calls.get(id);
    if (!call || call.finished) return;
    call.finished = true;
    if (!eligible) return;
    call.group = {
      members: new Set([call]),
      leader: call,
      open: false,
      counts: new Map([[call.label, 1]]),
    };
    for (const neighbor of [call.previous, call.next]) {
      const adjacent = neighbor?.group;
      const current = call.group;
      if (!adjacent || adjacent === current) continue;
      // Move the smaller membership set, keeping long retrieval runs cheap.
      const [large, small] =
        current.members.size >= adjacent.members.size
          ? [current, adjacent]
          : [adjacent, current];
      for (const member of small.members) {
        member.group = large;
        large.members.add(member);
      }
      for (const [label, count] of small.counts)
        large.counts.set(label, (large.counts.get(label) ?? 0) + count);
      if (small.leader.order < large.leader.order) large.leader = small.leader;
      large.open ||= small.open;
    }
  }

  visible(id: string): boolean {
    const group = this.calls.get(id)?.group;
    return !group || group.open || this.expanded();
  }

  summary(id: string): string | undefined {
    const group = this.calls.get(id)?.group;
    if (!group || group.leader.id !== id) return undefined;
    const count = (label: string) => group.counts.get(label) ?? 0;
    const parts: string[] = [];
    const read = count('Read');
    const search = count('Grep') + count('Find');
    const ls = count('Ls');
    const webSearch = count('WebSearch');
    const webRead = count('WebFetch') + count('WebRead');
    if (read) parts.push(`Read ${read} ${read === 1 ? 'file' : 'files'}`);
    if (search)
      parts.push(`Searched ${search} ${search === 1 ? 'pattern' : 'patterns'}`);
    if (ls)
      parts.push(`Listed ${ls} ${ls === 1 ? 'directory' : 'directories'}`);
    if (webSearch)
      parts.push(
        `Searched web ${webSearch} ${webSearch === 1 ? 'time' : 'times'}`,
      );
    if (webRead)
      parts.push(
        `Read web content ${webRead} ${webRead === 1 ? 'time' : 'times'}`,
      );
    return parts.join(' · ');
  }

  toggle(id: string): void {
    const group = this.calls.get(id)?.group;
    if (group) group.open = !group.open;
  }
}
