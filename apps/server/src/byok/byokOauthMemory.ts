/**
 * In-process memory for catalogue providers authenticated via desktop OAuth
 * that do not map onto a Synara harness health status (e.g. xAI).
 */

const connected = new Set<string>();
const accountLabels = new Map<string, string>();

export function markByokOauthConnected(
  providerId: string,
  accountLabel: string | null = null,
): void {
  const id = providerId.trim();
  if (!id) return;
  connected.add(id);
  if (accountLabel) accountLabels.set(id, accountLabel);
  // Keep xai / xai-oauth in sync for OMP id parity.
  if (id === "xai") connected.add("xai-oauth");
  if (id === "xai-oauth") connected.add("xai");
}

export function clearByokOauthConnected(providerId: string): void {
  const id = providerId.trim();
  connected.delete(id);
  accountLabels.delete(id);
  if (id === "xai") {
    connected.delete("xai-oauth");
    accountLabels.delete("xai-oauth");
  }
  if (id === "xai-oauth") {
    connected.delete("xai");
    accountLabels.delete("xai");
  }
}

export function isByokOauthConnected(providerId: string): boolean {
  return connected.has(providerId.trim());
}

export function byokOauthAccountLabel(providerId: string): string | null {
  return accountLabels.get(providerId.trim()) ?? null;
}

export function resetByokOauthMemoryForTests(): void {
  connected.clear();
  accountLabels.clear();
}
