# Spec: Self-service password reset

## Behavior

After a user submits their registered email to request a reset, the system always returns "If that email exists, we'll send a reset link" — identical whether or not the email exists, so the endpoint can't be used to probe for accounts.

The reset token is single-use, expires after 60 minutes, and is bound only to the email that requested it; opening the link validates the token first, and only then can a new password be set, after which the token is invalidated immediately. The new password keeps the strength requirements from sign-up.

## Alternatives considered

**A reset link that never expires.** Users can click it at any time, but once the token leaks it stays valid indefinitely, which is an uncontrollable risk. Rejected.

**Security questions for identity verification.** It doesn't depend on email, but users often forget the answers, answers are easy to guess, and it adds storage for questions and answers. Rejected.

**Manual reset.** The current process, but slow and it consumes support time; kept as a fallback, not the main path.

## Areas of concern

"Always returns the same sentence" conceals whether an account exists, so error messages at sign-in must tighten in the same change; otherwise the account-probing entry point just moves from the reset page to the sign-in page.

Token storage and transport must be encrypted, and the link may only travel over HTTPS; this is a security boundary, and tests must cover token replay and expiry.
