# Live Shell Sessions TODO

- [ ] Add interactive instant-shell IPC and process metadata in main/shared
  Verify: `bun run --filter @shipcode/shared typecheck && bun run --filter @shipcode/desktop typecheck`

- [ ] Update Sessions store and pane renderer to distinguish replay vs live shells
  Verify: `bun run --filter @shipcode/desktop test -- app-store useIpc`

- [ ] Convert the New Terminal Session modal to start live Claude/Codex shells
  Verify: `bun run --filter @shipcode/desktop typecheck`

- [ ] Validate focused desktop tests and typecheck after integration
  Verify: `bun run --filter @shipcode/desktop test && bun run --filter @shipcode/desktop typecheck`
