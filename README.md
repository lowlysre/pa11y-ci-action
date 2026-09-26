<p align="center">
  <img src="assets/hero.svg" alt="pa11y-ci-action: Unofficial GitHub Action for pa11y-ci" width="100%">
</p>

<p align="center">
  <a href="https://github.com/lowlysre/pa11y-ci-action/actions/workflows/ci.yml"><img src="https://github.com/lowlysre/pa11y-ci-action/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/lowlysre/pa11y-ci-action" alt="License"></a>
</p>

# pa11y-ci-action

A GitHub Action wrapper for [pa11y-ci](https://github.com/pa11y/pa11y-ci): run WCAG accessibility checks against a list of URLs or a sitemap, and get a job summary (and, optionally, a sticky PR comment) instead of raw console output.

## Tutorial: quickstart

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

If a `.pa11yci`, `.pa11yci.json`, `.pa11yci.js`, or `.pa11yci.cjs` file exists in `working-directory`, the action uses it as-is via pa11y-ci's own `--config` flag. The `urls`, `sitemap`, `standard`, and `concurrency` inputs are only used to synthesize a config when none of those files exist, so set them directly in your `.pa11yci` file instead.

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

`threshold` is passed straight through to pa11y-ci's own `--threshold` flag: the number of issues permitted before the action fails. Set it above `0` to allow a known baseline of issues while still catching regressions:

```yaml
      - uses: lowlysre/pa11y-ci-action@acce551b1e4a119f2d7c03e8b16a5d4c7e91f0a3 # v1.0.0
        with:
          sitemap: https://example.com/sitemap.xml
          threshold: 5
```

### Pin or upgrade the pa11y-ci version

The action installs `pa11y-ci` itself at run time rather than shipping it bundled, so `pa11y-ci-version` accepts any npm version range: pin it for reproducibility, or bump it ahead of this action's own default to pick up an upstream fix or a new pa11y-ci release:

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
      - uses: lowlysre/pa11y-ci-action@acce551b1e4a119f2d7c03e8b16a5d4c7e91f0a3 # v1.0.0
        with:
          urls: https://example.com
          comment-on-pr: true
```

`comment-on-pr` is a no-op (with a warning) on any event other than `pull_request`, so it's safe to leave set on a workflow that also runs on `push`.

## Reference

### Inputs

| Input | Description | Default |
| --- | --- | --- |
| `config` | Path to an existing pa11y-ci config file. | looked up automatically |
| `urls` | Newline-separated URLs to test. Only used when no config file is found. | |
| `sitemap` | Sitemap URL to crawl. Only used when no config file is found. | |
| `standard` | `WCAG2A`, `WCAG2AA`, or `WCAG2AAA`. Only used when no config file is found. | `WCAG2AA` |
| `threshold` | Number of issues permitted before the action fails. | `0` |
| `concurrency` | Pages to test in parallel. Only used when no config file is found. | `1` |
| `working-directory` | Directory to resolve the config file and run pa11y-ci from. | `.` |
| `pa11y-ci-version` | Version of `pa11y-ci` to install and run, as an npm version range. | `4.1.1` |
| `cache` | Cache the Chromium build between runs. Set to `false` to download it fresh every run. | `true` |
| `comment-on-pr` | Post or update a sticky summary comment on the triggering pull request. | `false` |
| `github-token` | Token used for `comment-on-pr`. Needs `pull-requests: write`. | `github.token` |

### Outputs

| Output | Description |
| --- | --- |
| `total-urls` | Number of URLs tested. |
| `passed-urls` | Number of URLs with no issues. |
| `total-issues` | Total issues found across all URLs. |
| `passed` | `true` if the run was within the configured threshold. |
| `report-json` | Path to the raw pa11y-ci JSON report on the runner's temp directory. |
| `cache-hit` | `true` if the Chromium cache was restored. Empty when `cache` is `false`. |

### Permissions

The action itself needs no permissions beyond `contents: read` to check out the config file. `comment-on-pr: true` additionally needs `pull-requests: write` on the job.

## Explanation

### Why not `npx pa11y-ci` in your own workflow

You can, and plenty of repos do. This wraps that in one `uses:` line with a pinned `pa11y-ci` version, a parsed report instead of console text, and a threshold-aware exit code you don't have to reimplement per repo.

### Design

- pa11y-ci runs as a subprocess, not an imported library, to keep a clean boundary with its [LGPL-3.0 license](https://github.com/pa11y/pa11y-ci/blob/main/LICENSE).
- It's a composite action: one step installs `pa11y-ci@<pa11y-ci-version>`, the next runs the bundled `dist/index.mjs`. pa11y-ci and its Chromium download aren't bundled.

### Known gaps

- The Chromium cache is keyed on the literal `pa11y-ci-version` string. With a range like `^4.0.0`, a newer pa11y-ci that needs a newer Chromium downloads it every run until the range string changes. Pin an exact version to avoid that.
- The config the action builds from inputs runs Chromium with `--no-sandbox`, because `ubuntu-latest`'s [AppArmor policy](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) blocks its sandbox. Only point the action at sites you trust.

## Acknowledgements

Thanks to the [pa11y](https://github.com/pa11y) maintainers and contributors, who build pa11y and pa11y-ci. This action only wraps their work. It isn't affiliated with or endorsed by the pa11y project.
