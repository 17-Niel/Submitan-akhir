export function sanitizePushSubscription(subscription) {
  const json = typeof subscription?.toJSON === 'function'
    ? subscription.toJSON()
    : subscription;

  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    },
  };
}
