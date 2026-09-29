/** Keep durable history intact; only restore the current authenticated login into chat. */
export async function loadChatSessionStart(): Promise<number> {
  const response = await fetch('/api/manager/chat-session', {credentials:'same-origin', cache:'no-store'});
  if (!response.ok) throw Error('Session unavailable');
  const data = await response.json() as {startedAt?:string};
  const start = Date.parse(data.startedAt ?? '');
  if (!Number.isFinite(start)) throw Error('Session unavailable');
  return start;
}
export function currentSessionTurns<T extends {created_at:string}>(turns:T[], startedAt:number):T[] {
  return turns.filter(turn => Date.parse(turn.created_at) >= startedAt);
}
