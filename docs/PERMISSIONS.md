# Grassion GitHub App — Required Permissions

## Current permissions

| Permission | Level | Purpose |
|---|---|---|
| `contents` | Read | List files changed in pull requests |
| `pull_requests` | Read | Fetch PR metadata (title, body, labels, reviews, commits) |
| `metadata` | Read | Required by GitHub App framework |
| `statuses` | Read | Read CI status for outcome tracking |

## Permissions added for Human Coverage (v2)

| Permission | Level | Purpose |
|---|---|---|
| `checks` | Write | Create and update "Grassion Human Coverage" check runs on each PR |
| `pull_requests` | Write | Request reviewers on PRs based on coverage data |
| `members` | Read | Read org member list to spread reviewer load and skip org bots |

### Why each new permission is needed

**`checks:write`**
The Human Coverage check run feature posts a check to every PR on open and synchronize. The check run includes a coverage breakdown by area and three `requested_actions` buttons that authors can click to record understanding answers. This requires write access to the Checks API.

**`pull_requests:write`** (upgrade from read)
After computing coverage, Grassion automatically suggests reviewers for dark or fragile areas. This requires the ability to add review requests to PRs via the GitHub API.

**`members:read`**
Used to enumerate org members so Grassion can distribute review load evenly, skip bot accounts, and avoid over-requesting reviewers who already have many open reviews.

## Requesting updated permissions

When upgrading an existing installation to include new permissions, GitHub will prompt each organisation admin to review and accept the updated permission set before the new features activate. Teams on the `trial` or `starter` plan will not receive HC check runs; Pro plan (`team` or `business`) is required.

## Webhook events subscribed

| Event | Used by |
|---|---|
| `installation` | Team onboarding / offboarding |
| `installation_repositories` | Repo connect / disconnect |
| `pull_request` | PR tracking, HC check runs |
| `pull_request_review` | Evidence: substantive review |
| `check_run` | Outcome tracking, HC understanding answers |
| `push` | Outcome tracking |
