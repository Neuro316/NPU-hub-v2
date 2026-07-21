// src/lib/audio-wav.ts
// Browser-side transcode: MediaRecorder output -> a WAV file Twilio can <Play>.
//
// THE TRAP THIS EXISTS TO AVOID:
//   MediaRecorder produces WebM/Opus (Chrome, Firefox) or MP4/AAC (Safari).
//   Twilio's <Play> supports mp3, wav, aiff, gsm and ulaw — and NONE of those.
//   Uploading the raw recorder blob would succeed, save cleanly, and then fail
//   silently at call time with the caller hearing a TwiML error instead of the
//   greeting. So we decode the recording with WebAudio and re-encode it as
//   16-bit PCM WAV, which Twilio plays natively. No npm dependency.
//
// Output: mono, 16 kHz, 16-bit PCM (~32 KB/s — a 60s greeting is ~1.9 MB, well
// under the 5 MB cap; telephony is 8 kHz narrowband anyway, so a higher rate
// buys nothing a caller can hear).

const TARGET_RATE = 16000;

/** Browser support probe — surfaces a clear message instead of a late failure. */
export function canRecordInBrowser(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!(window.AudioContext || (window as any).webkitAudioContext)
  );
}

/**
 * Decode any browser-recorded blob and re-encode as a Twilio-playable WAV.
 * Throws with a human-readable message if the audio can't be decoded.
 */
export async function blobToTwilioWav(blob: Blob): Promise<Blob> {
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  if (!Ctx) throw new Error('This browser cannot process audio recordings.');

  const arrayBuffer = await blob.arrayBuffer();

  const decodeCtx = new Ctx();
  let decoded: AudioBuffer;
  try {
    // Safari's older decodeAudioData is callback-only; wrap both shapes.
    decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const maybePromise = decodeCtx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
      if (maybePromise && typeof (maybePromise as any).then === 'function') {
        (maybePromise as Promise<AudioBuffer>).then(resolve, reject);
      }
    });
  } catch {
    throw new Error('Could not read that recording. Try recording again.');
  } finally {
    void decodeCtx.close();
  }

  if (!decoded.length) throw new Error('The recording is empty.');

  // Resample + downmix to mono at the target rate. Some browsers (older Safari)
  // reject non-native OfflineAudioContext rates — fall back to the source rate,
  // which still yields a valid WAV, just a larger one.
  let rendered: AudioBuffer = decoded;
  let rate = TARGET_RATE;
  try {
    const frames = Math.max(1, Math.ceil((decoded.duration || 0) * TARGET_RATE));
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    rendered = await offline.startRendering();
  } catch {
    rendered = decoded;
    rate = decoded.sampleRate;
  }

  const samples = mixToMono(rendered);
  return encodeWav(samples, rate);
}

/** Average all channels into one Float32 track (mono is enough for a greeting). */
function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0);

  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / channels;
  }
  return out;
}

/** Float32 [-1,1] -> 16-bit PCM WAV (RIFF/WAVE, the header Twilio expects). */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);                       // PCM chunk size
  view.setUint16(20, 1, true);                        // format = PCM
  view.setUint16(22, 1, true);                        // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true);           // block align
  view.setUint16(34, 16, true);                       // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
