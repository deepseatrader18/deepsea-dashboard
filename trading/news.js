const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

async function getForexFactoryNews() {
  try {
    const res = await fetch(FF_CALENDAR_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { available: false, reason: `http ${res.status}` };
    const events = await res.json();
    if (!Array.isArray(events)) return { available: false, reason: 'unexpected response shape' };

    const highImpact = events
      .filter(e => e && String(e.impact).toLowerCase() === 'high')
      .map(e => ({
        title: e.title || '(untitled)',
        country: e.country || '',
        date: e.date || null,
        forecast: e.forecast || null,
        previous: e.previous || null,
        actual: e.actual || null
      }));

    return { available: true, data: highImpact };
  } catch (err) {
    console.error('Forex Factory news fetch failed:', err.message);
    return { available: false, reason: err.message };
  }
}

module.exports = { getForexFactoryNews };
