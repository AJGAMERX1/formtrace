# Formtrace

Formtrace turns movement into editable 3D objects. It runs entirely in the browser with Vite and Three.js. [Open the studio](https://ajgamerx1.github.io/formtrace/)

## Capture motion from video

Open **Capture motion** and choose a video from your device, or select the camera and allow access. Keep the camera stationary and move one subject against a still background. The tracker samples changing pixels across frames, follows the main moving region, and shows its path over the video.

Analyze the clip or start and finish a live camera take. Use **Create object** to bring the path into the studio. The sculpture follows the subject’s screen-space motion, with estimated depth derived from changes in motion and apparent size. Video frames stay on the device.

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

## Deployment

Pushes to `main` trigger the GitHub Pages workflow in `.github/workflows/pages.yml`. It installs the locked dependencies, builds the site, and deploys `dist`. Set the repository's Pages publishing source to GitHub Actions.
