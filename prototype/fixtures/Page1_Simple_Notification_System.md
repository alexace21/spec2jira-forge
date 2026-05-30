# In-App Notification System

## Feature Overview

The In-App Notification System delivers real-time notifications to users within the web application. It supports multiple notification types, user preference management, and read/unread tracking.

## Business Value

Users currently rely on email for all system communications, leading to missed time-sensitive alerts and notification fatigue. An in-app system provides immediate visibility for critical events while reducing email volume by 60%.

## Functional Requirements

### Notification Types

The system supports four notification categories:

- **System Alerts:** Maintenance windows, security warnings, platform updates. Sent to all users or role-based groups. Cannot be dismissed without acknowledgment.
- **Workflow Events:** Task assignments, approval requests, status changes, deadline reminders. Triggered by business process events. Linked to the source entity (task, document, request).
- **Social/Collaboration:** Comments on shared items, @mentions, team announcements. Real-time delivery via WebSocket connection.
- **Billing/Account:** Payment confirmations, subscription changes, usage threshold warnings. Sent to users with Billing Admin role only.

### Notification Delivery

When a notification is triggered:
1. The event is published to the notification service message queue
2. The service resolves target recipients based on event type and routing rules
3. For each recipient, the service checks notification preferences
4. If in-app delivery is enabled, the notification is stored and pushed via WebSocket
5. If email delivery is enabled, the notification is queued for email dispatch
6. The notification bell icon updates with unread count in real-time

### User Preferences

Each user can configure preferences per notification category:
- **In-App:** Always on for System Alerts; toggleable for other categories
- **Email:** Configurable as Immediate, Daily Digest, or Off
- **Quiet Hours:** Define hours when only Critical notifications trigger push (e.g., 22:00–07:00)

Preferences are stored per user and applied at delivery time. Default preferences are set by organization admin.

### Notification Center UI

The notification center is accessible via a bell icon in the application header:
- Dropdown shows last 20 notifications with unread highlighted
- "View All" opens full notification history with filters (type, date range, read/unread)
- Click on notification navigates to the related entity
- Mark as read: individual or "Mark all as read"
- Bulk actions: archive, delete (soft-delete, retained 90 days)

### Notification API

RESTful API for programmatic access:
- `GET /api/v1/notifications` — list with pagination and filters
- `GET /api/v1/notifications/{id}` — single notification detail
- `PATCH /api/v1/notifications/{id}` — mark read/unread
- `GET /api/v1/notifications/unread-count` — badge count
- `PUT /api/v1/notifications/preferences` — update user preferences

Rate limit: 100 requests/minute per user. Authentication via OAuth 2.0 Bearer token.

## Acceptance Criteria

1. Notification appears in-app within 3 seconds of triggering event
2. Unread count badge updates in real-time without page refresh
3. System Alerts cannot be dismissed without explicit acknowledgment click
4. Email digest aggregates notifications from the configured period into a single email
5. Quiet Hours suppress non-critical notifications during defined time window
6. Notification history retains all notifications for 90 days
7. API returns paginated results within 200ms for up to 1000 notifications
8. User preference changes take effect immediately for subsequent notifications

## Dependencies

- WebSocket gateway (existing infrastructure)
- Email service (SendGrid integration)
- Message queue (existing RabbitMQ)
- User service (for preferences and role resolution)
- OAuth 2.0 identity provider

## Out of Scope

- Push notifications to mobile devices (Phase 2)
- SMS notification channel (Phase 2)
- Notification templates customizable by end users
- Integration with Slack or Microsoft Teams

## Technical Considerations

Use WebSocket for real-time delivery with HTTP long-polling fallback. Store notifications in PostgreSQL with partitioning by month for efficient cleanup. Message queue ensures at-least-once delivery; idempotency keys prevent duplicate notifications. Consider Redis for caching unread counts to avoid frequent DB queries on the hot path.
