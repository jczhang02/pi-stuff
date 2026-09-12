import {expect, test} from 'bun:test';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {Schema} from 'effect';
import {network} from '../../src/pi/network';
import {createWebTools} from '../../src/web/index';

test('runtime transport follows local redirects without retaining response cookies', async () => {
  const paths: string[] = [];
  const cookieHeaders: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? '');
    cookieHeaders.push(request.headers.cookie);
    if (request.url === '/start') {
      response.writeHead(302, {
        location: '/text',
        'set-cookie': 'fixture=session; Path=/',
      });
      response.end();
    } else if (request.url === '/loop') {
      response.writeHead(302, {location: '/loop'});
      response.end();
    } else if (request.url === '/credentials') {
      response.writeHead(302, {location: 'http://user:pass@localhost/'});
      response.end();
    } else {
      response.writeHead(200, {'content-type': 'text/plain'});
      response.end('local fixture text');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const {port} = Schema.decodeUnknownSync(Schema.Struct({port: Schema.Number}))(
    server.address(),
  );
  const base = `http://127.0.0.1:${port}`;
  const web = createWebTools(network);
  try {
    const fetched = await web.fetchContent.execute(
      'local',
      {
        urls: [`${base}/start`],
        mode: 'raw',
      },
      undefined,
    );
    expect(fetched.content[0]?.text).toContain('local fixture text');
    expect(paths).toEqual(['/start', '/text']);
    expect(cookieHeaders).toEqual([undefined, undefined]);
    const rejected = await web.fetchContent.execute(
      'invalid',
      {
        urls: [
          `http://user:pass@127.0.0.1:${port}/`,
          'file:///etc/hosts',
          `${base}/credentials`,
        ],
      },
      undefined,
    );
    expect(rejected.content[0]?.text.match(/error:/g)).toHaveLength(3);
    expect(paths).toEqual(['/start', '/text', '/credentials']);
    const loop = await web.fetchContent.execute(
      'loop',
      {
        urls: [`${base}/loop`],
      },
      undefined,
    );
    expect(loop.content[0]?.text).toContain('more than five redirects');
    expect(paths.filter(path => path === '/loop')).toHaveLength(6);
  } finally {
    web.clear();
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('runtime transport cancellation closes a request waiting for response headers', async () => {
  const received = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const server = createServer((request, _response) => {
    request.on('close', () => disconnected.resolve());
    received.resolve();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const {port} = Schema.decodeUnknownSync(Schema.Struct({port: Schema.Number}))(
    server.address(),
  );
  const web = createWebTools(network);
  const controller = new AbortController();
  try {
    const pending = web.fetchContent.execute(
      'cancel',
      {
        urls: [`http://127.0.0.1:${port}/`],
      },
      controller.signal,
    );
    await received.promise;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await disconnected.promise;
  } finally {
    web.clear();
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}, 5000);
