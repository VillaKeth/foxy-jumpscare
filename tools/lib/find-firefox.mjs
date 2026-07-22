import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Locate firefox.exe.
 *
 * The registry comes first because Firefox is commonly a per-user install
 * under LOCALAPPDATA, and a Program Files check alone reports "Firefox is not
 * installed" on a machine that plainly has it.
 */
export async function findFirefox() {
  const key = String.raw`HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe`;

  for (const k of [key, key.replace('HKCU', 'HKLM')]) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', k, '/ve']);
      const match = stdout.match(/REG_SZ\s+(.+\.exe)/i);
      if (match) return match[1].trim();
    } catch { /* try the next hive */ }
  }

  for (const guess of [
    'C:/Program Files/Mozilla Firefox/firefox.exe',
    'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Mozilla Firefox', 'firefox.exe'),
  ]) {
    try {
      await access(guess);
      return guess;
    } catch { /* try the next guess */ }
  }

  return null;
}
