// Voice in and out for the conversation. Speech to text through the browser's own
// SpeechRecognition (Chrome, Safari, Edge); text to speech through speechSynthesis.
// Nothing here talks to a server. Where the browser has no support, the screen hides the mic.

const Recognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

export function canListen() {
  return Boolean(Recognition);
}

export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

// Starts listening. onText gets the live transcript (what is settled so far plus the words
// still being worked out). onEnd fires once, when the browser stops or stop() is called.
// Returns { stop } or null when the browser cannot listen.
export function listen({ onText, onEnd, onError, lang = 'en-US' } = {}) {
  if (!Recognition) return null;
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let ended = false;
  const finish = (reason) => {
    if (ended) return;
    ended = true;
    if (onEnd) onEnd({ text: finalText.trim(), reason });
  };

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = (r[0] && r[0].transcript) || '';
      if (r.isFinal) finalText += (finalText && !finalText.endsWith(' ') ? ' ' : '') + t.trim();
      else interim += t;
    }
    if (onText) onText({ text: (finalText + (interim ? ' ' + interim : '')).trim(), final: finalText.trim(), interim: interim.trim() });
  };
  rec.onerror = (e) => {
    // "no-speech" and "aborted" are normal ends, not problems worth a message.
    const code = e && e.error;
    if (onError && code && code !== 'no-speech' && code !== 'aborted') onError(code);
    finish(code || 'error');
  };
  rec.onend = () => finish('end');

  try { rec.start(); } catch (e) { finish('start-failed'); return null; }

  return {
    stop() { try { rec.stop(); } catch { /* already stopped */ } },
    abort() { try { rec.abort(); } catch { /* fine */ } finish('aborted'); }
  };
}

// Reads a reply out loud. Short and plain, like the text. Stops whatever was being read first.
export function speak(text) {
  if (!canSpeak() || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'en-US';
    u.rate = 1;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch { /* the browser said no; the text is still on screen */ }
}

export function hush() {
  if (!canSpeak()) return;
  try { window.speechSynthesis.cancel(); } catch { /* fine */ }
}

// A plain message explaining why the mic did not work, for the one case worth telling the couple.
export function micErrorText(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'The mic is blocked for this site. Allow it in the browser and try again.';
  if (code === 'audio-capture') return 'No microphone was found.';
  if (code === 'network') return 'Voice needs an internet connection in this browser.';
  return 'The mic did not catch that. Try again, or type it.';
}
