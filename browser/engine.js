/* ============================================================================
   OCHA QuickVid — browser engine.  Runs 100% in the browser tab.
   Pipeline: mp4box demux → WebCodecs decode → Canvas composite (OCHA lower
   thirds + ending) → WebCodecs encode (H.264 + AAC) → mp4-muxer → MP4 Blob.
   No server, no upload. Exposes window.QVEngine.render(file, spec, onLog).
   ============================================================================ */
(function () {
  const MP4Box = window.MP4Box;
  const DataStream = window.DataStream || (MP4Box && MP4Box.DataStream);  // UMD mp4box exposes DataStream globally
  const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;

  const CYAN = '#009EDB';
  const HOLD = 1.5;                    // seconds the ending logo holds before the cut
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  // Placement profile per orientation (mirrors engine/finish.py profile()).
  function profile(W, H) {
    const ar = W / H;
    if (ar > 1.2)  return { orient: 'landscape', nameRatio: 0.050, safeBottom: 0.09, safeSide: 0.045 };
    if (ar < 0.85) return { orient: 'portrait',  nameRatio: 0.030, safeBottom: 0.20, safeSide: 0.06  };
    return           { orient: 'square',    nameRatio: 0.040, safeBottom: 0.11, safeSide: 0.05  };
  }

  // ---- demux one MP4 file → { track, samples[], description(avcC) } ----
  async function demuxVideo(file) {
    const buf = await file.arrayBuffer();
    const mp4 = MP4Box.createFile();
    const samples = [];
    let track = null;
    const ready = new Promise((res, rej) => {
      mp4.onReady = info => { track = info.videoTracks[0]; res(); };
      mp4.onError = e => rej(new Error('mp4box: ' + e));
    });
    mp4.onSamples = (id, u, s) => { for (const x of s) samples.push(x); };
    buf.fileStart = 0;
    mp4.appendBuffer(buf);
    await ready;
    if (!track) throw new Error('No readable video track — this file\'s format/codec isn\'t browser-compatible (e.g. ProRes .mov). Export it as MP4 (H.264) and try again.');
    mp4.setExtractionOptions(track.id, null, { nbSamples: 1e7 });
    mp4.start();
    mp4.flush();
    const trak = mp4.getTrackById(track.id);
    let description = null;
    for (const e of trak.mdia.minf.stbl.stsd.entries) {
      const b = e.avcC || e.hvcC || e.vpcC || e.av1C;
      if (b) {
        const ds = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
        b.write(ds);
        description = new Uint8Array(ds.buffer, 8); // strip 8-byte box header
        break;
      }
    }
    return { track, samples, description };
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('logo load failed: ' + src));
      img.src = src;
    });
  }

  // ---- OCHA lower third — canonical look B. The NUMBERS come from
  //      brand-lt.json (shared with engine/lower_third.py, which renders the
  //      same design for the Full/engine modes). Change the look there once.
  //      This function mirrors lower_third.py's state() + svg() on canvas. ----
  let LTSPEC = null;
  async function loadLTSpec() {
    if (LTSPEC) return LTSPEC;
    const r = await fetch('brand-lt.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('brand-lt.json missing — cannot render lower thirds');
    LTSPEC = await r.json();
    return LTSPEC;
  }

  function ltState(t, hold, T) {
    // (name_reveal, org_reveal, org_pan_fraction) — same math as lower_third.py
    const ENTER_END = T.org_delay + T.org_in, EXIT_DUR = T.name_out_delay + T.name_out;
    let nr, orr, pan;
    if (t < ENTER_END) {
      nr = easeInOut(clamp(t / T.name_in, 0, 1));
      const ot = t - T.org_delay;
      if (ot <= 0) { orr = 0; pan = 1; }
      else { const p = easeInOut(clamp(ot / T.org_in, 0, 1)); orr = p; pan = 1 - p; }
    } else if (t < ENTER_END + hold) { nr = 1; orr = 1; pan = 0; }
    else {
      const e = t - (ENTER_END + hold);
      const po = easeInOut(clamp(e / T.org_out, 0, 1));
      orr = 1 - po; pan = po;
      nr = e <= T.name_out_delay ? 1 : 1 - easeInOut(clamp((e - T.name_out_delay) / T.name_out, 0, 1));
    }
    return [clamp(nr, 0, 1), clamp(orr, 0, 1), pan];
  }

  function drawLowerThird(ctx, W, H, prof, lt, tSec, S) {
    const T = S.timing, G = S.geometry, C = S.colors, F = S.fonts;
    const ENTER_END = T.org_delay + T.org_in, EXIT_DUR = T.name_out_delay + T.name_out;
    const hold = Math.max(0.5, (lt.duration || 4) - ENTER_END - EXIT_DUR);
    const tRel = tSec - lt.start;
    if (tRel < -1e-3 || tRel > ENTER_END + hold + EXIT_DUR) return;
    const [nr, orr, panf] = ltState(tRel, hold, T);
    if (nr <= 0.001 && orr <= 0.001) return;

    const orient = (W / H) > 1.25 ? 'landscape' : ((W / H) < 0.85 ? 'portrait' : 'square');
    const name = S.uppercase_name ? (lt.name || '').toUpperCase() : (lt.name || '');
    const org = lt.org || '';
    const nsize = Math.max(20, Math.round(H * G.name_ratio[orient]));
    const osize = Math.max(12, Math.round(nsize * G.org_scale));
    const npx = Math.round(nsize * G.name_pad_x), npy = Math.round(nsize * G.name_pad_y);
    const opx = Math.round(osize * G.org_pad_x), opy = Math.round(osize * G.org_pad_y);

    ctx.save();
    ctx.letterSpacing = G.letter_spacing + 'px';
    ctx.font = `${F.name_weight} ${nsize}px ${F.family}, Arial, sans-serif`;
    const nameW = ctx.measureText(name).width;
    ctx.letterSpacing = '0px';
    ctx.font = `${F.org_weight} ${osize}px ${F.family}, Arial, sans-serif`;
    const orgW = org ? ctx.measureText(org).width : 0;

    const nBoxW = nameW + npx * 2, nBoxH = nsize + npy * 2;
    const oBoxW = org ? orgW + opx * 2 : 0, oBoxH = org ? osize + opy * 2 : 0;
    const blockW = Math.max(nBoxW, oBoxW);
    const pan = Math.round(nsize * G.pan) * panf;

    const sideMargin = Math.round(W * prof.safeSide);
    const bottomMargin = Math.round(H * prof.safeBottom);
    const yBottom = H - bottomMargin;
    const oY = yBottom - oBoxH, nY = oY - nBoxH;
    const center = lt.align === 'center';
    const nX = center ? Math.round((W - nBoxW) / 2) : sideMargin;
    const oX = (center ? Math.round((W - oBoxW) / 2) : sideMargin) + pan;

    ctx.textBaseline = 'middle';
    // name box — its own left-anchored wipe
    ctx.save();
    ctx.beginPath(); ctx.rect(nX - 1, nY - 1, Math.ceil(nBoxW * nr) + 2, nBoxH + 2); ctx.clip();
    ctx.fillStyle = C.name_bg; ctx.fillRect(nX, nY, nBoxW, nBoxH);
    ctx.fillStyle = C.name_text;
    ctx.letterSpacing = G.letter_spacing + 'px';
    ctx.font = `${F.name_weight} ${nsize}px ${F.family}, Arial, sans-serif`;
    ctx.fillText(name, nX + npx, nY + nBoxH / 2 + nsize * 0.04);
    ctx.restore();
    // org bar — delayed wipe + settle pan (drawn like the Python clip group)
    if (org && orr > 0.001) {
      ctx.save();
      ctx.beginPath(); ctx.rect(oX - 1, oY - 1, Math.ceil(oBoxW * orr) + 2, oBoxH + 2); ctx.clip();
      ctx.fillStyle = C.org_bg; ctx.fillRect(oX, oY, oBoxW, oBoxH);
      ctx.fillStyle = C.org_text;
      ctx.letterSpacing = '0px';
      ctx.font = `${F.org_weight} ${osize}px ${F.family}, Arial, sans-serif`;
      ctx.fillText(org, oX + opx, oY + oBoxH / 2 + osize * 0.04);
      ctx.restore();
    }
    ctx.restore();
  }

  // debug/test hook: lets the harness drive the REAL lower-third code path
  try { window.__qvLT = { draw: drawLowerThird, spec: loadLTSpec }; } catch (e) {}

  function drawLogo(ctx, W, H, logo) {
    const targetH = Math.max(18, Math.round(H * 0.054));
    const ratio = (logo.naturalWidth / logo.naturalHeight) || 4.2;
    const w = Math.round(targetH * ratio);
    ctx.drawImage(logo, Math.round((W - w) / 2), Math.round((H - targetH) / 2), w, targetH);
  }

  // ---- main ----
  async function render(file, spec, onLog) {
    const log = (...a) => { const m = a.join(' '); if (onLog) onLog(m); try { console.log('[QV] ' + m); } catch (e) {} };
    spec = spec || {};
    const lowerThirds = (spec.lowerThirds || []).filter(l => l && l.name);
    const endingStyle = (spec.ending && spec.ending.style) || 'none';

    await Promise.all([document.fonts.load('700 40px Raleway'), document.fonts.load('500 40px Raleway')]);
    const LTS = lowerThirds.length ? await loadLTSpec() : null;
    await document.fonts.ready;

    // Hard size cap — beyond this the tab risks running out of memory (we hold the
    // file + extracted samples + output in RAM). Clear message beats a tab crash.
    const MAXMB = 600;
    if (file.size > MAXMB * 1024 * 1024)
      throw new Error(`This file is ${(file.size / 1e6).toFixed(0)} MB — too heavy to process reliably in a browser tab. Export it as MP4 (H.264, 1080p) to shrink it, then try again.`);

    log('reading video…');
    let firstErr = null;                 // captured from codec error callbacks (async) so we can surface the REAL cause

    // Audio FIRST (decodeAudioData consumes its own copy of the file) so only one
    // full-size buffer is alive at a time — halves peak memory on big files.
    let audioBuffer = null, doAudio = false;
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); audioBuffer = await ac.decodeAudioData(await file.arrayBuffer()); ac.close(); } catch (e) { log('no audio track'); }
    if (audioBuffer) {
      try { const s = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: audioBuffer.sampleRate, numberOfChannels: audioBuffer.numberOfChannels, bitrate: 160000 }); doAudio = !!(s && s.supported); } catch (e) {}
    }

    const { track, samples, description } = await demuxVideo(file);
    // Codec check up front — e.g. ProRes/HEVC .mov files aren't decodable in most browsers.
    let decSup = null;
    try { decSup = await VideoDecoder.isConfigSupported({ codec: track.codec, description }); } catch (e) {}
    if (!decSup || !decSup.supported)
      throw new Error(`This video's codec (${track.codec}) isn't supported by this browser. Export it as MP4 (H.264) — from CapCut/Premiere/Handbrake — and try again.`);
    const srcW = track.track_width, srcH = track.track_height;
    // Cap very large videos (fast + within encoder limits) and force EVEN dims (H.264 yuv420 needs even w/h).
    const MAXDIM = 1920;
    const sc = Math.min(1, MAXDIM / Math.max(srcW, srcH));
    const W = Math.max(2, Math.round(srcW * sc / 2) * 2);
    const H = Math.max(2, Math.round(srcH * sc / 2) * 2);
    const timescale = samples.length ? samples[0].timescale : track.timescale;
    const fps = Math.round(track.nb_samples / (track.duration / track.timescale)) || 30;
    const dur = track.duration / track.timescale;
    const prof = profile(W, H);
    const frameDur = 1e6 / fps;
    log(`${W}×${H} ${prof.orient}, ${track.nb_samples} frames, ~${fps}fps, ${dur.toFixed(1)}s`);

    const logo = (endingStyle === 'over_black' || endingStyle === 'over_footage') ? await loadImage('vendor/OCHA_logo_horizontal_white.svg') : null;

    // muxer + encoders
    const muxCfg = { target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' };
    if (doAudio) muxCfg.audio = { codec: 'aac', numberOfChannels: audioBuffer.numberOfChannels, sampleRate: audioBuffer.sampleRate };
    const muxer = new Muxer(muxCfg);

    const encoder = new VideoEncoder({ output: (c, m) => { try { muxer.addVideoChunk(c, m); } catch (e) { if (!firstErr) firstErr = e; } }, error: e => { log('ENCODER ERROR @frame ' + n + ': ' + (e && e.message || e)); if (!firstErr) firstErr = e; } });
    const bitrate = Math.round(clamp(W * H * fps * 0.09, 3.5e6, 16e6));
    let encCfg = null;                   // pick the first H.264 profile/level the browser's encoder supports for this size
    for (const codec of ['avc1.640028', 'avc1.640033', 'avc1.4D4028', 'avc1.42E028']) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) { encCfg = cfg; break; } } catch (e) {}
    }
    if (!encCfg) throw new Error(`The browser's H.264 encoder can't handle ${W}×${H}. Try a smaller video.`);
    encoder.configure(encCfg);

    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d', { alpha: false });
    let firstTs = null, lastTs = -1, n = 0;

    const compose = (frame) => {
      if (firstErr) { frame.close(); return; }
      if (firstTs === null) firstTs = frame.timestamp;
      // Some phone/edited footage has jittery, non-monotonic frame timestamps; the
      // muxer requires strictly increasing ones, so clamp forward (µs-level nudge).
      let ts = frame.timestamp;
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      const tSec = (ts - firstTs) / 1e6;
      ctx.drawImage(frame, 0, 0, W, H);
      for (const lt of lowerThirds) drawLowerThird(ctx, W, H, prof, lt, tSec, LTS);
      if (endingStyle === 'over_footage' && logo && tSec >= Math.max(0, dur - HOLD)) drawLogo(ctx, W, H, logo);
      const out = new VideoFrame(cv, { timestamp: ts, duration: frame.duration || frameDur });
      try { encoder.encode(out, { keyFrame: n % (fps * 2) === 0 }); } catch (e) { if (!firstErr) firstErr = e; }
      out.close(); frame.close();
      n++;
      if (n % 30 === 0) log(`…${n}/${track.nb_samples} frames`);
    };

    const decoder = new VideoDecoder({ output: compose, error: e => { log('DECODER ERROR @frame ' + n + ': ' + (e && e.message || e)); if (!firstErr) firstErr = e; } });
    decoder.configure({ codec: track.codec, description });   // dims come from the bitstream (avoids a coded/output mismatch)

    log('rendering…');
    for (let i = 0; i < samples.length; i++) {
      if (firstErr) break;
      const s = samples[i];
      decoder.decode(new EncodedVideoChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: s.cts * 1e6 / s.timescale,
        duration: s.duration * 1e6 / s.timescale,
        data: s.data
      }));
      samples[i] = null;                 // EncodedVideoChunk copied the bytes — release ours as we go
      // backpressure: only kick in when the encoder is genuinely behind, to bound memory on long videos
      while (!firstErr && encoder.encodeQueueSize > 48) await new Promise(r => setTimeout(r));
    }
    if (!firstErr) await decoder.flush();
    if (firstErr) throw (firstErr instanceof Error ? firstErr : new Error(String((firstErr && firstErr.message) || firstErr)));

    // over_black: append HOLD seconds of black + centred logo
    if (endingStyle === 'over_black' && logo) {
      const extra = Math.round(HOLD * fps);
      let ts = Math.max((firstTs || 0) + n * frameDur, lastTs + frameDur);
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
      drawLogo(ctx, W, H, logo);
      for (let i = 0; i < extra && !firstErr; i++) {
        const out = new VideoFrame(cv, { timestamp: Math.round(ts), duration: frameDur });
        encoder.encode(out, { keyFrame: i === 0 });
        out.close(); ts += frameDur;
      }
      log('added ending (over black)');
    }
    await encoder.flush();

    // audio
    if (doAudio) {
      log('encoding audio…');
      const audioEnc = new AudioEncoder({ output: (c, m) => { try { muxer.addAudioChunk(c, m); } catch (e) { if (!firstErr) firstErr = e; } }, error: e => { if (!firstErr) firstErr = e; } });
      audioEnc.configure({ codec: 'mp4a.40.2', sampleRate: audioBuffer.sampleRate, numberOfChannels: audioBuffer.numberOfChannels, bitrate: 160000 });
      const sr = audioBuffer.sampleRate, ch = audioBuffer.numberOfChannels, total = audioBuffer.length, F = 4096;
      const chans = []; for (let c = 0; c < ch; c++) chans.push(audioBuffer.getChannelData(c));
      for (let off = 0; off < total; off += F) {
        const len = Math.min(F, total - off);
        const planar = new Float32Array(len * ch);
        for (let c = 0; c < ch; c++) planar.set(chans[c].subarray(off, off + len), c * len);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round(off / sr * 1e6), data: planar });
        audioEnc.encode(ad); ad.close();
      }
      await audioEnc.flush();
    }

    if (firstErr) throw (firstErr instanceof Error ? firstErr : new Error(String((firstErr && firstErr.message) || firstErr)));
    muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), W, H, frames: n, orient: prof.orient, hasAudio: doAudio };
  }

  window.QVEngine = { render, profile };
})();
