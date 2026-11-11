# Check saved evaluations in GitHub Actions

SkillDelta’s action compares two existing `results.json` or `checkpoint.json` files. It checks input compatibility and fails if the current run’s measured skill effect declines by more than the allowed number of percentage points. The action reads the saved files locally. It requires no provider credentials, Docker, or package installation.

Use the step after your workflow creates or downloads both evaluation files. Paths are relative to the checkout or absolute paths on the runner.

```yaml
- name: Check skill regression
  id: skilldelta
  uses: 4onv/skilldelta@v0.5.0
  with:
    previous: evaluations/previous/results.json
    current: evaluations/current/results.json
    max_regression_pp: '2'
```

The default tolerance is `0`. A decline equal to the tolerance passes. The action writes a job summary and provides these step outputs.

| Output | Meaning |
| --- | --- |
| `status` | `pass`, `regression`, `incompatible`, `inconclusive`, or `invalid`. Every status except `pass` fails the step. |
| `skill_effect_change_pp` | Signed change in skill effect, in percentage points. Empty when the comparison cannot be made. |
| `simulated` | `true` for two demo runs, `false` otherwise. Empty for invalid inputs. |

Skill effect is the skill pass rate minus the baseline pass rate within one evaluation. The gate compares that difference across evaluations. For example, a previous effect of 10 points and a current effect of 7 points produces a `-3` point change. A tolerance of `2` fails the step.

Use distinct evaluations with matching suite, tests, provider, model, settings, and runtime. Saved comparisons require the input identity recorded by SkillDelta 0.4 or newer. Partial runs and provider or runtime errors produce `inconclusive`. Invalid files and thresholds produce `invalid`. Demo comparisons are labeled simulated in the summary. [Comparison rules](cli.md#history-and-compare)

The action uses the GitHub Actions Node 24 runtime. Use a release commit SHA to pin the code in a workflow. Treat the input files as evaluation records under your workflow’s control. The comparison checks their structure and recorded identity, and computes outcomes from trial records. [GitHub action metadata reference](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax)

## Try it with synthetic data

The repository CI creates two demo runs and exercises successful, regressed, and incomplete comparisons on Ubuntu and Windows. The demo uses generated results to demonstrate the workflow without provider calls. [Action CI workflow](../.github/workflows/ci.yml)
