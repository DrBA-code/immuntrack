// Face capture: live camera with a face guide, falling back to the phone's camera app / file picker.
import { modal, icon, toast } from './ui.js';

function shrink(source, w, h, max = 360) {
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.74);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { resolve(shrink(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function captureFace(title = 'Capture face photo', hint = 'Fit the face inside the outline, in good light') {
  return new Promise((resolve) => {
    let stream = null, facing = 'user', result = null, settled = false;
    const m = modal({
      title,
      body: `<div class="cam" id="cam-view"><video playsinline autoplay muted></video><div class="guide"></div><div class="guide-t">${hint}</div></div>
             <p class="small muted" id="cam-msg" style="text-align:center;margin:10px 0 0">Starting camera…</p>
             <input type="file" accept="image/*" capture="user" id="cam-file" class="hidden">`,
      foot: `<button class="btn ghost" id="cam-switch">${icon.sync} Switch camera</button>
             <button class="btn" id="cam-upload">Use phone camera app</button>
             <button class="btn primary" id="cam-shot">${icon.camera} Capture</button>`,
      onClose: () => { stop(); if (!settled) { settled = true; resolve(result); } },
    });
    const view = m.el.querySelector('#cam-view'), video = view.querySelector('video'), msg = m.el.querySelector('#cam-msg');
    const shot = m.el.querySelector('#cam-shot'), file = m.el.querySelector('#cam-file');

    function stop() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }
    async function start() {
      stop();
      if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'Live camera is not available here — use the phone camera app button.'; shot.disabled = true; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 960 } }, audio: false });
        video.srcObject = stream; shot.disabled = false;
        video.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
        msg.textContent = 'Tap Capture when the face is clear and centred.';
      } catch (e) {
        shot.disabled = true;
        msg.textContent = e.name === 'NotAllowedError' ? 'Camera permission was refused. Allow the camera for this site, or use the phone camera app button.' : 'No camera found — use the phone camera app button.';
      }
    }
    function finish(dataUrl) { result = dataUrl; settled = true; resolve(dataUrl); m.close(); }

    shot.onclick = () => {
      if (!video.videoWidth) return toast('Camera is not ready yet.');
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      const ctx = c.getContext('2d');
      if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0);
      finish(shrink(c, c.width, c.height));
    };
    m.el.querySelector('#cam-switch').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; start(); };
    m.el.querySelector('#cam-upload').onclick = () => file.click();
    file.onchange = async () => { if (file.files[0]) { try { finish(await fileToDataUrl(file.files[0])); } catch (e) { toast('Could not read that photo.', 'err'); } } };
    start();
  });
}
