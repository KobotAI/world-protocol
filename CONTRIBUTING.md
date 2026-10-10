# Contributing

Thanks for helping improve World Protocol and WorldKit.

## Development

Use Node.js 20+ and pnpm 10.17.1.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Keep changes framework-neutral. Public packages must not depend on a particular database, commerce provider, deployment platform, application framework, private service, or real customer data.

Add tests for behavior changes and update package documentation when public APIs change.

## Developer Certificate of Origin

Contributions use the Developer Certificate of Origin 1.1 instead of a contributor license agreement. Sign off every commit:

```sh
git commit --signoff
```

The sign-off certifies that you have the right to submit the contribution under this repository's license. Read the DCO at <https://developercertificate.org/>.

## Pull requests

- Keep each pull request focused.
- Explain compatibility and security implications.
- Include a changeset or explicit release note when changing a published package.
- Ensure CI passes before requesting review.
- Do not include secrets, private URLs, production data, or generated build output.

## Reporting security issues

Do not open public issues for vulnerabilities. Follow `SECURITY.md`.
