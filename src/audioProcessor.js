/**
 * audioProcessor.js —— MP3 帧级切割（无重编码）
 *
 * 设计要点：
 *  - 不解码、不重新编码。直接在原始字节上解析 MPEG 音频帧边界，按时间裁掉头尾 /
 *    截取区间所需的帧，再把「原始 ID3v2 标签块 + 选中的帧」拼成输出文件。
 *  - 优点：① 瞬时完成，绝不会再出现「页面无响应」；② 原始音质 100% 保留；
 *          ③ 标签原样保留（连版本/编码/封面都不动）。
 *  - 代价：切割精度为「帧级」（MPEG1 LayerIII 每帧 ≈ 26ms），对听感无影响。
 *
 * 兼容性：支持 CBR / VBR（逐帧按帧头计算长度）、MPEG1/2/2.5 LayerIII。
 */

import { extractId3v2Bytes } from './id3Manager.js';

// 采样率表（索引由帧头 srIndex 决定）
const SAMPLE_RATE_TABLE = {
  3: [44100, 48000, 32000, 0], // MPEG1
  2: [22050, 24000, 16000, 0], // MPEG2
  0: [11025, 12000, 8000, 0], // MPEG2.5
};
// LayerIII 码率表（kbps），索引由帧头 bitrateIndex 决定
const BITRATE_TABLE = {
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0], // MPEG1
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0], // MPEG2/2.5
};

/**
 * 解析一个 MP3 文件的整体结构。
 * @param {ArrayBuffer} arrayBuffer 原始文件字节
 * @returns {object} { bytes, tagBytes, framesStart, framesEnd, offsets, lengths, sampleRate, samplesPerFrame, frameCount, duration }
 */
export function analyzeMp3(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const tagBytes = extractId3v2Bytes(arrayBuffer) || new Uint8Array(0);
  const framesStart = tagBytes.length; // 标签之后即第一帧

  // 末尾若有 ID3v1（128 字节 "TAG..."），不计入音频帧区域
  let framesEnd = bytes.length;
  if (bytes.length > 128) {
    const t = bytes.subarray(bytes.length - 128);
    if (t[0] === 0x54 && t[1] === 0x41 && t[2] === 0x47 && t[3] === 0x00) {
      framesEnd = bytes.length - 128;
    }
  }

  const parsed = parseFrames(bytes, framesStart, framesEnd);
  const duration =
    parsed.frameCount > 0 ? (parsed.frameCount * parsed.samplesPerFrame) / parsed.sampleRate : 0;

  return {
    bytes,
    tagBytes,
    framesStart,
    framesEnd,
    offsets: parsed.offsets,
    lengths: parsed.lengths,
    sampleRate: parsed.sampleRate,
    samplesPerFrame: parsed.samplesPerFrame,
    frameCount: parsed.frameCount,
    duration,
  };
}

/**
 * 逐帧扫描 MPEG 音频帧，返回每帧的偏移与长度。
 * 用帧头里的码率逐帧计算帧长并步进；遇到失步则向前扫描下一个同步字重新对齐。
 */
function parseFrames(bytes, start, end) {
  const offsets = [];
  const lengths = [];
  let i = start;
  let sampleRate = 0;
  let samplesPerFrame = 0;
  let frameCount = 0;

  while (i + 4 <= end) {
    // 11 位同步字：0xFF 后跟 0xE0~0xFB
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      const version = (b1 & 0x18) >> 3; // 0 / 2 / 3
      const layer = (b1 & 0x06) >> 1; // 应为 1（Layer III）
      const brIndex = (b2 & 0xf0) >> 4;
      const srIndex = (b2 & 0x0c) >> 2;
      const padding = (b2 & 0x02) >> 1;
      if (layer !== 1) {
        i += 1;
        continue;
      }
      const ver = version === 3 ? 3 : version === 2 ? 2 : 0;
      const sr = SAMPLE_RATE_TABLE[ver][srIndex];
      const br = BITRATE_TABLE[ver][brIndex];
      if (!sr || !br) {
        i += 1;
        continue;
      }
      const spf = ver === 3 ? 1152 : 576;
      const frameLen = Math.floor(((ver === 3 ? 144 : 72) * br * 1000) / sr) + padding;
      if (frameLen < 4 || i + frameLen > end) {
        i += 1;
        continue;
      }
      offsets.push(i);
      lengths.push(frameLen);
      frameCount += 1;
      if (sampleRate === 0) {
        sampleRate = sr;
        samplesPerFrame = spf;
      }
      i += frameLen;
    } else {
      i += 1;
    }
  }

  return { offsets, lengths, sampleRate, samplesPerFrame, frameCount };
}

/**
 * 按预设方案切割 MP3 帧，返回 { buffer, keptFrames }。
 * 输出 = 原始 ID3v2 标签块 + 选中的音频帧（标签原样保留）。
 * @param {object} meta analyzeMp3 的结果
 * @param {object} preset 预设方案 { mode, trimStartSec/Ms, trimEndSec/Ms, keepStartSec/Ms, keepEndSec/Ms }
 * @returns {{ buffer: ArrayBuffer, keptFrames: number }}
 */
export function cutMp3(meta, preset) {
  const { bytes, tagBytes, offsets, lengths, sampleRate, samplesPerFrame, frameCount } = meta;

  if (frameCount === 0) {
    // 没有可切的音频帧：直接回传整段（含标签），避免产出损坏文件
    const full = new Uint8Array(bytes.byteLength);
    full.set(bytes);
    return { buffer: full.buffer, keptFrames: 0 };
  }

  const totalMs = (frameCount * samplesPerFrame) / sampleRate * 1000;
  let startMs;
  let endMs;
  if (preset.mode === 'keep') {
    startMs = (preset.keepStartSec || 0) * 1000 + (preset.keepStartMs || 0);
    const rawEnd = (preset.keepEndSec || 0) * 1000 + (preset.keepEndMs || 0);
    endMs = rawEnd > 0 ? rawEnd : totalMs; // 结束留 0 表示到结尾
  } else {
    startMs = (preset.trimStartSec || 0) * 1000 + (preset.trimStartMs || 0);
    endMs = totalMs - ((preset.trimEndSec || 0) * 1000 + (preset.trimEndMs || 0));
  }
  if (startMs < 0) startMs = 0;
  if (endMs > totalMs) endMs = totalMs;

  // 帧级对齐（每帧时长 = samplesPerFrame / sampleRate 秒）
  const spfMs = (samplesPerFrame / sampleRate) * 1000;
  let startIdx = Math.floor(startMs / spfMs);
  let endIdx = Math.ceil(endMs / spfMs) - 1;
  if (startIdx < 0) startIdx = 0;
  if (endIdx >= frameCount) endIdx = frameCount - 1;
  // 极端情况（裁剪量超过整段）：兜底保留全部，避免空文件
  if (startIdx > endIdx) {
    startIdx = 0;
    endIdx = frameCount - 1;
  }

  const from = offsets[startIdx];
  const to = offsets[endIdx] + lengths[endIdx];
  const framesSlice = bytes.subarray(from, to);

  const out = new Uint8Array(tagBytes.length + framesSlice.length);
  out.set(tagBytes, 0); // 原始标签原样在前
  out.set(framesSlice, tagBytes.length); // 选中帧在后
  return { buffer: out.buffer, keptFrames: endIdx - startIdx + 1 };
}
