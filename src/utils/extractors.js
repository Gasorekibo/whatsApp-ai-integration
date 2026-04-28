export function extractWebhookPayload(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  return {
    phoneNumberId: value?.metadata?.phone_number_id,
    message:       value?.messages?.[0],
    contact:       value?.contacts?.[0],
    statuses:      value?.statuses,
    value,
  };
}
