/** Local turn detection: brief noises never submit a recording. Times are monotonic ms. */
export function createVoiceActivity(startedAt: number) {
  let voicedMs = 0, lastSample = startedAt, lastVoice = startedAt;
  return (rms: number, now: number): 'listen' | 'submit' | 'quiet' => {
    const elapsed = Math.max(0, Math.min(100, now - lastSample));
    lastSample = now;
    if (rms >= 0.015) { voicedMs += elapsed; lastVoice = now; }
    if (voicedMs >= 250 && (now - lastVoice >= 1400 || now - startedAt >= 60_000)) return 'submit';
    if (now - startedAt >= 20_000 && voicedMs < 250) return 'quiet';
    return 'listen';
  };
}
