/**
 * POST /api/geocode — turn the coordinates the browser reports into a place
 * name, so the "New half hour club" form can prefill Location.
 *
 * Why proxy instead of calling OpenStreetMap from the page:
 *   - Nominatim's usage policy wants an identifying User-Agent, and browsers
 *     refuse to let a page set one.
 *   - Gating it on the publish key keeps this from becoming an open geocoding
 *     proxy that anyone who finds the URL can hammer.
 *   - Coordinates leave the browser to one place we control, not to a
 *     third-party script embedded in the page.
 *
 * Only ever returns a coarse label ("Kardamyli, Messenia"), never the raw
 * coordinates, and nothing is logged.
 */

import { timingSafeEqual } from 'node:crypto';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS,
});

function keyMatches(candidate, expected) {
  if (typeof candidate !== 'string' || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

/**
 * Nominatim returns a deep address object. Pick the most human answer: the
 * settlement, then the region — "Kardamyli, Messenia" rather than a full
 * postal address with a house number in it.
 */
function placeLabel(address = {}) {
  const settlement =
    address.village ??
    address.hamlet ??
    address.town ??
    address.suburb ??
    address.city ??
    address.municipality ??
    null;

  const region = address.county ?? address.state_district ?? address.state ?? null;
  const country = address.country ?? null;

  const parts = [settlement, settlement && region !== settlement ? region : null].filter(Boolean);
  if (!parts.length && country) parts.push(country);
  return parts.join(', ');
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return reply(405, { error: 'Use POST.' });
  }

  const expectedKey = process.env.HHC_PUBLISH_KEY;
  if (!expectedKey) {
    return reply(503, { error: 'Geocoding is not configured.' });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return reply(400, { error: 'Expected a JSON body.' });
  }

  if (!keyMatches(payload?.key, expectedKey)) {
    return reply(401, { error: 'Not authorised.' });
  }

  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return reply(400, { error: 'latitude and longitude must be valid coordinates.' });
  }

  // zoom=14 lands on the village/town level: precise enough to be useful, coarse
  // enough that it doesn't read back the exact house.
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', latitude.toFixed(5));
  url.searchParams.set('lon', longitude.toFixed(5));
  url.searchParams.set('zoom', '14');
  url.searchParams.set('addressdetails', '1');

  try {
    const response = await fetch(url, {
      headers: {
        // Nominatim's policy asks callers to identify themselves.
        'User-Agent': 'HalfHourClub-Site (private family archive)',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return reply(502, { error: `Lookup failed (${response.status}).` });
    }

    const result = await response.json();
    const label = placeLabel(result.address) || result.name || '';

    if (!label) {
      return reply(200, { location: '', note: 'Nowhere recognisable at those coordinates.' });
    }

    return reply(200, { location: label });
  } catch (error) {
    // A timeout or a network blip shouldn't break the form — the field just
    // stays on whatever it was prefilled with.
    return reply(504, { error: `Lookup timed out or failed: ${error.message}` });
  }
}
