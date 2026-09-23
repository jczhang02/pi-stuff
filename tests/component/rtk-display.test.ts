import {expect, test} from 'bun:test';
import {stripVTControlCharacters} from 'node:util';
import {readablePanelLines} from '../../src/pi/panel-style';

test('light panel accents retain content and exceed 4.5 contrast on off-white', () => {
  const input = [
    '\x1b[38;2;90;128;128mScope\x1b[39m',
    '\x1b[38;2;88;132;88m840 saved\x1b[39m',
    '\x1b[38;2;154;115;38mParse failures\x1b[39m',
    '\x1b[38;2;118;118;118mEsc Back\x1b[39m',
  ];
  const output = readablePanelLines(input, {
    name: 'light',
    getColorMode: () => 'truecolor',
  });
  expect(output.map(stripVTControlCharacters)).toEqual(
    input.map(stripVTControlCharacters),
  );
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  };
  for (const line of output) {
    const match = /38;2;(\d+);(\d+);(\d+)m/u.exec(line);
    if (!match) throw new Error('Expected truecolor foreground.');
    const luminance =
      0.2126 * linear(Number(match[1])) +
      0.7152 * linear(Number(match[2])) +
      0.0722 * linear(Number(match[3]));
    expect((linear(248) + 0.05) / (luminance + 0.05)).toBeGreaterThanOrEqual(
      4.5,
    );
  }
});

test('dark and custom theme values remain untouched', () => {
  const lines = ['\x1b[38;2;90;128;128mScope\x1b[39m'];
  for (const name of ['dark', 'custom'])
    expect(
      readablePanelLines(lines, {name, getColorMode: () => 'truecolor'}),
    ).toEqual(lines);
  const custom = ['\x1b[38;2;1;2;3mScope\x1b[39m'];
  expect(
    readablePanelLines(custom, {
      name: 'light',
      getColorMode: () => 'truecolor',
    }),
  ).toEqual(custom);
});

test('256-color light correction keeps the terminal protocol and background', () => {
  const lines = ['\x1b[48;5;66m\x1b[38;5;66mScope\x1b[39m'];
  expect(
    readablePanelLines(lines, {name: 'light', getColorMode: () => '256color'}),
  ).toEqual(['\x1b[48;5;66m\x1b[38;5;23mScope\x1b[39m']);
});

test('a sourced custom light theme keeps quantized colors that collide with built-ins', () => {
  // Pi quantizes both custom #638989 and built-in #5a8080 to index 66.
  const lines = ['\x1b[38;5;66mScope\x1b[39m'];
  expect(
    readablePanelLines(lines, {
      name: 'light',
      sourcePath: '/example/custom-light.json',
      getColorMode: () => '256color',
    }),
  ).toEqual(lines);
  expect(
    readablePanelLines(lines, {
      name: 'light',
      sourceInfo: {
        path: '/example/light',
        source: 'extension',
        scope: 'temporary',
        origin: 'top-level',
      },
      getColorMode: () => '256color',
    }),
  ).toEqual(lines);
});
