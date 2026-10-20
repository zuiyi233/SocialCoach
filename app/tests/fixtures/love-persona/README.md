# love-persona contract fixtures

Shared contract fixtures for the single `Persona` schema and the `.scpersona` pack format
(`wiki/specs/spec-love-persona.md` §4.2「单一契约」). **One set, two editors.**

The Love Studio fork's own tests read these exact files through the relative path
`../../app/tests/fixtures/love-persona/` (relative to `love-studio/` at the repo root).
Because of that, **these files must stay stable** — renaming or rewriting one silently
breaks the Studio side of the contract with no compile error. Add new fixtures next to the
existing ones; do not mutate a shipped fixture's bytes.

| File | What it pins |
|---|---|
| `with-unknown.scpersona` | A zip pack carrying unknown top-level fields (`x_custom`, `personality_extra`), an unknown nested field, `storyConstraints.secret`, plus optional `worldbook.json`, `style.json` and one `assets/portraits/smile` data URL. Used to prove unknown-field preservation and the public-only export. |
| `basic.json` | A plain single-file "basic JSON" (name / description / personality / scenario / first_mes / alternate_greetings / mes_example). Used to prove only the documented core subset is mapped. |
| `tavern-v2-card.json` | A full Tavern V2 card (`spec: "chara_card_v2"` + `data` + `character_book` + `extensions`). Used **only** to assert classification (`tavern-card` + `guide: "studio"`) and that its `description`/`personality` are never silently imported. |
| `future.scpersona` | A structurally valid pack whose `manifest.version` is `999`. Used to assert a future version is rejected with the shared `persona/bad-version` code. |

There is deliberately **no PNG fixture**: the love side does not parse Tavern PNG
`chara`/`ccv3` chunks (§3 hard boundary), and hand-rolling a fake PNG byte string would be a
broken artefact masquerading as a real one. PNG classification is exercised with magic bytes
in `tests/core/love-persona.test.ts` instead.