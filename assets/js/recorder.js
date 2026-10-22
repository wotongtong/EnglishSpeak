/**
 * ============================================================================
 *  recorder.js —— 麦克风采集与音频编码（零依赖）
 * ----------------------------------------------------------------------------
 *  · getUserMedia 采集 → 重采样为 16kHz 单声道 16bit PCM
 *  · 编码为标准 WAV，并转 Base64（腾讯云 ASR / SOE 均可直接使用）
 *  · 实时输出音量电平，供波形可视化
 *
 *  典型用法：
 *    const rec = await Recorder.start({ onLevel: v => {...}, onTime: t => {...} });
 *    const out = await Recorder.stop();   // { base64, durationSec, blob }
 * ========================================================================== */
'use strict';

const Recorder = (function () {
  let audioCtx = null;
  let stream = null;
  let source = null;
  let processor = null;
  let buffers = [];
  let recording = false;
  let startedAt = 0;
  let timerId = null;
  let handlers = {};

  const TARGET_RATE = 16000;

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioContext || window.webkitAudioContext);
  }

  async function requestPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风采集，请使用最新版 Chrome / Edge / Safari。');
    }
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    // 立即释放，仅用于探测权限
    s.getTracks().forEach((t) => t.stop());
    return true;
  }

  function mergeBuffers(chunks) {
    let total = 0;
    chunks.forEach((c) => { total += c.length; });
    const out = new Float32Array(total);
    let offset = 0;
    chunks.forEach((c) => { out.set(c, offset); offset += c.length; });
    return out;
  }

  function downsample(buffer, inRate, outRate) {
    if (outRate >= inRate) return buffer;
    const ratio = inRate / outRate;
    const newLen = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLen);
    let pos = 0;
    for (let i = 0; i < newLen; i++) {
      const next = Math.round((i + 1) * ratio);
      let sum = 0; let cnt = 0;
      for (let j = pos; j < next && j < buffer.length; j++) { sum += buffer[j]; cnt++; }
      result[i] = cnt ? sum / cnt : 0;
      pos = next;
    }
    return result;
  }

  function floatTo16BitPCM(samples) {
    const buf = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  function encodeWAV(samples, sampleRate) {
    const pcm = floatTo16BitPCM(samples);
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const w = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    w(0, 'RIFF');
    view.setUint32(4, 36 + pcm.byteLength, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);            // PCM
    view.setUint16(22, 1, true);            // 单声道
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byteRate
    view.setUint16(32, 2, true);            // blockAlign
    view.setUint16(34, 16, true);           // bits
    w(36, 'data');
    view.setUint32(40, pcm.byteLength, true);
    return new Blob([header, pcm], { type: 'audio/wav' });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function start(opts) {
    handlers = opts || {};
    if (recording) return false;

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(2048, 1, 1);
    buffers = [];

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      buffers.push(new Float32Array(input));

      // 计算 RMS 音量（0~1）
      let sum = 0;
      for (let i = 0; i < input.length; i += 8) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / (input.length / 8));
      if (handlers.onLevel) handlers.onLevel(Math.min(1, rms * 3.2));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination); // 需连到 destination 才会触发处理

    recording = true;
    startedAt = Date.now();
    if (handlers.onTime) handlers.onTime(0);
    timerId = setInterval(() => {
      if (handlers.onTime) handlers.onTime(Math.floor((Date.now() - startedAt) / 1000));
    }, 200);
    return true;
  }

  async function stop() {
    if (!recording) return null;
    recording = false;
    clearInterval(timerId);

    return new Promise((resolve) => {
      const finish = async () => {
        try { processor.disconnect(); } catch (e) {}
        try { source.disconnect(); } catch (e) {}
        stream.getTracks().forEach((t) => t.stop());
        try { audioCtx.close(); } catch (e) {}

        const merged = mergeBuffers(buffers);
        const inRate = audioCtx ? audioCtx.sampleRate : 48000;
        const down = downsample(merged, inRate, TARGET_RATE);
        const wavBlob = encodeWAV(down, TARGET_RATE);
        const base64 = await blobToBase64(wavBlob);
        const durationSec = Math.max(1, Math.round(down.length / TARGET_RATE));
        resolve({ base64, blob: wavBlob, durationSec, sampleRate: TARGET_RATE, format: 'wav' });
      };
      // 稍作延迟，确保最后的音频块已被处理
      setTimeout(finish, 120);
    });
  }

  function isRecording() { return recording; }

  return { isSupported, requestPermission, start, stop, isRecording };
})();

window.Recorder = Recorder;