import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
export default function (pi: ExtensionAPI) {
  pi.registerCommand('fixture-skill', {
    description: 'Submit deterministic skill envelope',
    handler: async args => {
      pi.sendUserMessage(
        `<skill name="review" location="/fixture/SKILL.md">\nInspect every change carefully.\n</skill>${args.trim() === 'only' ? '' : '\n\nCheck the fixture.'}`,
      );
    },
  });
}
