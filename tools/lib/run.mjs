import { spawn } from 'node:child_process';

function reject_(cmd, err, reject) {
  if (err.code === 'ENOENT') {
    reject(new Error(`${cmd} not found on PATH. Install it and retry.`));
  } else {
    reject(err);
  }
}

/**
 * Run a command to completion. Resolves on exit 0, rejects otherwise.
 * ffmpeg writes progress to stderr, so stderr is captured rather than
 * inherited, and only surfaced when something actually failed.
 */
export function run(cmd, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      onStderr?.(chunk.toString());
    });

    child.on('error', (err) => reject_(cmd, err, reject));

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr.slice(-2000)}`));
      }
    });
  });
}

/** Same as run(), but resolves with stdout. */
export function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => reject_(cmd, err, reject));

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr.slice(-2000)}`));
      }
    });
  });
}
