import { statSync } from 'node:fs';
import path from 'node:path';

const requiredFiles = [
  '.venv/bin/python',
  '.venv/pyvenv.cfg',
  'backend/app.py',
  'native/bin/audio-capture',
  'native/bin/LiveCaptionAudio.app/Contents/MacOS/audio-capture',
];

export function runtimeFailure(root, labels) {
  const complete = requiredFiles.every((relative) => {
    try {
      // Follow the Python symlink so an uninstalled base interpreter is detected.
      return statSync(path.join(root, relative)).isFile();
    } catch {
      return false;
    }
  });
  return complete ? null : { error: { code: 'runtime_missing', message: labels.runtimeMissing } };
}

export function backendFailure(labels) {
  return { error: { code: 'backend_unavailable', message: labels.backendUnavailable } };
}
