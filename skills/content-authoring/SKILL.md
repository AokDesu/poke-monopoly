---
name: content-authoring
description: 'Where game content lives and how to add species, lines and personalities. Placeholder until the content issue completes it. Read before adding or editing anything under content/.'
---

# Content authoring

Placeholder. The content issue (#17, game content tables and schema from spec Appendix A) completes this skill with the schema and checks.

Where things go, all under `content/`:

- Species, items, events and classes: tables in spec Appendix A.
- Personalities: `content/personalities/<name>.json` (spec §5.5).
- Thai line bank: `content/lines/th/<situation>.json` (spec §5.7).

Content holds data only. A change to a rule number also updates the engine, the spec and the tests in the same pull request (spec §7).
