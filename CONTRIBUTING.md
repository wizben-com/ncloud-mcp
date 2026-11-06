# Contributing

Use Python 3.12+, install `uv`, then `uv sync --frozen`. Run the lint, format,
type, test, secret-check and build commands from README before proposing changes.
All tests must run offline without account credentials or real audio. Do not add
live API tests to CI, even when secrets are available.

New service modules follow `ServiceModule` in `registry.py`. Verify official
endpoints before implementation. Use separate enablement and least-privilege
configuration, bounded input/output, sanitized failures, and explicit side-effect
annotations. No automatic billable retries or broad account credential fallback.
Describe supported platforms and residual security limitations in documentation.
No private repository files, customer information or credentials belong here.
