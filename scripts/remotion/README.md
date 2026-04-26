# shipcode-video

Remotion project that renders the ShipCode launch video.

Standalone Bun project — **not** part of the root workspace. Has its own
`bun install` and `node_modules` so Remotion's heavy deps don't bloat the
main monorepo install.

## Render

```bash
cd scripts/remotion
bun install                                           # one-time

bun run studio                                        # interactive preview
bun run render                                        # MP4 -> out/shipcode-launch.mp4
bun run render:gif                                    # GIF -> out/shipcode-launch.gif
```

Or from repo root:

```bash
bun run video:studio
bun run video:render
bun run video:gif
```

## Screenshots

`src/compositions/AppShots.tsx` reads PNGs from `public/shots/`:

- `kanban.png`
- `pipeline.png`
- `graph.png`
- `diff.png`

Currently placeholders. Replace with real desktop captures (1600x1000
recommended, 16:10 ratio) by:

```bash
bun run dev:desktop                   # launch Electron from repo root
# Cmd+Shift+4 each view, save as kanban.png / pipeline.png / graph.png / diff.png
mv ~/Desktop/{kanban,pipeline,graph,diff}.png scripts/remotion/public/shots/
bun run video:render && bun run video:gif
```

## Output

`out/` is gitignored. Final artifacts:

- `out/shipcode-launch.mp4` — uploaded as asset on the GitHub release.
- `out/shipcode-launch.gif` — copied to `docs/launch.gif` for README embed.
