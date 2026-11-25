# Formtrace

Formtrace turns movement into editable 3D objects. It runs entirely in the browser with Vite and Three.js. [Open the studio](https://ajgamerx1.github.io/formtrace/)

## Capture motion from video

Open **Capture motion** to select a video, use your camera, or try the included 3.5-second flock clip. Keep the camera steady. The tracker follows moving regions separately and shows their trails over the footage. If waves, people, or trees also move, select the part of the frame containing the flight paths before tracking. The map keeps the original frame coordinates. Video processing stays on the device.

Switch to **Pass heat map** to see how often tracked movement enters each area of the frame. The legend shows the counts for the blue, mint, amber, and red anchors. Intermediate counts have intermediate colors, and the scale expands for busy flight corridors. Tap a cell or focus the map and use the arrow keys to read its exact count. Remaining in a cell keeps the count steady. Another track entering it, or a track leaving and returning, adds a pass.

Choose **Create object** to sculpt the captured paths together. Their relative positions are preserved, with estimated depth derived from speed and apparent size. Each path becomes a separate mesh node in the exported GLB. For dense flocks, the mesh includes up to 48 of the strongest tracks. The heat map includes all confirmed passes. **View heat map** in Form controls reopens the counts for the current capture.

A track is a segment of observed movement. Birds can overlap, disappear, or generate several segments. Camera motion and other moving subjects can also contribute to the map.

## Shape and export

- Drag in the viewport with a mouse, pen, or finger to sketch a gesture. Drawing speed adds depth.
- Try a preset or choose a ribbon, tube, or beads. Adjust color, width, and twist.
- Select **Orbit** and drag to rotate the object. Use the camera controls to zoom or fit the view.
- Use **Undo** and **Redo** to revisit edits during the current session.
- **Export object** downloads the current mesh and material as a binary glTF file (`.glb`).

Keyboard shortcuts include **D** for Draw, **O** for Orbit, **F** for Fit, and **Ctrl/Cmd+Z** for Undo. Add **Shift** to redo.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Run `npm run build` and then `npm run preview` to serve the production build. Camera capture requires HTTPS or localhost and permission to use the camera. Supported video formats depend on the browser's installed decoders.

## Check tracking

`npm test` checks that pausing does not add visits, a return adds another pass, and intersecting paths remain separate.

The [field test results](./tests/field-results.md) include a comparison against hand-labeled birds. The browser regression follows the visitor workflow on the included [real flock footage](./media/README.md). It checks the heat map and exact cell values, undo/redo, and the exported GLB's separate mesh nodes.

```sh
npx playwright install chromium
npm run test:flock
```

To check a deployment, pass its URL. A second argument can select a local flock video.

```sh
npm run test:flock -- https://ajgamerx1.github.io/formtrace/
```

## Deployment

Pushes to `main` trigger the GitHub Pages workflow in `.github/workflows/pages.yml`. It installs the locked dependencies, builds the site, and deploys `dist`. Set the repository's Pages publishing source to GitHub Actions.
