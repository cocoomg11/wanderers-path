# Changelog

All notable changes to My Module. Versions follow the `version` in `module.json`.

## 0.1.0

First release.

- Example tool (GM notes window) behind the feature switch *Example tool*.
- Read-only health check (`api.health()`), Remove module data (`api.cleanup`), Debug logging, built on wanderers-core.

### Untested in Foundry

Not run in a live world yet; check:

- [ ] The module loads in v13 and v14 with no console errors; the settings page lists the feature switch and Debug logging.
- [ ] The token controls show the example button for the GM only; it opens the notes window; a note added survives a reload.
- [ ] With *Feature: Example tool* off (after the reload): no button, `api.example` is undefined.
- [ ] With a GM and a player connected, `api.example.add("text")` from the player adds one note (not two); with two GM tabs open, one note.
- [ ] `api.health()` returns the sections; with the Wanderer's Satchel installed, the module appears in its hub.
- [ ] `api.cleanup.plan()` counts the notes and changed settings; `remove({ notes: true }, "REMOVE")` clears the notes.
