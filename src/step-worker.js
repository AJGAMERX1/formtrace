import { exportStep } from './step-export.js';

self.onmessage = ({ data: { meshes, name } }) => {
  try {
    self.postMessage({ blob: exportStep(meshes, name) });
  } catch (error) {
    self.postMessage({ error: error.message || 'The object could not be encoded as STEP.' });
  }
};
