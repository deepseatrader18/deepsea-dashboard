async function fetchOnce(env, symbol, timeoutMs) {
  const res = await fetch(
    `${env.TECHNICAL_SERVICE_URL}/analyze?symbol=${encodeURIComponent(symbol)}`,
    { signal: AbortSignal.timeout(timeoutMs) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`http ${res.status}${body ? `: ${body}` : ''}`);
  }
  return res.json();
}

// Render's free tier spins deepsea-technical-service down after ~15 min
// idle; waking it back up can take 30-50s. A single request with a short
// timeout was failing on exactly that cold-start window and reporting
// "unavailable" even though the service was fine — just not awake yet. Give
// the first attempt enough time to cover a cold start, then retry once
// quickly (by then the service is warm, so it should respond fast).
async function getTechnicalAnalysis(env, symbol) {
  if (!env.TECHNICAL_SERVICE_URL) return { available: false, reason: 'not configured' };
  try {
    const data = await fetchOnce(env, symbol, 40000);
    return { available: true, data };
  } catch (firstErr) {
    console.error('Technical analysis fetch failed (attempt 1):', firstErr.message);
    try {
      const data = await fetchOnce(env, symbol, 15000);
      return { available: true, data };
    } catch (secondErr) {
      console.error('Technical analysis fetch failed (attempt 2):', secondErr.message);
      return { available: false, reason: secondErr.message };
    }
  }
}

module.exports = { getTechnicalAnalysis };
