# Intent: Self-service password reset

## Problem

Users who forget their password can only ask support to reset it by hand; support handles dozens of tickets a week, and users wait half a day on average before they can sign in again.

## Proposed outcome

Users start a reset themselves with their registered email, click the link in the email, and set a new password within two minutes, with no support involvement.

## Constraints

- Reset is only possible through the registered email; accounts without a verified email keep using the support channel.
- The reset link is single-use and dies on first use; no account information beyond the password is added.
