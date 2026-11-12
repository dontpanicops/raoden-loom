#!/usr/bin/env bash
# Merge a PR only when every check passed (a cancelled or skipped check blocks), confirm MERGED, delete the branch.
# Usage: scripts/merge-pr.sh <pr-number>
set -euo pipefail
pr="${1:?usage: merge-pr.sh <pr-number>}"

checks=$(gh pr checks "$pr" --json name,bucket)
if [ "$(jq 'length' <<<"$checks")" -eq 0 ]; then echo "no checks on PR $pr" >&2; exit 1; fi
bad=$(jq -r '.[] | select(.bucket != "pass") | "\(.name)=\(.bucket)"' <<<"$checks")
if [ -n "$bad" ]; then echo "not all checks passed:" >&2; echo "$bad" >&2; exit 1; fi

branch=$(gh pr view "$pr" --json headRefName -q .headRefName)
gh pr merge "$pr" --merge
state=$(gh pr view "$pr" --json state -q .state)
if [ "$state" != "MERGED" ]; then echo "PR $pr state is $state, branch kept" >&2; exit 1; fi
git push origin --delete "$branch"
echo "PR $pr merged, branch $branch deleted"
