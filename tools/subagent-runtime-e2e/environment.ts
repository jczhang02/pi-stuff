import {join} from 'node:path';

export function isolatedEnvironment(directory: string, agentDir: string) {
  return {
    ...Object.fromEntries(
      Object.keys(process.env).map(key => [key, undefined]),
    ),
    PATH: process.env.PATH,
    HOME: directory,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: join(agentDir, 'sessions'),
    PI_OFFLINE: '1',
    PI_TELEMETRY: '0',
    NO_PROXY: 'localhost,127.0.0.1',
  };
}
