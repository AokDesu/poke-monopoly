# engine/

Pure game rules. **No IO**: no network, files, clock, `process` or `Math.random`; randomness comes from the seeded RNG and is logged. The same engine runs in the web app, the sim and the eval, and human and AI commands pass the same validation.

Every number (odds, values, trust, concession) is computed here and nowhere else. Must not import from `ai/`, `web/`, `sim/` or `eval/`; lint enforces this (`eslint.config.js`).

Spec: §4 (rules), §6 (architecture), §8 (invariants).
