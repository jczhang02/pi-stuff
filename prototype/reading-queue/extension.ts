import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';

interface Article {
  title: string;
  read: boolean;
}

const articles: Article[] = [
  {title: 'The Case for Smaller, Smarter AI Models', read: false},
  {title: '中国科研团队发布新一代可解释性人工智能方法', read: false},
  {title: 'A Field Guide to Reliable Retrieval Systems', read: false},
];

function updateStatus(ctx: ExtensionContext): void {
  const readCount = articles.filter(article => article.read).length;
  ctx.ui.setStatus('reading', `reading=${readCount}/${articles.length}`);
}

export default function (pi: ExtensionAPI): void {
  pi.on('session_start', async (_event, ctx) => {
    updateStatus(ctx);
    ctx.ui.notify('Reading queue ready. Use /reading.', 'info');
  });

  pi.registerCommand('reading', {
    description: 'Open the reading queue',
    handler: async (_args, ctx) => {
      const options = articles.map(
        article => `${article.read ? 'Read' : 'Unread'} - ${article.title}`,
      );
      const selected = await ctx.ui.select('Reading queue', options);
      if (!selected) return;

      const article = articles[options.indexOf(selected)];
      if (!article || article.read) return;

      const confirmed = await ctx.ui.confirm(
        'Mark article as read?',
        article.title,
      );
      if (!confirmed) return;

      article.read = true;
      updateStatus(ctx);
      ctx.ui.notify(`Marked as read: ${article.title}`, 'info');
    },
  });
}
