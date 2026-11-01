# Example suite

These three JavaScript tasks have explicit contracts and executable tests. A
task passes only when **all** of its tests pass. The test files are evaluation
inputs: the runner copies each into a fresh workspace as
`__skilldelta.test.mjs`, alongside the generated `solution.mjs`.

`edge-cases/SKILL.md` contains general implementation guidance. It does not
contain the task solutions.

## The demo is synthetic

`demo-solutions.json` contains deliberately authored baseline and skill outputs.
They are **not model responses**. The baseline passes one of three tasks; the
skill variant passes all three. The demo runs real tests against these outputs
to demonstrate the report and comparison workflow. These results are not
evidence that the example skill improves any model.

For a real evaluation, run the suite with a configured model, repeat trials,
and inspect both successful and failed generated implementations. This small
suite is a getting-started example, not a broad coding benchmark.
