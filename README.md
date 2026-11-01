# kiRa

Katana combat core for a third-person action game. Twilight Princess style moveset with Stellar Blade style perfect dodge and perfect block.

```bash
npm install
npm run dev     # browser sandbox
npm run check   # typecheck + tests
```

- `docs/ARCHITECTURE.md`: modules, frame order, player FSM, input table, perfect dodge/block, camera and hair notes
- `docs/HANDOFF.md`: build phases for the browser sandbox (three.js + Rapier)
- `CLAUDE.md`: rules for working in this repo with Claude Code

`kiRa` is a working title.

## Credits

- "Anime head" by DaGreen (https://sketchfab.com/3d-models/anime-head-fe08e8a406764f81863ba4bba629f608), licensed CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Used as her head (`public/models/anime_head.glb`), turned, scaled and relit to fit the figure.
- "Female_2500_ Base Mesh" by EbiosDesigner (https://sketchfab.com/3d-models/female-2500--base-mesh-f59219d3c8a34c6380120ec280338c5b), licensed CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Used as her body (`public/models/base_body.glb`), rigged, refitted and painted with her outfit in code.
