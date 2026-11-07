# Changelog

All notable changes to Wanderer's Path. Versions follow the `version` in `module.json`.

## 0.0.1

Repository scaffold. No tools yet; not released.

- Module manifest (Foundry v13 to v14.370, dnd5e 5.0.0 to 6.0.6; recommends Wanderer's Toolkit).
- wanderers-core 0.6.0 vendored and pinned (`wanderers-core.lock.json`); shared stylesheet listed first.
- Entry point registers the Debug logging setting and the API (`version`, `isReady`, `features`) and fires `wanderers-path.ready`.
- CI: core's module checks (pin, syntax, lint, types, tests); Release workflow (tag `vX.Y.Z`, build and upload jobs).

### Untested in Foundry

- [ ] The module loads in v13 and v14 with dnd5e and logs no console errors.
- [ ] With Debug logging on (`game.settings.set("wanderers-path", "debugLog", true)`, reload), the console shows the init and ready lines.
- [ ] `game.modules.get("wanderers-path").api.isReady` is true after load.
