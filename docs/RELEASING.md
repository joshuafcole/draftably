# Draftably package releases

The public packages are `draftably` (CLI), `@draftably/runtime` (native rendering),
`@draftably/markdown` (build-time remark integration), `@draftably/mermaid` (the Mermaid
drop-in), and the framework components `@draftably/react`, `@draftably/solid`, `@draftably/vue` and
`@draftably/svelte`. Package proofs install packed archives
outside this repository. They do not publish them.

Use `pnpm runtime:build && pnpm runtime:pack-check` for Node and public TypeScript imports. Add `pnpm prove:runtime` for the nested-path browser consumer. `release:check` includes each package's build and installed-artifact checks.

Use `pnpm markdown:build && pnpm markdown:pack-check` for the remark and markdown-it adapters and
their packed Unified/MDX/markdown-it consumers. The proof installs the Markdown and runtime
archives together. CI also runs `pnpm markdown:browser-check` against the real viewer package.

The changeset helper defaults to the CLI. Select other packages explicitly:

```sh
pnpm changeset:add minor "Add native rendering" --package @draftably/runtime
pnpm changeset:add patch "Fix shared geometry" --package draftably --package @draftably/runtime
```

The PR check maps shared compiler, model, font, and renderer changes to their affected packages. An empty changeset is an explicit no-release choice. A change to package source must name each affected public package.

Before the first registry release, confirm `@draftably` scope ownership and configure a trusted publisher for each package. The repository artifact proofs do not establish registry ownership. Release commands remain separate from development and verification.

The release flow follows explorEDA and Product Grid:

1. Add a changeset that names each changed package.
2. Merge it into `main`.
3. GitHub Actions opens or updates the **Version Packages** pull request.
4. Review the version and changelog. The action opens the pull request with the workflow token,
   so CI does not run on it: close and reopen it to start the required checks. Merge it when
   they pass.
5. Actions checks, builds, tests and packs each package. Changesets publishes them and creates GitHub releases.
6. After a publish, the release workflow deploys the docs site (draftably.dev), so the docs never
   describe a version that npm does not have. Pushes to `main` do not deploy it. To ship a
   docs-only fix between releases, run **Deploy to GitHub Pages** by hand.

A pull request that changes shipped files (`src/`, `index.html`, `examples/`, `docs/DSL.md`,
`packages/cli/`) must add a changeset; CI runs `pnpm changeset:check` to enforce it. Use
`pnpm changeset add --empty` for a change that needs no release.

The workflow runs when `.changeset/` changes on `main`, or through **Run workflow**.
Ordinary commits do not start a release. Manual runs on other branches skip publishing.
The version command updates the pnpm lockfile with the package version.

## Build and prove the package

The CLI lives in `src/cli/`; `packages/cli` is its npm release package.
It includes prebuilt JavaScript, the viewer and worker assets, a language guide, and an example.
The installed command is `draftably`. It needs Node 22.21 or later, with no compiler or build step.

```sh
pnpm cli:build
pnpm cli:pack-check
pnpm prove:installed
```

`cli:build` builds the viewer and bundles the CLI into `packages/cli/dist/`.
`cli:pack-check` installs the tarball outside the repo and checks the actual executable and local server.
`prove:installed` adds the browser drag, save, external edit, restart, invalid-source, and conflict proof.
The browser proof needs Playwright Chromium installed locally.
Archives go to `tmp/cli-dist/`; screenshots go to `tmp/proof/`.

Run `pnpm release:check` before publishing. GitHub's Check workflow runs the same gate.
The first version is `0.1.0`, generated with Changesets.

## Configure GitHub and npm

The source repository is [byronwall/draftably](https://github.com/byronwall/draftably).
GitHub Actions is enabled and can create and approve pull requests.

Configure an npm trusted publisher for `draftably`:

| Field                | Value                                       |
| -------------------- | ------------------------------------------- |
| Provider             | GitHub Actions                              |
| Organization or user | `byronwall`                                 |
| Repository           | `draftably`                                 |
| Workflow filename    | `release.yml`                               |
| Environment          | Leave empty; this workflow does not use one |
| Allowed action       | Direct publishing with `npm publish`        |

The npm package must exist before trusted publishing can be configured.
Publish the first checked archive from your authenticated local session once the CLI is ready.
Then configure the trusted publisher before the next Actions release.
Do not add an npm token to this workflow. Changesets uses npm's OIDC authentication.
The workflow uses GitHub-hosted Ubuntu and Node 24, which includes a compatible npm CLI.
Trusted publishing requires npm 11.5.1 or later and Node 22.14 or later.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

The source repository is public. The release workflow requests npm provenance for automated publishes.

### First publish of a new scoped package

A package must exist on npm before it can have a trusted publisher, so publish each new
`@draftably/*` package once by hand. The `draftably` npm organization owns the scope. Use npm 11.10
or later, which has `npm trust`.

1. Build the package and pack it. `pnpm pack` replaces `workspace:*` with the exact runtime version:

   ```sh
   pnpm runtime:build && pnpm frameworks:build
   pnpm --dir packages/react pack --pack-destination tmp/publish
   ```

2. Publish the archive with npm. pnpm 11 does not send the `npm login` token, so `pnpm publish`
   returns 404:

   ```sh
   npm publish tmp/publish/draftably-react-0.1.0.tgz --access public
   ```

   Tick "Do not challenge npm publish, npm trust operations" on the 2FA page to publish several
   packages and add their trust in one five-minute window.

3. Let the release workflow publish later versions:

   ```sh
   npm trust github @draftably/react --file release.yml --repo byronwall/draftably --allow-publish -y
   ```

Then Changesets publishes the package from Actions with the others.

## Add each release note

```sh
pnpm changeset:add patch "Describe the change for CLI users."
pnpm changeset:status
```

Use `minor` for features and `major` for breaking changes.
Commit the generated `.changeset/*.md` file with the change.
Do not run `pnpm release` during normal development; it publishes with your current npm credentials.

GitHub Actions runs `pnpm release:check` before publishing.
The package check requires public metadata and runs each built executable with `--help`.
The release gate tests the packed runtime in a fresh temporary install.
