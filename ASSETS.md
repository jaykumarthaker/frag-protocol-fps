# Assets & Licensing

The game is almost entirely procedural. Exactly **one** third-party asset is
bundled — a CC0 (public-domain) character model — and everything else is
generated at runtime.

| Asset type    | How it's produced                                                  |
|---------------|---------------------------------------------------------------------|
| Characters    | `RobotExpressive.glb` — CC0 model, see the log below                |
| Geometry      | Three.js primitives (boxes, capsules, ramps, weapon viewmodels)     |
| Textures      | prototype-grid textures drawn to a `<canvas>` at startup            |
| Sky / lighting| procedural gradient sky dome + analytic lights + bloom              |
| Sound effects | synthesised with the Web Audio API (oscillators + filtered noise)   |
| Announcer     | the browser's built-in `SpeechSynthesis` voice                     |
| Music         | none                                                                |

Everything here is unambiguously legal to host publicly. The only licence to
honour is CC0 (no obligation) plus the engine libraries (Three.js — MIT,
Rapier — Apache-2.0).

## Bundled assets log

| File | Source | Licence | Used for |
|------|--------|---------|----------|
| `public/models/RobotExpressive.glb` | three.js examples — model by Tomás Laulhé, modified by Don McCurdy ([three.js repo](https://github.com/mrdoob/three.js/tree/master/examples/models/gltf/RobotExpressive)) | **CC0 1.0** (public domain) | animated player/bot characters |

CC0 imposes no attribution requirement, but the author is credited anyway in
the in-game **Credits** screen.

## Adding more assets later

If real environment art / weapon models are added, use **only CC0 or
clearly-licensed free assets** and log every file in the table above with its
source URL and licence. Prefer CC0; attribute anything CC-BY in the Credits
screen.

Recommended sources (all CC0 unless noted):

- **Kenney.nl** — weapon kits, prototype textures, sci-fi kits, audio. CC0.
- **Quaternius** — low-poly guns, modular sci-fi kits, characters. CC0.
- **Poly Haven** — HDRIs, PBR textures. CC0.
- **ambientCG** — CC0 PBR textures.
- **Freesound.org** — SFX; filter to CC0, attribute any CC-BY.
- **OpenGameArt / Incompetech** — music; mostly CC-BY (attribution required).
