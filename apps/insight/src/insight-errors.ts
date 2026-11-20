/**
 * Error codes of insight (letter N, api-conventions §6).
 * `N001` is also answered (404) when a store's notification is not found; the announcements of the admin area use
 * it with 400 for "already sent", as the web's contract names it: the status tells them apart.
 */
export const InsightErrorCode = {
  NOTIFICATION_NOT_FOUND: 'N001',
  ANNOUNCEMENT_ALREADY_SENT: 'N001',
  ANNOUNCEMENT_NO_AUDIENCE: 'N002',
  ANNOUNCEMENT_SCHEDULED: 'N003',
} as const;
