import {WebError} from './errors';

const ITEM_BYTES = 1024 * 1024;
const CACHE_BYTES = 32 * ITEM_BYTES;
export const OUTPUT_BYTES = 32 * 1024;

// Offset arithmetic is UTF-16; only the output/storage budgets use UTF-8.
function fitEnd(
  text: string,
  start: number,
  end: number,
  bytes: number,
): number {
  let low = start;
  let high = end;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(start, mid)) <= bytes) low = mid;
    else high = mid - 1;
  }
  // Explicit limits count UTF-16 units, even inside a surrogate pair.
  // Preserve pairs only when the byte budget shortens the requested range.
  const last = text.charCodeAt(low - 1);
  const next = text.charCodeAt(low);
  if (
    low > start &&
    low < end &&
    last >= 0xd800 &&
    last <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  )
    low--;
  return low;
}

export class Content {
  private readonly entries = new Map<string, string>();
  private bytes = 0;

  store(text: string): string {
    const bytes = Buffer.byteLength(text);
    if (bytes > ITEM_BYTES)
      throw new WebError({
        kind: 'content',
        message: 'Retained text exceeds 1 MiB.',
      });
    while (this.entries.size >= 64 || this.bytes + bytes > CACHE_BYTES) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.bytes -= Buffer.byteLength(oldest[1]);
    }
    const id = crypto.randomUUID();
    this.entries.set(id, text);
    this.bytes += bytes;
    return id;
  }

  private get(id: string): string {
    const text = this.entries.get(id);
    if (text === undefined)
      throw new WebError({
        kind: 'unavailable',
        message: 'Content unavailable. Search or fetch again.',
      });
    return text;
  }

  page(id: string, offset = 0, limit = 8000, budget = OUTPUT_BYTES): string {
    const text = this.get(id);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > text.length ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20000
    ) {
      throw new WebError({
        kind: 'input',
        message: 'Invalid paging offset or limit.',
      });
    }
    const end = fitEnd(
      text,
      offset,
      Math.min(text.length, offset + limit),
      budget - 256,
    );
    return `contentId: ${id}\noffset: ${offset}\nnextOffset: ${end}\ntotalLength: ${text.length}\ntruncated: ${end < text.length}\n\n${text.slice(offset, end)}`;
  }

  find(id: string, term: string): string {
    if (term.length === 0 || term.length > 200)
      throw new WebError({
        kind: 'input',
        message: 'Find requires 1-200 UTF-16 code units.',
      });
    const text = this.get(id);
    // Escape all metacharacters: the tool accepts a literal, never a regex.
    // RegExp reports original UTF-16 indices, unlike a length-changing lowercase copy.
    const pattern = new RegExp(
      term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'giu',
    );
    const excerpts: string[] = [];
    let more = false;
    for (const match of text.matchAll(pattern)) {
      if (excerpts.length === 10) {
        more = true;
        break;
      }
      const start = Math.max(0, match.index - 200);
      const end = Math.min(text.length, match.index + match[0].length + 200);
      excerpts.push(`position: ${match.index}\n${text.slice(start, end)}`);
    }
    return `contentId: ${id}\ntotalLength: ${text.length}\nmoreMatches: ${more}\n\n${excerpts.join('\n\n')}`;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
