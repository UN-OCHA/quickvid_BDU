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

  // ---- OCHA lower third: black-on-white name box + white-on-cyan org box,
  //      Raleway, sharp corners, left-anchored wipe reveal (no fade) ----
  function drawLowerThird(ctx, W, H, prof, lt, tSec) {
    const ENTER = 0.5, EXIT = 0.44;
    const tRel = tSec - lt.start;
    if (tRel < -1e-3 || tRel > lt.duration) return;
    let reveal;
    if (tRel < ENTER) reveal = easeInOut(clamp(tRel / ENTER, 0, 1));
    else if (tRel > lt.duration - EXIT) reveal = easeInOut(clamp((lt.duration - tRel) / EXIT, 0, 1));
    else reveal = 1;
    if (reveal <= 0.001) return;

    const name = (lt.name || '').toUpperCase();
    const org = lt.org || '';
    const nameFont = Math.round(H * prof.nameRatio);
    const orgFont = Math.round(nameFont * 0.62);
    const padX = Math.round(nameFont * 0.55), padY = Math.round(nameFont * 0.34);

    ctx.font = `700 ${nameFont}px Raleway, Arial, sans-serif`;
    const nameW = ctx.measureText(name).width;
    ctx.font = `500 ${orgFont}px Raleway, Arial, sans-serif`;
    const orgW = org ? ctx.measureText(org).width : 0;

    const nBoxW = nameW + padX * 2, nBoxH = nameFont + padY * 2;
    const oBoxW = org ? orgW + padX * 2 : 0, oBoxH = org ? Math.round(orgFont + padY * 1.4) : 0;
    const blockW = Math.max(nBoxW, oBoxW);

    const sideMargin = Math.round(W * prof.safeSide);
    const bottomMargin = Math.round(H * prof.safeBottom);
    const x = lt.align === 'center' ? Math.round((W - blockW) / 2) : sideMargin;
    const yBottom = H - bottomMargin;
    const oY = yBottom - oBoxH, nY = oY - nBoxH;

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    // left-anchored wipe
    const revW = Math.ceil(blockW * reveal) + 2;
    ctx.beginPath(); ctx.rect(x - 1, nY - 2, revW, nBoxH + oBoxH + 4); ctx.clip();
    // name box
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x, nY, nBoxW, nBoxH);
    ctx.fillStyle = '#000000'; ctx.font = `700 ${nameFont}px Raleway, Arial, sans-serif`;
    ctx.fillText(name, x + padX, nY + padY + nameFont * 0.80);
    // org box — slight left pan as it reveals
    if (org) {
      const pan = Math.round((1 - reveal) * nameFont * 0.45);
      ctx.fillStyle = CYAN; ctx.fillRect(x - pan, oY, oBoxW, oBoxH);
      ctx.fillStyle = '#FFFFFF'; ctx.font = `500 ${orgFont}px Raleway, Arial, sans-serif`;
      ctx.fillText(org, x + padX - pan, oY + Math.round(padY * 0.7) + orgFont * 0.80);
    }
    ctx.restore();
  }

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
      for (const lt of lowerThirds) drawLowerThird(ctx, W, H, prof, lt, tSec);
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
