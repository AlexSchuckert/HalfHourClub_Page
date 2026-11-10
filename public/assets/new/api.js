/**
 * The form's conversation with the server. Every request carries the page's
 * CSRF token; the sign-in cookie travels on its own.
 */

const config = JSON.parse(document.getElementById('form-config').textContent);

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': config.csrf },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(explain(response.status, data.error));
  return data;
}

function explain(status, message) {
  if (status === 401) return 'You have been signed out on this device. Sign in again in another tab, then save.';
  if (status === 413) return 'That file is larger than the server accepts.';
  return message || `The server said ${status}. Try again in a moment.`;
}

export const saveClub = (club) => post(club.id ? `/api/clubs/${club.id}` : '/api/clubs', club);
export const deleteClub = (id, revision) => post(`/api/clubs/${id}/delete`, { revision });
export const geocode = (latitude, longitude) => post('/api/geocode', { latitude, longitude });

/**
 * Upload one processed file. XMLHttpRequest rather than fetch, because fetch
 * still can't report upload progress, and a 40 MB video on a holiday
 * connection needs a progress bar.
 *
 * @returns {Promise<{name: string, size: number}>}
 */
export function uploadMedia(blob, filename, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('file', blob, filename);
    const request = new XMLHttpRequest();
    request.open('POST', '/api/media');
    request.setRequestHeader('X-CSRF-Token', config.csrf);
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status === 200 && request.response?.name) resolve(request.response);
      else reject(new Error(explain(request.status, request.response?.error)));
    };
    request.onerror = () => reject(new Error('The upload was interrupted. Check the connection and try again.'));
    request.send(body);
  });
}
