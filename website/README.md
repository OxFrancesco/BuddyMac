# BuddyMac website

Static landing page and quick-start guide. Run commands from this directory:

```sh
bun run dev
bun run build
```

The development server binds to `127.0.0.1:4178`. Build output is `dist/`.
The page uses the app's bundled fonts and a fixture screenshot. It needs no external scripts or font services.

## Cloudflare deployment

The public site is `https://mac.buddytools.org`. Run `bun run deploy` from this directory. `wrangler.jsonc` pins Francesco's personal Cloudflare account and serves only `dist/`.

Both the custom domain and the exact `mac.buddytools.org/*` route are required. The exact route takes precedence over the existing `*.buddytools.org/*` Worker route. Do not remove or change that shared wildcard route.

The `.openai/hosting.json` file belongs to the earlier private Sites preview. Cloudflare deployment uses `wrangler.jsonc`.

The repository is public. The landing page links to GitHub and releases, and documents installation with `npx buddymac@latest`. Requirements and installation behavior follow `packages/buddymac/README.md`.

Feature instructions follow the current views in `src/`, including the Focus shared-store and iCloud settings. Review the guide when app labels or behavior change.
