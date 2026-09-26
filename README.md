<p align="center">
  <img src="assets/hero.svg" alt="pa11y-ci-action: Unofficial GitHub Action for pa11y-ci" width="100%">
</p>

<p align="center">
  <a href="https://github.com/lowlysre/pa11y-ci-action/actions/workflows/ci.yml"><img src="https://github.com/lowlysre/pa11y-ci-action/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/lowlysre/pa11y-ci-action" alt="License"></a>
</p>

# pa11y-ci-action

A GitHub Action wrapper for [pa11y-ci](https://github.com/pa11y/pa11y-ci): run WCAG accessibility checks against a list of URLs or a sitemap, and get a job summary (and, optionally, a sticky PR comment) instead of raw console output.

## Contents

- [Tutorial: quickstart](#tutorial-quickstart)
- [How-to guides](#how-to-guides)
  - [Use an existing `.pa11yci` config](#use-an-existing-pa11yci-config)
  - [Tune the failure threshold](#tune-the-failure-threshold)
  - [Pin or upgrade the pa11y-ci version](#pin-or-upgrade-the-pa11y-ci-version)
  - [Post a sticky PR comment](#post-a-sticky-pr-comment)
  - [Save the full report](#save-the-full-report)
- [Reference](#reference)
  - [Inputs](#inputs)
  - [Outputs](#outputs)
  - [Permissions](#permissions)
- [Explanation](#explanation)
  - [Why not `npx pa11y-ci` in your own workflow](#why-not-npx-pa11y-ci-in-your-own-workflow)
  - [Design](#design)
  - [Known gaps](#known-gaps)
- [Acknowledgements](#acknowledgements)

## Tutorial: quickstart

The action requires Node.js 22 or newer, npm, Bash, and the system libraries Chromium needs. It uses the Node version on `PATH` and doesn't change it. GitHub-hosted Ubuntu, Windows, and macOS runners are covered by CI; self-hosted runners need the same tools and browser dependencies.

Add a `.pa11yci` config to your repo (see [pa11y-ci's config docs](https://github.com/pa11y/pa11y-ci#pa11y-ci)), or skip it and pass `urls`/`sitemap` directly:

```yaml
name: Accessibility

on: pull_request

permissions:
  contents: read

jobs:
  pa11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22'
      - uses: lowlysre/pa11y-ci-action@acce551b1e4a119f2d7c03e8b16a5d4c7e91f0a3 # v1.0.0
        with:
          urls: |
            https://example.com
            https://example.com/about
```

Pin to a full commit SHA, not a tag, so a moved or compromised tag can't change what runs. The SHA in these examples is a placeholder; copy the real one for the version you want from the [releases page](https://github.com/lowlysre/pa11y-ci-action/releases).

On a page with issues, the job fails and the run's job summary lists the URL, and its error/warning/notice counts.

## How-to guides

### Use an existing `.pa11yci` config

The action looks for `.pa11yci`, then `.pa11yci.json`, then `.pa11yci.js`, then `.pa11yci.cjs` in `working-directory`. The `config` input selects an exact file instead. JavaScript configs can export an object or a promise; relative imports resolve from that file.

The `urls`, `standard`, and `concurrency` inputs only build a config when no file exists. The `sitemap` input works with either an existing config or a generated one and adds its pages to the configured URLs.

Each URL must appear once. Use separate action steps for different scenarios on the same URL. Empty scans and reports with missing URL results fail. Configured reporters are disabled because the action owns the JSON output and summaries. Config modules must not write to stdout.

On `ubuntu-latest`, your config needs Chromium's sandbox turned off, or Chromium fails with `No usable sandbox!`:

```json
{
  "defaults": {
    "chromeLaunchConfig": {
      "args": ["--no-sandbox"]
    }
  }
}
```

### Tune the failure threshold

`threshold` is the number of issues permitted across all URLs combined before the action fails. Set it above `0` to allow a known baseline of issues while still catching regressions:

```yaml
      - uses: lowlysre/pa11y-ci-action@acce551b1e4a119f2d7c03e8b16a5d4c7e91f0a3 # v1.0.0
        with:
          sitemap: https://example.com/sitemap.xml
          threshold: 5
```

A URL that fails to load fails the action regardless of `threshold`.

> [!NOTE]
> Shared configs can keep their thresholds. For this action run only, config thresholds are set to zero in a temporary runtime copy so pa11y-ci reports every issue. The action warns when it overrides a threshold and uses its own `threshold` input for the combined result. Your config file stays unchanged for other tools and local runs.

### Pin or upgrade the pa11y-ci version

The action installs `pa11y-ci` in a fresh runtime directory for each invocation. It doesn't install the action's development dependencies, and `NODE_ENV=production` doesn't skip pa11y-ci. npm installation warnings are suppressed; installation errors still fail the action.

The `pa11y-ci-version` input accepts an npm version range. An exact version fixes the top-level package version, but its transitive dependencies can still change between installs.

```yaml
      - uses: lowlysre/pa11y-ci-action@acce551b1e4a119f2d7c03e8b16a5d4c7e91f0a3 # v1.0.0
        with:
          urls: https://example.com
          pa11y-ci-version: '4.1.1'
```

### Post a sticky PR comment

Set `comment-on-pr: true` on a `pull_request`-triggered run to post or update a single comment on the PR with the same summary table as the job summary. This needs `pull-requests: write`:

```yaml
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  pa11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22'
      - uses: lowlysre/pa11y-ci-action@acce551b1e4a119f2d7c03e8b16a5d4c7e91f0a3 # v1.0.0
        with:
          urls: https://example.com
          comment-on-pr: true
          comment-id: public-site
```

`comment-on-pr` is a no-op (with a warning) on any event other than `pull_request`, so it's safe to leave set on a workflow that also runs on `push`.

The action only updates a comment written by the same account as `github-token`. A marker comment from anyone else is ignored and the action posts its own.

Comments link to their workflow run. The default comment identity includes the workflow, job, and action invocation. Set `comment-id` explicitly to keep the same comment across workflow edits, and give each matrix entry a different ID, such as `site-${{ matrix.site }}`. Don't run concurrent writers with the same ID; use workflow concurrency to serialize them. Existing unscoped comments are left untouched.

GitHub caps comments at 65,536 characters and job summaries at 1 MiB. On a report too large for either, the table lists load failures and URLs with issues first, drops the rest, and says how many it left out. The `report-json` output contains the full upstream report, including when completeness checks reject it.

### Save the full report

The summary contains counts. Issue codes, selectors, and messages are in `report-json`, which points to a temporary runner file. Upload it in a following step so the details remain available after the job:

```yaml
      - uses: lowlysre/pa11y-ci-action@acce551b1e4a119f2d7c03e8b16a5d4c7e91f0a3 # v1.0.0
        id: accessibility
        with:
          urls: https://example.com
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        if: ${{ !cancelled() && steps.accessibility.outputs.report-json != '' }}
        with:
          name: pa11y-report
          path: ${{ steps.accessibility.outputs.report-json }}
```

The upload runs after an accessibility failure without changing the action's failing result. Startup and configuration errors may produce no report, so the condition checks for a path.

## Reference

### Inputs

| Input | Description | Default |
| --- | --- | --- |
| `config` | Exact path to a pa11y-ci JSON or JavaScript config file. | looked up automatically |
| `urls` | Newline-separated URLs to test. Only used when no config file is found. | |
| `sitemap` | Sitemap URL to crawl. Adds pages to existing or generated config URLs. | |
| `standard` | `WCAG2A`, `WCAG2AA`, or `WCAG2AAA`. Only used when no config file is found. | `WCAG2AA` |
| `threshold` | Number of issues permitted across all URLs before the action fails. Must be a whole number, `0` or more. | `0` |
| `concurrency` | Pages to test in parallel. Only used when no config file is found. Must be a whole number, `1` or more. | `1` |
| `working-directory` | Directory to resolve the config file and run pa11y-ci from. | `.` |
| `pa11y-ci-version` | Version of `pa11y-ci` to install and run, as an npm version range. | `4.1.1` |
| `cache` | Restore and save the Chromium build through Actions cache. `false` skips restore/save; invocations in the same job can still share downloaded browsers. | `true` |
| `comment-on-pr` | Post or update a sticky summary comment on the triggering pull request. | `false` |
| `comment-id` | Stable sticky comment identifier. Use a different value for each matrix entry. | workflow, job, and action identity |
| `github-token` | Token used for `comment-on-pr`. Needs `pull-requests: write`. | `github.token` |

### Outputs

| Output | Description |
| --- | --- |
| `total-urls` | Number of URLs tested. |
| `passed-urls` | Number of URLs with no issues. |
| `total-issues` | Total issues found across all URLs. |
| `passed` | `true` if every URL loaded and `total-issues` is within `threshold`. |
| `report-json` | Path to the raw pa11y-ci JSON report on the runner's temp directory. |
| `cache-hit` | `true` if the Chromium cache was restored. Empty when `cache` is `false`. |

### Permissions

The action itself needs no permissions beyond `contents: read` to check out the config file. `comment-on-pr: true` additionally needs `pull-requests: write` on the job. Without it, the action logs a warning and skips the comment instead of failing. Pull requests from forks get a read-only token, so they get the same warning. A 403 from a rate limit still fails the action, since skipping it would hide the report.

## Explanation

### Why not `npx pa11y-ci` in your own workflow

You can, and plenty of repos do. This wraps that in one `uses:` line with a pinned `pa11y-ci` version, a parsed report instead of console text, and a threshold-aware exit code you don't have to reimplement per repo.

### Design

- pa11y-ci runs as a subprocess, not an imported library, to keep a clean boundary with its [LGPL-3.0 license](https://github.com/pa11y/pa11y-ci/blob/main/LICENSE).
- It's a composite action: one step installs `pa11y-ci@<pa11y-ci-version>` in an isolated directory, the next runs the bundled `dist/index.mjs`. pa11y-ci and its Chromium download aren't bundled.
- The subprocess loads the selected config through a temporary adapter. It overrides config thresholds, rejects duplicate URLs, and disables caller reporters without modifying the source config.
- `npm run build` generates the runtime bundles and [third-party notices](dist/THIRD_PARTY_NOTICES.txt) for their dependencies.

### Known gaps

- The Chromium cache is keyed on the literal `pa11y-ci-version` string. With a range like `^4.0.0`, a newer pa11y-ci that needs a newer Chromium downloads it every run until the range string changes. Pin an exact version to avoid that.
- The config the action builds from inputs runs Chromium with `--no-sandbox`, because `ubuntu-latest`'s [AppArmor policy](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) blocks its sandbox. Only point the action at sites you trust.

## Acknowledgements

🙏 Thanks to the [pa11y](https://github.com/pa11y) maintainers and contributors, who build [pa11y](https://github.com/pa11y/pa11y) and [pa11y-ci](https://github.com/pa11y/pa11y-ci). This action only wraps their work. It isn't affiliated with or endorsed by the pa11y project.
