# Security

This project is an early prototype. Security fixes target the current `main`
branch; older deployments should be updated before continued use.

## Report a vulnerability

Please do not post credentials, private source material, exploit payloads, or
details of an unpatched vulnerability in a public issue.

Use GitHub's **Security → Report a vulnerability** on this repository when
private reporting is available. Otherwise, open an issue requesting a private
security contact without disclosing the vulnerability itself. Fork maintainers
should configure their own private reporting channel.

Include the affected revision, a concise description, impact, and minimal
reproduction steps using synthetic data. Do not test against the public site,
other people's accounts, or paid services without permission. There is no
guaranteed response time or bug-bounty program.

## If a credential is exposed

Revoke or rotate it immediately, update the relevant secret store, and inspect
provider/account activity. Deleting a file or commit does not revoke a secret.
Never include the exposed value in an issue or pull request.

## Deployment responsibility

Keep populated environment files out of Git, use scoped AWS profiles and
Secrets Manager, and never place secrets in `NEXT_PUBLIC_*` configuration.
Review IAM, costs, source permissions, and provider data handling before
enabling unattended generation. Public worlds and summaries are intentionally
public; operational artifacts and credentials must remain private.
