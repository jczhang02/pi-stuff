import {
  UserMessageComponent,
  type MarkdownTransformer,
  type ParsedSkillBlock,
} from '@earendil-works/pi-coding-agent';
import {
  Box,
  Spacer,
  type MarkdownTheme,
  MouseRegion,
} from '@earendil-works/pi-tui';

export class SkillMessageCard extends UserMessageComponent {
  private expanded = false;
  private padding: number;
  constructor(
    private readonly skill: ParsedSkillBlock,
    private readonly style: MarkdownTheme,
    padding: number,
    transformers: readonly MarkdownTransformer[],
  ) {
    const label = `/skill:${skill.name}`;
    const prompt = skill.userMessage ?? '';
    const block = /^(?: {4}| {0,3}(?:[-+*] |\d+[.)] |[>#`~]|\|))/u.test(prompt);
    super(
      label + (prompt ? (block ? '\n\n' : ' ') + prompt : ''),
      style,
      padding,
      transformers,
    );
    this.padding = padding;
    this.setOutputPad(padding);
  }
  setExpanded(expanded: boolean) {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.setOutputPad(this.padding);
  }
  override setOutputPad(padding: number) {
    this.padding = padding;
    super.setOutputPad(padding);
    const box = this.children[0];
    if (!(box instanceof Box)) return;
    if (this.expanded) {
      const instructions = new UserMessageComponent(
        'Skill instructions\n\n' + this.skill.content,
        this.style,
        0,
      );
      const body = instructions.children[0];
      if (!(body instanceof Box)) return;
      box.addChild(new Spacer(1));
      for (const child of body.children) box.addChild(child);
    }
    this.clear();
    this.addChild(
      new MouseRegion(box, event => {
        if (event.type !== 'click' || event.button !== 'left' || event.y !== 1)
          return;
        this.setExpanded(!this.expanded);
        return {handled: true};
      }),
    );
  }
}
