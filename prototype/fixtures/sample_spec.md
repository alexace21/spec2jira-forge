# Customer Profile Settings

## Overview

This specification covers the customer profile settings page where authenticated users can update their account information, contact preferences, and security settings.

## User Personas

- **Standard User** — typical authenticated customer
- **Premium User** — paying subscriber с access к additional features
- **Account Manager** — internal admin user who can edit profiles on behalf of customers (с audit logging)

## Functional Requirements

### Profile Information

Users should be able to view and edit:
- Display name (2-50 characters, alphanumeric + spaces)
- Profile photo (JPG/PNG, max 5MB, auto-cropped к 500×500)
- Phone number (E.164 format, validated against carrier database)
- Mailing address (full address с country dropdown)

### Email Management

Primary email cannot be changed directly — requires email verification flow:
1. User initiates email change в settings
2. Verification email sent к NEW email address
3. User clicks verification link (24-hour expiry)
4. Old email retained as backup until new email confirmed

### Contact Preferences

Toggle preferences for:
- Marketing emails (opt-in by default for new accounts; GDPR-compliant consent capture required)
- Product updates (default ON)
- Security alerts (mandatory ON — cannot be disabled)
- SMS notifications (requires verified phone number)

### Security Settings

- Change password (current password required; new password must pass complexity rules; password history check — cannot reuse last 5)
- Two-factor authentication (TOTP via authenticator app; backup codes generated on setup)
- Active sessions list с device info + revoke capability
- Login history (last 30 days; downloadable as CSV для compliance)

## Acceptance Criteria

- All profile updates must be logged в audit log с user_id, field_changed, old_value_hash, new_value_hash, timestamp, ip_address
- Email verification links expire after 24 hours
- Password complexity: minimum 12 characters, at least 1 uppercase, 1 number, 1 special character
- Profile photo upload must complete within 10 seconds OR show progress indicator
- All forms include client-side validation BEFORE submission

## Non-Functional Requirements

- All API endpoints respond в <500ms (95th percentile)
- GDPR Article 7 consent requirements apply к marketing email opt-in
- Audit log retention: 7 years (regulatory requirement)
- Failed login attempts: rate-limited к 5 per 15 minutes per account

## Out of Scope

- Account deletion / closure flow (separate спецификация)
- Subscription tier management (handled в billing module)
- Username changes (display name only; account ID/email е primary identifier)

## Open Questions

- Should Account Manager edits notify the customer via email? (Compliance asks; product not yet decided)
- Photo moderation — automated NSFW filtering required? (Risk; legal review pending)
