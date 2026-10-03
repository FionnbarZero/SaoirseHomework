# Managed Chrome Prototype

This directory contains the safe, uninstalled prototype for keeping managed Chrome on the current homework path.

## What it does

- Uses a Manifest V3 service worker with no remotely hosted code.
- Fetches the current policy from the loopback homework service.
- Installs dynamic navigation rules only while Homework mode is active.
- Gives approved domains higher-priority `allow` rules and redirects other HTTP(S) top-level navigation to a local extension page.
- Reports extension health and the active origin to the local service.
- Leaves its last Homework-mode rules in place if the local service becomes unavailable.

The current approved list is intentionally narrow because the school activity URLs and login redirects have not been supplied yet.

## Build and test

```bash
npm test
npm run build:chrome
```

The built unpacked extension is written to `chrome/build/extension`. Load that directory only in a parent-supervised development Chrome profile.

## Fixed identity

`extension-id.txt` records the development ID derived from the public `key` in `manifest.json`. The Chrome-compatible development private key is generated locally at `chrome/private/extension-dev-pkcs8.pem`, is permission-restricted, and is ignored by Git.

For production, upload the ZIP to the Chrome Web Store as an unlisted item, copy its public key into the manifest, rebuild, replace `__EXTENSION_ID__` in the policy template with the resulting Web Store ID, and configure `HOMEWORK_CHROME_EXTENSION_ID` with that same ID. macOS does not permit ordinary users to install a privately hosted CRX; production distribution must use the Chrome Web Store or an applicable managed-enterprise deployment.

## Policy boundary

The `.mobileconfig.template` is not installed automatically. A parent must fill its UUID and extension-ID placeholders, review it, install it for the child account, and confirm the effective values in `chrome://policy`. The template disables Guest mode, Incognito, developer tools, and all extensions except the force-installed homework extension.
