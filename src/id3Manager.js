/**
 * id3Manager.js
 *
 * 标签处理：
 *  - extractId3v2Bytes：从原始文件字节抠出完整 ID3v2 标签块（用于「字节级原样搬运」保留标签）。
 *  - readTags：仅用于界面展示（标题/艺术家/专辑/封面），用 music-metadata-browser 读取。
 *
 * 注：本项目采用「帧级切割、不重编码」方案（详见 audioProcessor.js），标签保留直接由
 *     cutMp3 拼接原始 ID3v2 块完成，无需任何库去重建标签帧，故不再依赖 lamejs / browser-id3-writer。
 */

import { parseBlob } from 'music-metadata-browser';

/**
 * 从原始文件字节中抠出完整的 ID3v2 标签块（含 10 字节头）。无 ID3v2 则返回 null。
 * @param {ArrayBuffer} arrayBuffer 原始文件的整段字节
 * @returns {Uint8Array|null}
 */
export function extractId3v2Bytes(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 10) return null;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null; // 'ID3'
  const flags = bytes[5];
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  let tagLen = 10 + size;
  if (flags & 0x10) tagLen += 10; // footer
  if (tagLen > bytes.length) return null;
  return new Uint8Array(bytes.subarray(0, tagLen)); // 拷贝，避免与原 buffer 共享
}

/**
 * 读取媒体文件的标签，返回规范化对象（无标签或读取失败返回 null）。
 * 仅用于界面展示，不参与「保留」逻辑。
 * @param {File|Blob} input
 * @returns {Promise<object|null>}
 */
export async function readTags(input) {
  try {
    const meta = await parseBlob(input);
    const c = meta.common || {};
    const pic = c.picture && c.picture[0] ? c.picture[0] : null;
    const track = c.track
      ? c.track.of
        ? `${c.track.no}/${c.track.of}`
        : String(c.track.no)
      : null;
    return {
      title: c.title || null,
      artist: c.artists && c.artists.length ? c.artists.join('/ ') : c.artist || null,
      album: c.album || null,
      track,
      year: c.year ? String(c.year) : null,
      genre: c.genre && c.genre.length ? c.genre.join('/ ') : null,
      comment: c.comment && c.comment.length ? c.comment[0] : null,
      picture: pic ? { data: pic.data, format: pic.format, description: '' } : null,
    };
  } catch (e) {
    return null;
  }
}
