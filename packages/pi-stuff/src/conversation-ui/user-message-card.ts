import {
	type MarkdownTransformer,
	type parseSkillBlock,
	SkillInvocationMessageComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	type Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { sanitizeOneLine } from "./terminal-text.js";
import { TRANSCRIPT_CONTINUATION } from "./transcript.js";

type SkillBlock = NonNullable<ReturnType<typeof parseSkillBlock>>;

export interface UserMessageCardOptions {
	readonly markdownTheme: MarkdownTheme;
	readonly outputPad: number;
	readonly transformers: readonly MarkdownTransformer[];
	readonly skill: SkillBlock | null;
	readonly fallback: Container;
	readonly fail: (error: Error) => void;
}

function nativeBody(message: UserMessageComponent) {
	const box = message.children[0];
	const markdown = box instanceof Box ? box.children[0] : undefined;
	if (
		message.children.length !== 1 ||
		!(box instanceof Box) ||
		box.children.length !== 1 ||
		!(markdown instanceof Markdown)
	) {
		throw new Error("User Message presentation requires the certified Pi UserMessageComponent layout");
	}
	return { box, markdown };
}

// This only chooses label placement; Pi still parses and renders the untouched Markdown.
function startsBlock(prompt: string): boolean {
	const [first = "", second = ""] = prompt.trimStart().split("\n", 2);
	return (
		/^(?:#{1,6}(?:\s|$)|>|`{3,}|~{3,}|[-+*](?:\s|$)|\d{1,9}[.)]\s|[_<|])/.test(first) ||
		/^\s*(?:[=-]+|[| :-]+)\s*$/.test(second)
	);
}

class PromptContent implements Component {
	private readonly markdown: Markdown;
	private readonly skill: SkillBlock | null;
	private readonly style: MarkdownTheme;
	private readonly marker: boolean;
	private cachedWidth: number | undefined;
	private cachedRows: string[] | undefined;

	constructor(markdown: Markdown, skill: SkillBlock | null, style: MarkdownTheme, marker = true) {
		this.markdown = markdown;
		this.skill = skill;
		this.style = style;
		this.marker = marker;
	}

	invalidate(): void {
		this.cachedRows = undefined;
		this.markdown.invalidate();
	}

	render(width: number): string[] {
		if (this.cachedRows && this.cachedWidth === width) return this.cachedRows;
		if (width <= 2) return width > 0 && this.marker ? [""] : [];
		const rows = [...this.markdown.render(width - 2)];
		if (this.skill) {
			const label = this.style.quote(`[skill] ${sanitizeOneLine(this.skill.name)}`);
			const first = startsBlock(this.skill.userMessage ?? "") ? "" : (rows.shift() ?? "");
			rows.unshift(...wrapTextWithAnsi(`${label}${first ? ` ${first}` : ""}`, width - 2));
		}
		this.cachedWidth = width;
		this.cachedRows = rows.map(
			(row, index) => `${index === 0 && this.marker ? `${this.style.quote("")} ` : TRANSCRIPT_CONTINUATION}${row}`,
		);
		return this.cachedRows;
	}
}

/** Native card and terminal markers, with one prompt gutter and optional inline Skill detail. */
export class UserMessageCard extends UserMessageComponent {
	private expanded = false;
	private padding: number;
	private failed = false;
	private readonly options: UserMessageCardOptions;

	constructor(prompt: string, options: UserMessageCardOptions) {
		super(prompt, options.markdownTheme, options.outputPad, options.transformers);
		this.options = options;
		this.padding = options.outputPad;
		this.compose();
	}

	private compose(): void {
		const { box, markdown } = nativeBody(this);
		box.clear();
		box.addChild(new PromptContent(markdown, this.options.skill, this.options.markdownTheme));
		if (this.expanded && this.options.skill) {
			box.addChild(new Spacer(1));
			box.addChild(
				new Markdown("Skill instructions", 2, 0, this.options.markdownTheme, {
					color: this.options.markdownTheme.quote,
				}),
			);
			const instructions = new UserMessageComponent(this.options.skill.content, this.options.markdownTheme, 0);
			box.addChild(new PromptContent(nativeBody(instructions).markdown, null, this.options.markdownTheme, false));
		}
	}

	setExpanded(expanded: boolean): void {
		if (!this.options.skill || this.expanded === expanded) return;
		this.expanded = expanded;
		for (const child of this.options.fallback.children) {
			if (child instanceof SkillInvocationMessageComponent) child.setExpanded(expanded);
		}
		this.setOutputPad(this.padding);
	}

	override setOutputPad(padding: number): void {
		this.padding = padding;
		for (const child of this.options.fallback.children) {
			if (child instanceof UserMessageComponent) child.setOutputPad(padding);
		}
		if (this.failed) return;
		try {
			super.setOutputPad(padding);
			this.compose();
		} catch (error) {
			this.recover(error instanceof Error ? error : new Error("User Message layout failed"));
		}
	}

	private recover(error: Error): void {
		if (this.failed) return;
		this.failed = true;
		this.options.fail(error);
	}

	override invalidate(): void {
		super.invalidate();
		this.options.fallback.invalidate();
	}

	override render(width: number): string[] {
		if (!this.failed) {
			try {
				return super.render(width);
			} catch (error) {
				this.recover(error instanceof Error ? error : new Error("User Message rendering failed"));
			}
		}
		return this.options.fallback.render(width);
	}
}
