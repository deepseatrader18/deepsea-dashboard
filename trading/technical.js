async function getTechnicalAnalysis(env, symbol) {
  if (!env.TECHNICAL_SERVICE_URL) return { available: false, reason: 'not configured' };
  try {
    const res = await fetch(
      `${env.TECHNICAL_SERVICE_URL}/analyze?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(30000) }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { available: false, reason: `http ${res.status}${body ? `: ${body}` : ''}` };
    }
    const data = await res.json();
    return { available: true, data };
  } catch (err) {
    console.error('Technical analysis fetch failed:', err.message);
    return { available: false, reason: err.message };
  }
}

module.exports = { getTechnicalAnalysis };
