/**
 * Compress a video, in the browser, before it is uploaded.
 *
 * Uses mediabunny, which drives the browser's own video encoder via WebCodecs —
 * so a two-minute clip takes seconds rather than the minutes an ffmpeg-in-WASM
 * transcode would need, and the phone doesn't get hot doing it.
 *
 * Target: long edge at most 1080p, roughly 2.5 Mbps — about 19 MB per minute,
 * which looks good on a laptop and streams fine over a phone connection.
 *
 * Long clips get a lower bitrate rather than a bigger file: a fixed 2.5 Mbps
 * would put a five-minute video at 94 MB, past both our cap and what's sensible
 * to keep in a git repo. So the bitrate is chosen to land the whole clip inside
 * TARGET_BYTES, with a floor below which we drop to 720p instead of letting the
 * picture fall apart at 1080p.
 *
 * Codec ladder
 * ------------
 * H.264 + AAC in MP4 is the first choice because it plays on absolutely
 * everything, including elderly iPads. But H.264 and AAC are patent-encumbered
 * and some browsers ship without the encoders (Chromium builds without
 * proprietary codecs, for instance), so VP9 + Opus in WebM is the next rung —
 * that plays in every current browser and still shrinks the file enormously.
 * Only when neither is available do we upload the original untouched.
 */

const MEDIABUNNY = '/assets/vendor/mediabunny.min.mjs';

const TARGET_BYTES = 45 * 1024 * 1024; // aim here…
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // …refuse anything above here
const MAX_BITRATE = 2_500_000;
const MIN_BITRATE = 800_000;
const BITRATE_FOR_720P = 1_200_000; // below this, 1080p looks worse than 720p
const AUDIO_BITRATE = 128_000;

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Rungs in preference order. Each names a container and the codecs that belong
 * in it — pairing matters, because Opus in MP4 or AAC in WebM would technically
 * mux but play badly in the wild.
 */
const LADDER = [
  { format: 'Mp4OutputFormat', extension: 'mp4', mime: 'video/mp4', video: 'avc', audio: 'aac' },
  { format: 'WebMOutputFormat', extension: 'webm', mime: 'video/webm', video: 'vp9', audio: 'opus' },
];

/**
 * Work out the video bitrate and height for a clip of a given length.
 * Exported so it can be checked without encoding anything.
 */
export function encodingPlan(durationSeconds, sourceHeight) {
  // Leave room for the audio track inside the budget.
  const videoBudget = TARGET_BYTES * 8 - AUDIO_BITRATE * durationSeconds;
  const fitted = durationSeconds > 0 ? videoBudget / durationSeconds : MAX_BITRATE;

  const bitrate = Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, fitted)));
  const ceiling = bitrate < BITRATE_FOR_720P ? 720 : 1080;

  return {
    bitrate,
    // Never upscale: a 480p phone clip stays 480p.
    height: Math.min(sourceHeight || ceiling, ceiling),
  };
}

/**
 * Pick the best rung this browser can actually encode.
 * @returns {Promise<object|null>} the chosen rung, or null if none will work
 */
async function chooseCodecs(mediabunny) {
  for (const rung of LADDER) {
    const [videoOk, audioOk] = await Promise.all([
      mediabunny.canEncodeVideo(rung.video),
      mediabunny.canEncodeAudio(rung.audio),
    ]);
    // Video is the point; a clip with no soundtrack is still worth having, so a
    // missing audio encoder only means we drop the audio track.
    if (videoOk) return { ...rung, withAudio: audioOk };
  }
  return null;
}

const extensionOf = (file) => {
  const fromName = (file.name.split('.').pop() || '').toLowerCase();
  if (fromName && fromName !== file.name.toLowerCase()) return fromName;
  return file.type === 'video/webm' ? 'webm' : 'mp4';
};

/**
 * @param {File} file
 * @param {(message: string, fraction?: number) => void} onProgress
 * @returns {Promise<{blob: Blob, extension: string, transcoded: boolean}>}
 */
export async function processVideo(file, onProgress = () => {}) {
  onProgress('Loading the video compressor…');

  const mediabunny = await import(MEDIABUNNY);
  const { Input, Output, Conversion, BlobSource, BufferTarget, ALL_FORMATS } = mediabunny;

  const rung = await chooseCodecs(mediabunny);

  if (!rung) {
    // No usable encoder at all. Keep the original if it's a reasonable size.
    if (file.size <= VIDEO_MAX_BYTES) {
      onProgress(`This browser cannot compress video — uploading as it is (${megabytes(file.size)}).`);
      return { blob: file, extension: extensionOf(file), transcoded: false };
    }
    throw new Error(
      `This browser cannot compress video, and the file is ${megabytes(file.size)} — ` +
        `too big to upload as it is (limit ${megabytes(VIDEO_MAX_BYTES)}). ` +
        `Try a shorter clip, or add it from a different device.`
    );
  }

  onProgress('Reading the video…');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  // Prefer the container's own duration: it's a metadata read, where
  // computeDuration() walks every packet. Approximate is fine for choosing a
  // bitrate, so only fall back to the slow path when metadata is missing.
  const duration =
    (await input.getDurationFromMetadata().catch(() => null)) ?? (await input.computeDuration());

  const videoTrack = await input.getPrimaryVideoTrack();
  const plan = encodingPlan(duration, videoTrack?.displayHeight);

  const output = new Output({
    format: new mediabunny[rung.format](),
    target: new BufferTarget(),
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      codec: rung.video,
      height: plan.height,
      bitrate: plan.bitrate,
      // `contain` keeps the aspect ratio rather than stretching a portrait clip.
      fit: 'contain',
    },
    audio: rung.withAudio ? { codec: rung.audio, bitrate: AUDIO_BITRATE } : { discard: true },
  });

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((track) => track.reason).join(', ');
    throw new Error(`This video can't be converted${reasons ? ` (${reasons})` : ''}.`);
  }

  // Progress must be wired up before execute() for mediabunny to compute it.
  conversion.onProgress = (fraction) => {
    onProgress(`Compressing video — ${Math.round(fraction * 100)}%`, fraction);
  };

  await conversion.execute();

  if (!output.target.buffer) {
    throw new Error('The compressor produced no output — the video may be damaged.');
  }

  const blob = new Blob([output.target.buffer], { type: rung.mime });

  /* Re-encoding a clip that was already heavily compressed — a short screen
     recording, or something a messaging app has already squeezed — can come out
     bigger than it went in. Keep whichever is smaller; there's no sense storing
     our version when the original was leaner. */
  if (blob.size >= file.size && file.size <= VIDEO_MAX_BYTES) {
    onProgress(`Already small enough at ${megabytes(file.size)} — keeping the original.`, 1);
    return { blob: file, extension: extensionOf(file), transcoded: false };
  }

  // The adaptive bitrate should prevent this, but a pathological input could
  // still overshoot. Better a clear message than a rejected push.
  if (blob.size > VIDEO_MAX_BYTES) {
    throw new Error(
      `Even compressed, this clip is ${megabytes(blob.size)} — over the ` +
        `${megabytes(VIDEO_MAX_BYTES)} limit. Try trimming it first.`
    );
  }

  onProgress(`Compressed to ${megabytes(blob.size)} (from ${megabytes(file.size)}).`, 1);
  return { blob, extension: rung.extension, transcoded: true };
}
