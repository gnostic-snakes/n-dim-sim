/** Records the main view to a video file with MediaRecorder (one loop of the timeline). */

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

function pickMime(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  for (const c of candidates) if (MediaRecorder.isTypeSupported(c)) return c;
  return '';
}

export interface Recording {
  stop: () => void;
  done: Promise<{ blob: Blob; ext: string }>;
}

export function startRecording(canvas: HTMLCanvasElement, fps = 60): Recording {
  const stream = canvas.captureStream(fps);
  const mimeType = pickMime();
  const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: 14_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<{ blob: Blob; ext: string }>((resolve, reject) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || mimeType || 'video/webm';
      resolve({ blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' });
    };
    rec.onerror = () => reject(new Error('Recording failed'));
  });
  rec.start(250);
  return {
    stop: () => {
      if (rec.state !== 'inactive') rec.stop();
    },
    done,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
