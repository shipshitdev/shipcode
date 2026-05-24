---
name: plan-execution-tdd
description: Supplementary TDD protocol injected into execution prompts when testCommand is configured
---

<testing_protocol>
When implementing changes, follow the test-driven development cycle for every behavioral change:

1. RED — Write a failing test first.
   - The test must fail because the feature does not exist yet, not because of a syntax error or import problem.
   - Run the test. Confirm it fails. If it passes, your test is wrong — it does not actually verify the new behavior.

2. GREEN — Write the minimum code to make the test pass.
   - Do not write more than the test demands. Resist the urge to generalize.
   - Run the test again. Confirm it passes.

3. REFACTOR — Clean up while tests stay green.
   - Extract shared setup, rename for clarity, remove duplication.
   - Run the full relevant test file after each refactor step.

Bug fixes use the Prove-It Pattern:
1. Write a test that reproduces the bug (it must fail).
2. Confirm the test fails for the right reason.
3. Fix the code.
4. Confirm the test passes.
5. Run the broader test suite to check for regressions.

Hard limits:
- Never write more than 100 lines of implementation code without running tests.
- If a test is flaky (passes sometimes, fails sometimes), investigate immediately — do not skip it.
- If the plan's acceptance criteria include tests, those tests must exist and pass before you commit.
</testing_protocol>
