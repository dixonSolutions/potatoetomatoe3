# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Packaging for Linux with Electron

This project ships with an Electron configuration so you can bundle the static Svelte build as a desktop application.

```sh
# install deps (Node.js 20+ is recommended)
pnpm install

# build static assets tailored for the Electron runtime
pnpm run build:electron

# launch the Electron shell against the latest build
pnpm run electron:start

# create distributable Linux artifacts (AppImage + deb bundle)
pnpm run dist:linux

# build a Flatpak using flatpak-builder (outputs under build/flatpak and dist/)
pnpm run flatpak:build
```

Electron uses the static output inside `build/` and the main process entry point at `electron/main.js`. During Electron builds the Svelte app runs with an empty base path, ensuring assets resolve correctly in the desktop runtime.

> Flatpak builds require `flatpak`, `flatpak-builder`, and the `org.electronjs.Electron2.BaseApp` and `org.freedesktop.Sdk.Extension.node22` runtimes. The manifest lives at `flatpak/com.potatotomato.games.yml`, and the helper script above invokes `flatpak-builder --force-clean build/flatpak ...`. The resulting Flatpak bundle will be written to `dist/` once the build completes.
