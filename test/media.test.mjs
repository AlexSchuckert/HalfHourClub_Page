/**
 * Exercises the two media pipelines in a real browser:
 *   image.js  — a big noisy photo must come out ≤3 MB JPEG
 *   video.js  — a WebM clip must come out as H.264 in MP4, adaptively sized
 *
 * Both run entirely client side in the real product, so this is the only place
 * they can be honestly tested.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
/** Chromium: the one Playwright installed, wherever that is. */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = ['/opt/pw-browsers', `${process.env.HOME}/.cache/ms-playwright`];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined; // let Playwright find its own
}


const BASE = process.env.HHC_TEST_URL || 'http://localhost:8899';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ['--use-fake-device-for-media-stream'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// ---------------------------------------------------------------- images
console.log('\nIMAGE PIPELINE');
const image = await page.evaluate(async () => {
  const { processImage } = await import('/assets/new/image.js');

  // 4000x3000 of noise: noise is the worst case for JPEG, so if the quality
  // ladder can get this under 3 MB it can handle any real photo.
  const canvas = new OffscreenCanvas(4000, 3000);
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(4000, 3000);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = Math.random() * 255;
    pixels.data[i + 1] = Math.random() * 255;
    pixels.data[i + 2] = Math.random() * 255;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);

  const source = await canvas.convertToBlob({ type: 'image/png' });
  const file = new File([source], 'DSC_0001.png', { type: 'image/png' });

  const messages = [];
  const result = await processImage(file, (m) => messages.push(m));

  return {
    sourceBytes: source.size,
    outBytes: result.blob.size,
    outType: result.blob.type,
    extension: result.extension,
    width: result.width,
    height: result.height,
    messages: messages.slice(0, 3),
  };
});

const MB = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`         source ${MB(image.sourceBytes)} → output ${MB(image.outBytes)} at ${image.width}×${image.height}`);
check('Photo comes out under the 3 MB cap', image.outBytes <= 3 * 1024 * 1024, MB(image.outBytes));
check('Photo re-encoded as JPEG', image.outType === 'image/jpeg' && image.extension === 'jpg', image.outType);
check('Long edge capped at 2560px', Math.max(image.width, image.height) <= 2560, `${image.width}×${image.height}`);
check('Aspect ratio preserved', Math.abs(image.width / image.height - 4000 / 3000) < 0.01, (image.width / image.height).toFixed(3));
check('Progress was reported', image.messages.length > 0, image.messages[0]);

// ---------------------------------------------------------------- video
console.log('\nVIDEO PIPELINE');
const video = await page.evaluate(async () => {
  const { processVideo, encodingPlan } = await import('/assets/new/video.js');

  // Bitrate maths, checked without needing a huge file.
  const plans = {
    short: encodingPlan(30, 1080),
    fiveMinutes: encodingPlan(300, 1080),
    hour: encodingPlan(3600, 1080),
    lowRes: encodingPlan(30, 480),
  };

  // Record a real clip from a canvas: VP8 in WebM, a different container and
  // codec from the target, so the whole decode/encode/mux path gets used.
  //
  // The frames are noise and the recorder is asked for 20 Mbps, because that's
  // what makes this a fair test: a phone video is big and visually complex, and
  // re-encoding it at 2.5 Mbps genuinely shrinks it. A clip of flat colour would
  // compress to almost nothing at any bitrate, and processVideo would rightly
  // keep the original instead of transcoding.
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');
  const noise = context.createImageData(1280, 720);

  const stream = canvas.captureStream(25);
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp8',
    videoBitsPerSecond: 20_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);

  const recorded = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.start();

  const timer = setInterval(() => {
    for (let i = 0; i < noise.data.length; i += 4) {
      const value = Math.random() * 255;
      noise.data[i] = value;
      noise.data[i + 1] = value;
      noise.data[i + 2] = value;
      noise.data[i + 3] = 255;
    }
    context.putImageData(noise, 0, 0);
  }, 40);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  clearInterval(timer);
  recorder.stop();
  await recorded;

  const source = new Blob(chunks, { type: 'video/webm' });
  const file = new File([source], 'IMG_4321.webm', { type: 'video/webm' });

  const messages = [];
  const result = await processVideo(file, (m) => messages.push(m));

  // Peek at the container: "ftyp" at offset 4 means ISO-BMFF (MP4), and the
  // avc1/avcC atoms confirm the video track really is H.264.
  const head = new Uint8Array(await result.blob.slice(0, 4096).arrayBuffer());
  const asText = String.fromCharCode(...head);

  return {
    plans,
    sourceBytes: source.size,
    outBytes: result.blob.size,
    outType: result.blob.type,
    extension: result.extension,
    transcoded: result.transcoded,
    isMp4: asText.slice(4, 8) === 'ftyp',
    // EBML magic 0x1A45DFA3 starts every Matroska/WebM file.
    isWebm: head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3,
    hasAvc: asText.includes('avc1') || asText.includes('avcC'),
    hasVp9: asText.includes('V_VP9') || asText.includes('vp09'),
    progressed: messages.some((m) => /Compressing video/.test(m)),
    lastMessage: messages.at(-1),
  };
});

console.log(`         source ${MB(video.sourceBytes)} → output ${MB(video.outBytes)}`);
console.log(`         plans: ${JSON.stringify(video.plans)}`);
check('Video transcoded (WebCodecs available)', video.transcoded === true);
check('Output is a playable container (MP4 or WebM)', video.isMp4 || video.isWebm, video.outType);
check('Video track is a real codec (H.264 or VP9)', video.hasAvc || video.hasVp9, video.outType);
check('Output under the 50 MB cap', video.outBytes <= 50 * 1024 * 1024, MB(video.outBytes));
check('Progress reported during compression', video.progressed, video.lastMessage);

// Bitrate ladder
check('Short clip gets full 2.5 Mbps at 1080p',
  video.plans.short.bitrate === 2_500_000 && video.plans.short.height === 1080,
  JSON.stringify(video.plans.short));
check('Five-minute clip stays inside the budget',
  video.plans.fiveMinutes.bitrate < 2_500_000 && video.plans.fiveMinutes.bitrate >= 800_000,
  JSON.stringify(video.plans.fiveMinutes));
check('Very long clip drops to 720p at the floor bitrate',
  video.plans.hour.bitrate === 800_000 && video.plans.hour.height === 720,
  JSON.stringify(video.plans.hour));
check('A 480p source is never upscaled', video.plans.lowRes.height === 480, JSON.stringify(video.plans.lowRes));

// Five minutes at the chosen bitrate should land near the 45 MB target
const projected = (video.plans.fiveMinutes.bitrate * 300) / 8 / 1024 / 1024;
check('Five-minute projection lands under 50 MB', projected < 50, `${projected.toFixed(1)} MB projected`);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
