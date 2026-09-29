// Speech-to-text for a stored clip, using the browser Web Speech API.
//
// The Web Speech API was designed for live microphone input — it has no way to
// accept an audio file. Two paths:
//
//  - "track": newer implementations let start() take a MediaStreamTrack. We
//    decode the clip and feed it through a MediaStreamAudioDestinationNode, so
//    the recognizer hears the recorded samples directly.
//  - "loopback": older implementations only listen to the mic. We play the clip
//    through the speaker and the mic picks it up. Room noise is included, and
//    echo cancellation can suppress the playback.
//
// Feature detection for "track" is heuristic (no reliable way to detect an
// optional start() argument). The clip is ALWAYS played aloud, so if a browser
// ignores the track it still falls back to hearing the clip through the mic.
//
// The recognizer only turns real recorded audio into text. We never produce
// text on our own: an empty result is reported as empty.

export type SttMethod = "track" | "loopback";

export interface SttResult {
  text: string;
  method: SttMethod;
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function speechSupport(): { supported: boolean; method: SttMethod | null } {
  const Ctor = getCtor();
  if (!Ctor) return { supported: false, method: null };
  const track =
    typeof MediaStreamTrack !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    "available" in Ctor;
  return { supported: true, method: track ? "track" : "loopback" };
}

export const METHOD_LABEL: Record<SttMethod, string> = {
  track: "Web Speech · direct track",
  loopback: "Web Speech · speaker→mic",
};

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "Microphone or speech permission denied.",
  "service-not-allowed": "Speech service not allowed in this browser.",
  network: "Speech service unreachable (network).",
  "audio-capture": "No audio input available.",
  "language-not-supported": "Language not supported.",
};

// Must be called from a user gesture: iOS needs AudioContext.resume() and the
// mic-based recognizer to start synchronously inside the tap.
export async function transcribeClip(blob: Blob, lang = "en-US"): Promise<SttResult> {
  const Ctor = getCtor();
  if (!Ctor) throw new Error("Speech recognition not supported in this browser.");
  const method: SttMethod = speechSupport().method ?? "loopback";

  const ctx = new AudioContext();
  const resumed = ctx.resume().catch(() => {});

  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  const parts: string[] = [];
  let error: string | null = null;
  let recStarted = false;
  let src: AudioBufferSourceNode | null = null;
  let playing = false;
  let track: MediaStreamTrack | undefined;
  let guard: ReturnType<typeof setTimeout> | undefined;

  // Play the clip once the recognizer is listening AND the audio is decoded.
  const maybePlay = () => {
    if (playing || !recStarted || !src) return;
    playing = true;
    src.start();
  };

  const ended = new Promise<void>((resolve) => {
    rec.onstart = () => {
      recStarted = true;
      maybePlay();
    };
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal && r[0]) parts.push(r[0].transcript.trim());
      }
    };
    rec.onerror = (ev) => {
      // "no-speech" / "aborted" just mean nothing was recognized.
      if (ev.error !== "no-speech" && ev.error !== "aborted") error = ev.error;
    };
    rec.onend = () => resolve();
  });

  try {
    // Loopback: start listening now, inside the gesture, before any await.
    if (method === "loopback") rec.start();

    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    await resumed;

    src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination); // always audible — see header comment
    src.onended = () => {
      // Short grace period so the recognizer finalizes the last words.
      setTimeout(() => rec.stop(), 1200);
    };
    // Hard stop in case the recognizer never ends on its own.
    guard = setTimeout(() => rec.abort(), buf.duration * 1000 + 10_000);

    if (method === "track") {
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest);
      track = dest.stream.getAudioTracks()[0];
      rec.start(track);
    }
    maybePlay();

    await ended;
    if (error) throw new Error(ERROR_TEXT[error] ?? `Speech error: ${error}`);
    return { text: parts.filter(Boolean).join(" "), method };
  } catch (err) {
    rec.abort();
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    if (guard) clearTimeout(guard);
    track?.stop();
    ctx.close().catch(() => {});
  }
}
