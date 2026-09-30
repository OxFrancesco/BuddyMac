# Stagehand integration source

These files are copied unchanged from `browserbase/stagehand`, commit `b771930d2b4d858e5bd9670203c66260b385a8fa`, under `packages/integrations/core/src`. The MIT license is included.

The experimental facade is not published separately. Liny bundles its stdio server into `Contents/Resources/agent/stagehand.js` with Bun and uses the pinned Stagehand 4.1.0 SDK. It launches local Chrome with a temporary profile. Liny passes only PATH, HOME, TMPDIR, STAGEHAND_BROWSER, and the packaged extension directory to this process, so provider credentials and Browserbase settings are not inherited.

To update, fetch the official repository with codeview, copy the same files from the pinned revision, update this reference, and rerun the live packaged-server test. Do not edit the copy to change Liny behavior. Liny's tool adapter, backend selection, and lifecycle belong in `agent/src/computer-use`.

The build also copies the SDK's dist/extension directory beside stagehand.js. The client supplies its absolute path because bundling changes import.meta.url and the SDK's default asset lookup.
