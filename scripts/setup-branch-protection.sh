#!/usr/bin/env bash
# setup-branch-protection.sh
# Locks down the default branch so code lands only through pull requests that
# pass CI. Run once (re-runnable) with gh authenticated as the repo owner:
#
#   gh auth switch --user alison-queiroz   # the account that owns the repo
#   bash scripts/setup-branch-protection.sh
#
# Override the target if needed:
#   REPO=owner/name BRANCH=master bash scripts/setup-branch-protection.sh
set -euo pipefail

REPO="${REPO:-alison-queiroz/minecraft-server-dashboard}"
BRANCH="${BRANCH:-master}"

# Status-check contexts = the CI job names in .github/workflows/ci.yml.
CONTEXTS='["Lint & Typecheck","Unit Tests","E2E Tests","Build"]'

echo "[INFO] Active gh account:"
gh auth status 2>&1 | grep -E 'Logged in|Active account' || true

echo "[INFO] Verifying admin access to $REPO ..."
if ! gh api "repos/$REPO" -q '.permissions.admin' 2>/dev/null | grep -q true; then
  echo "[ERROR] The active gh account has no admin access to $REPO." >&2
  echo "        Switch to the owner account first: gh auth switch --user <owner>" >&2
  exit 1
fi

echo "[INFO] Applying branch protection to '$BRANCH' ..."
gh api --method PUT "repos/$REPO/branches/$BRANCH/protection" \
  -H "Accept: application/vnd.github+json" --input - <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": $CONTEXTS
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

echo
echo "[SUCCESS] '$BRANCH' now requires:"
echo "  - a pull request before merging (direct pushes blocked, incl. admins)"
echo "  - passing checks: Lint & Typecheck, Unit Tests, E2E Tests, Build"
echo "  - branch up to date (strict) + linear history; no force-push / deletion"
echo
echo "Note: 0 required approvals, so you can merge your own PRs solo."
echo "To let admins bypass in an emergency, set \"enforce_admins\": false and re-run."
