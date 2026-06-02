/** Payload type for triggering notifications from the Order Saga */
export interface NotificationTrigger {
  userId: string;
  type: string;
  data: Record<string, string>;
}
