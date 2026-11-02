# PageScope in GitHub Actions

`audit.yml` is an **example workflow**, not a published Marketplace action. Copy it into `.github/workflows/` of your own repository and adjust the trigger.

It runs `npx pagescope@latest`, so it requires the `pagescope` package to be published on npm. Publishing a Marketplace action (a repository with an `action.yml` at its root, referenced as `uses: owner/repo@ref`) is a separate step that this project has **not** done.

## What the example does

1. Installs Node 22.
2. Runs the audit with `--fail-on high`, so the job fails when any finding at severity `high` or above is reported.
3. Uploads `pagescope-report.md` as a build artefact with `if: always()` — the report is most useful precisely when the gate fails.

## Exit codes that matter in CI

| Code | Meaning                               | Typical CI reaction                      |
| ---- | ------------------------------------- | ---------------------------------------- |
| `0`  | Audit completed and the policy passed | job succeeds                             |
| `1`  | Audit completed but the policy failed | job fails, read the artefact             |
| `2`  | Invalid input or configuration        | fix the workflow, not the site           |
| `3`  | The target could not be audited       | investigate reachability, not the policy |

Codes `2` and `3` are not policy failures. Treating them as "the site is bad" is a misreading of the output.
