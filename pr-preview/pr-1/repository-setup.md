# GitHub repository setup

The workflows and bot configurations are included, but the following GitHub settings cannot be transferred by copying files. No secrets are stored in this repository.

| Service | Required setup |
| --- | --- |
| GitHub Actions | Enable Actions. Permit workflow-generated pull requests and the scoped `contents`/`pull-requests` permissions used by the badge, preview and release jobs. |
| Pages | Configure deployment from branch `gh-pages`, root directory. The existing Pages workflow and PR preview publisher both publish there. |
| CodeRabbit | Install/authorize the CodeRabbit GitHub App for `JellyPlugins/jellyfin-watchback`; `.coderabbit.yaml` defines its review behavior. |
| Renovate | Use the included self-hosted workflow with `RENOVATE_APP_CLIENT_ID` (or `RENOVATE_APP_ID`) and `RENOVATE_APP_PRIVATE_KEY`, or a `RENOVATE_TOKEN` with access to this repository. Do not run a second bot instance against the same repository. |
| Docker Hub | Optional `DOCKER_HUB_USERNAME` and `DOCKER_HUB_PASSWORD` for Renovate registry lookups. |
| Codecov | Add the repository to Codecov and configure `CODECOV_TOKEN`. Backend, frontend and E2E analytics keep separate flags. |
| SonarCloud | Create project `JellyPlugins_jellyfin-watchback` in organization `jellyplugins`; configure `SONAR_TOKEN`. The analysis step skips when no token is present. |
| CodeQL | Enable code scanning if required by the organization's GitHub plan; the included workflow analyzes C#. |
| Branch protection | Select the new repository's actual PR check names after its first run. No protection rules were copied or changed automatically. |

The release workflow includes security checks, release-note collection, a metadata/checksum update PR, and pinned action revisions. The initial development manifest has empty download/checksum/timestamp fields until the first publication.

The local verification of workflow files cannot prove that external apps, tokens, organization policies, Codecov or SonarCloud have been configured. The first pushed PR must run these jobs in GitHub before enabling required checks.
