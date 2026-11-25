# Bird footage verification

The previous public build, commit `827fc29`, generated one continuous trace from a flock in flight. It selected the strongest changing region in each frame. Switching from one bird to another could draw a connection between them.

## Four birds with manual annotations

We compared positions against researcher-drawn full-body boxes in Tawhid and colleagues’ synchronized budgerigar dataset. At each timestamp, each detected center and each annotated bird could contribute at most one match. A hit required the estimated center to fall inside the unexpanded box. [Dataset and license](https://doi.org/10.5281/zenodo.19712127)

For camera 1, clip `Avoidance(2to2)/cam1/Earth&Pluto-Mars&Urenus/BtoF/1 (88)`, we checked 16 timestamps from 1.15 to 2.40 seconds at 1/12-second intervals. Four birds had visible annotations at those timestamps.

| Measure | Previous public build | Multi-track build |
| --- | ---: | ---: |
| Bird positions matched across 64 opportunities | 3 | 53 |
| Timestamps with at least two simultaneous matches | 0 of 16 | 16 of 16 |
| Timestamps with all four birds matched | 0 of 16 | 9 of 16 |

We used this clip while improving foreground separation and sampling. Extra motion segments were present, including motion from the handler and fragmented trails. The measure above describes position coverage on this clip. A bird can acquire a new track ID after an overlap or gap.

We also checked a held-out flight in the opposite direction, `FtoB/1 (81)`, using the same matching rule across 16 timestamps, 2.601 through 3.851 seconds. Coverage improved from 4/64 to 53/64. All four birds had simultaneous matches at 10 of the 16 timestamps. Two birds lost their matches toward the end of the window.

The new build generated 254 candidate tips across those 16 holdout timestamps, including movements outside the four labeled birds. Track totals therefore include background motion and fragmented paths.

## Outdoor footage and pass counts

- **Distant flock against the sky.** The previous studio drew one path. The multi-track build produced independent paths and a pass map, and exported separate GLB nodes. On three sampled frames, a track tip fell within 10 pixels of all 36 independently selected, visibly occupied bird locations at 1280 × 720. This checks those locations only. The unmodified 3.534-second clip is available under **Capture motion → Try flock footage**. [Fastily’s original footage and license](https://commons.wikimedia.org/wiki/File:Flying_Birds_1_2022-12-05.webm)
- **Geese on a moving shoreline.** This 35.5-second field clip exposed two practical issues. Repeated seeks through the AV1 file made processing slow, and breaking waves generated many movement segments. The tracker now decodes longer clips sequentially. In a Chromium run, the clip finished in 24.6 seconds. Selecting the upper half left the checked lower-half cells at zero. Moving clouds, water within the selected area, and camera movement can still create extra tracks. [Maoileann’s geese footage](https://commons.wikimedia.org/wiki/File:Geese-1280675,_Dingle_Peninsula,_Co._Kerry,_Ireland.webm)
- **Known repeat counts.** A controlled three-subject clip crossed three distinct lanes four times, once, and four times. The measured cells read 4, 1, and 4, and an unvisited cell stayed at zero. The automated unit tests also check that pausing in a cell adds no passes.
- **Color and inspection.** The legend expands to the observed maximum. The saved grid preserves the counts when the original video is released. The browser check selects a highest-color cell, verifies its displayed count, restores the capture through undo/redo, and parses the exported GLB.

Run `npm test` for the pass-count cases and `npm run test:flock -- https://ajgamerx1.github.io/formtrace/` to repeat the real-flock browser check.
