<!-- CI fails unless a line starts with "Spec:" and names a spec section after the § sign, for example: Spec: §2, §7 -->

Spec: §

## Summary

<!-- What changed and why, in a few lines. -->

## How I verified

- [ ] `npm run typecheck && npm run lint`
- [ ] `npm run format:check`
- [ ] `npm test`
- [ ] `npm run sim -- --games 100 --seed 1`
- [ ] `npm run eval:jev -- --offline`
- [ ] `npm run build` (when `web/` changed)

## House rules (spec §7)

- [ ] The engine has no IO.
- [ ] Numbers live only in the engine.
- [ ] No hidden information goes into `ai/`.
- [ ] A rule change updates the spec and tests in this PR.
- [ ] No keys committed.
