# Plan: Self-service password reset

## Files

- `accounts/reset.py` (new): three entry points — request a reset, validate a token, set a new password.
- `accounts/reset_test.py` (new): tests for token expiry, replay, account probing, and related scenarios.
- `mail/reset.html` (new): the reset email template and link.
- `docs/accounts.md`: document the reset flow and token lifetime.

## Order of work

1. Add the "request reset" entry point, pinned to the same sentence from the start, without sending real email — the behavior is invisible to users at this point.
2. Implement token generation, storage, and validation, and wire up email delivery.
3. Add the "set new password" entry point; the token dies on first use.
4. Add tests and `docs/accounts.md`.

## Risks

- "Always return the same sentence" leaves users unsure whether the email went out, so the product needs a clear "sent" confirmation.
- The token table grows with every request and needs expired-token cleanup, which is new operational work.

## Proof

- Unit tests: a token expires after 60 minutes; the same token is rejected on second use; a nonexistent and an existing email return the same response.
- Integration test: walk the full path "request → receive email → click link → set new password → sign in with the new password".
- Measurement: support's reset tickets drop from dozens a week to single digits.
