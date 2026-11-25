import * as THREE from 'three';

// Copy the current geometry before yielding. The studio can keep drawing while a
// download is being encoded, and STEP can safely transfer its copies to a worker.
function snapshotTracks(mesh, format, name) {
  const source = mesh.geometry;
  const ranges = mesh.userData.trackRanges;
  return ranges.map(range => {
    const geometry = new THREE.BufferGeometry();
    const attributes = format === 'step' ? ['position'] : Object.keys(source.attributes);
    for (const key of attributes) {
      const attr = source.attributes[key];
      const start = range.vertexStart * attr.itemSize;
      const end = start + range.vertexCount * attr.itemSize;
      geometry.setAttribute(key, new THREE.BufferAttribute(attr.array.slice(start, end), attr.itemSize, attr.normalized));
    }
    const indices = source.index.array.slice(range.indexStart, range.indexStart + range.indexCount);
    for (let i = 0; i < indices.length; i++) indices[i] -= range.vertexStart;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return { name: ranges.length === 1 ? name : 'Motion track ' + range.id, geometry };
  });
}

async function encodeStep(parts, name) {
  const meshes = parts.map(part => ({
    name: part.name,
    positions: part.geometry.attributes.position.array,
    indices: part.geometry.index.array,
  }));
  const buffers = meshes.flatMap(mesh => [mesh.positions.buffer, mesh.indices.buffer]);
  const worker = new Worker(new URL('./step-worker.js', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.blob ? resolve(data.blob) : reject(new Error(data.error));
      worker.onerror = event => reject(new Error(event.message || 'The STEP worker failed.'));
      worker.onmessageerror = () => reject(new Error('The browser could not read the STEP file.'));
      worker.postMessage({ meshes, name }, buffers);
    });
  } finally {
    worker.terminate();
  }
}

async function encodeGlb(parts, name, sourceMaterial) {
  const material = sourceMaterial.clone();
  try {
    const scene = new THREE.Scene();
    scene.name = name;
    for (const part of parts) {
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.name = part.name;
      scene.add(mesh);
    }
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const data = await new GLTFExporter().parseAsync(scene, { binary: true });
    return new Blob([data], { type: 'model/gltf-binary' });
  } finally {
    material.dispose();
  }
}

export async function downloadModel(mesh, format, name) {
  if (!mesh) throw new Error('Draw a gesture or choose a preset before exporting.');
  const parts = snapshotTracks(mesh, format, name);
  try {
    const blob = format === 'step' ? await encodeStep(parts, name) : await encodeGlb(parts, name, mesh.material);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = String(name).replace(/[^a-z\d._-]+/gi, '-').replace(/\.(glb|step)$/i, '') + '.' + format;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    }
  } finally {
    for (const part of parts) part.geometry.dispose();
  }
}
