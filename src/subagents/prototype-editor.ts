import {CustomEditor} from '@earendil-works/pi-coding-agent';

/** Pi 0.85.1 draws its software cursor even when an editor loses focus. */
export class MainEditor extends CustomEditor {
  override render(width: number): string[] {
    const lines = super.render(width);
    return this.focused
      ? lines
      : lines.map(line => line.replaceAll('\x1b[7m', ''));
  }
}
