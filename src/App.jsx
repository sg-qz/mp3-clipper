/**
 * App.jsx
 * MP3 剪辑工具主界面：上传（支持多文件批量）→ 选择预设 → 批量套用裁剪 → 逐一预览/下载。
 * 业务逻辑下沉到 audioProcessor / presetStore，本文件只负责 UI 与状态编排。
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DownloadIcon from '@mui/icons-material/Download';
import LayersIcon from '@mui/icons-material/Layers';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';

import { analyzeMp3, cutMp3 } from './audioProcessor';
import { readTags } from './id3Manager';
import { loadPresets, addPreset, updatePreset, deletePreset, describePreset } from './presetStore';

/* ----------------------------- 工具函数 ----------------------------- */

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function statusChip(status) {
  switch (status) {
    case 'decoding':
    case 'processing':
      return (
        <Chip
          size="small"
          icon={<HourglassEmptyIcon />}
          label={status === 'decoding' ? '解码中' : '处理中'}
          color="info"
          variant="outlined"
        />
      );
    case 'ready':
      return <Chip size="small" label="待处理" color="default" variant="outlined" />;
    case 'done':
      return <Chip size="small" icon={<CheckCircleIcon />} label="已完成" color="success" />;
    case 'error':
      return <Chip size="small" icon={<ErrorIcon />} label="失败" color="error" />;
    default:
      return null;
  }
}

/* --------------------- 预设编辑器表单默认值 --------------------- */

function defaultForm() {
  return {
    name: '',
    mode: 'trim',
    trimStartSec: 0, trimStartMs: 0,
    trimEndSec: 0, trimEndMs: 0,
    keepStartSec: 0, keepStartMs: 0,
    keepEndSec: 0, keepEndMs: 0,
  };
}

function cloneForm(p) {
  return {
    name: p.name || '',
    mode: p.mode || 'trim',
    trimStartSec: p.trimStartSec || 0, trimStartMs: p.trimStartMs || 0,
    trimEndSec: p.trimEndSec || 0, trimEndMs: p.trimEndMs || 0,
    keepStartSec: p.keepStartSec || 0, keepStartMs: p.keepStartMs || 0,
    keepEndSec: p.keepEndSec != null ? p.keepEndSec : 0,
    keepEndMs: p.keepEndMs || 0,
  };
}

/** 秒 + 毫秒 双输入框，避免浮点误差 */
function SecMsField({ label, sec, ms, onSec, onMs }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField
        label={`${label}（秒）`}
        type="number"
        size="small"
        value={sec}
        onChange={(e) => onSec(Number(e.target.value) || 0)}
        InputProps={{ inputProps: { min: 0 } }}
        sx={{ width: 120 }}
      />
      <TextField
        label="毫秒"
        type="number"
        size="small"
        value={ms}
        onChange={(e) => onMs(Number(e.target.value) || 0)}
        InputProps={{ inputProps: { min: 0, max: 999 } }}
        sx={{ width: 96 }}
      />
    </Stack>
  );
}

/* --------------------- 预设编辑对话框 --------------------- */

function PresetEditorDialog({ open, initial, onClose, onSave }) {
  const [form, setForm] = useState(initial || defaultForm());

  useEffect(() => {
    if (open) setForm(initial ? cloneForm(initial) : defaultForm());
  }, [open, initial]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave({
      name: form.name.trim(),
      mode: form.mode,
      trimStartSec: form.trimStartSec, trimStartMs: form.trimStartMs,
      trimEndSec: form.trimEndSec, trimEndMs: form.trimEndMs,
      keepStartSec: form.keepStartSec, keepStartMs: form.keepStartMs,
      keepEndSec: form.keepEndSec, keepEndMs: form.keepEndMs,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? '编辑预设方案' : '新建预设方案'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="方案名称"
            fullWidth
            size="small"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          <FormControl size="small" fullWidth>
            <InputLabel>模式</InputLabel>
            <Select
              label="模式"
              value={form.mode}
              onChange={(e) => set({ mode: e.target.value })}
            >
              <MenuItem value="trim">去头尾模式（裁剪开头 / 结尾）</MenuItem>
              <MenuItem value="keep">保留区间模式（仅保留某段）</MenuItem>
            </Select>
          </FormControl>

          {form.mode === 'trim' ? (
            <>
              <SecMsField
                label="去开头"
                sec={form.trimStartSec} ms={form.trimStartMs}
                onSec={(v) => set({ trimStartSec: v })} onMs={(v) => set({ trimStartMs: v })}
              />
              <SecMsField
                label="去结尾"
                sec={form.trimEndSec} ms={form.trimEndMs}
                onSec={(v) => set({ trimEndSec: v })} onMs={(v) => set({ trimEndMs: v })}
              />
            </>
          ) : (
            <>
              <SecMsField
                label="保留起点"
                sec={form.keepStartSec} ms={form.keepStartMs}
                onSec={(v) => set({ keepStartSec: v })} onMs={(v) => set({ keepStartMs: v })}
              />
              <SecMsField
                label="保留终点"
                sec={form.keepEndSec} ms={form.keepEndMs}
                onSec={(v) => set({ keepEndSec: v })} onMs={(v) => set({ keepEndMs: v })}
              />
              <Typography variant="caption" color="text.secondary">
                保留终点留 0 秒 0 毫秒表示「到音频结尾」。
              </Typography>
            </>
          )}

          <Typography variant="caption" color="text.secondary">
            提示：秒与毫秒分开填写，避免浮点误差累积。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSave} disabled={!form.name.trim()}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ----------------------------- 主组件 ----------------------------- */

let _uid = 0;
const nextId = () => `f${Date.now()}-${_uid++}`;

export default function App() {
  const audioCtxRef = useRef(null);
  const urlsRef = useRef([]); // 所有已生成的 Blob URL，统一回收
  const fileInputRef = useRef(null);

  const [queue, setQueue] = useState([]); // 文件队列
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ active: false, total: 0, completed: 0, current: '' });
  const [dragActive, setDragActive] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });
  const [editor, setEditor] = useState({ open: false, editing: null });

  // 初始化：加载预设（首次自动写入默认预设）
  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  // 卸载时释放所有 Blob URL
  useEffect(
    () => () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const showToast = useCallback((message, severity = 'info') => {
    setToast({ open: true, message, severity });
  }, []);

  // 惰性创建并 resume AudioContext
  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const updateItem = useCallback((id, patch) => {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  /* ----------------------- 上传与解码（支持多文件） ----------------------- */

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;
      let added = 0;

      for (const file of files) {
        const isMp3 = /\.mp3$/i.test(file.name) || file.type === 'audio/mpeg';
        if (!isMp3) {
          showToast(`已跳过非 MP3 文件：${file.name}`, 'warning');
          continue;
        }
        const id = nextId();
        setQueue((q) => [
          ...q,
          {
            id,
            file,
            name: file.name,
            size: file.size,
            duration: 0,
            status: 'decoding',
            fileBytes: null,
            clippedDuration: 0,
            clippedUrl: null,
            downloadName: null,
            error: null,
            appliedPresetId: null,
            tags: null,
            id3Bytes: null,
            coverUrl: null,
            progress: 0,
          },
        ]);
        added++;
        try {
          // 读取标签用于界面展示（标题/艺术家/专辑/封面）
          const tags = await readTags(file);
          const coverUrl = tags && tags.picture
            ? URL.createObjectURL(new Blob([tags.picture.data], { type: tags.picture.format || 'image/jpeg' }))
            : null;
          if (coverUrl) urlsRef.current.push(coverUrl);
          // 直接基于文件字节做「帧级裁剪」，无需解码/重编码：更快、保留原始音质与标签
          const arrayBuffer = await file.arrayBuffer();
          const meta = analyzeMp3(arrayBuffer);
          updateItem(id, {
            duration: meta.duration,
            fileBytes: arrayBuffer,
            frameMeta: meta,
            tags,
            id3Bytes: meta.tagBytes,
            coverUrl,
            status: 'ready',
          });
        } catch (e) {
          updateItem(id, { status: 'error', error: e.message || '解析失败' });
          showToast(`解析失败：${file.name}`, 'error');
        }
      }
      if (added > 0) showToast(`已添加 ${added} 个文件`, 'success');
    },
    [updateItem, showToast],
  );

  /* ----------------------- 单个文件应用预设 ----------------------- */

  const applyPresetToItem = useCallback(
    async (item, preset, onProgress) => {
      if (!item.fileBytes) {
        updateItem(item.id, { status: 'error', error: '未加载，无法处理' });
        return;
      }
      updateItem(item.id, { status: 'processing', progress: 0, error: null });
      try {
        // 帧级裁剪：直接切割原始 MP3 帧 + 原样保留 ID3v2 标签，无需重编码（瞬时完成）
        if (onProgress) onProgress(0.2);
        const { buffer: outBuf, keptFrames } = cutMp3(item.frameMeta, preset);
        if (onProgress) onProgress(1);
        const finalBlob = new Blob([outBuf], { type: 'audio/mpeg' });
        if (item.clippedUrl) URL.revokeObjectURL(item.clippedUrl);
        const url = URL.createObjectURL(finalBlob);
        urlsRef.current.push(url);
        const base = item.name.replace(/\.mp3$/i, '');
        const { sampleRate, samplesPerFrame } = item.frameMeta;
        const clippedDuration =
          keptFrames > 0 ? (keptFrames * samplesPerFrame) / sampleRate : item.duration;
        updateItem(item.id, {
          status: 'done',
          progress: 1,
          clippedDuration,
          clippedUrl: url,
          downloadName: `${base}_clipped.mp3`,
          appliedPresetId: preset.id,
          error: null,
        });
      } catch (e) {
        updateItem(item.id, { status: 'error', progress: 0, error: e.message || '应用失败' });
        showToast(`处理失败：${item.name}`, 'error');
      }
    },
    [updateItem, showToast],
  );

  /* ----------------------- 批量应用预设到全部文件 ----------------------- */

  const handleApplyAll = useCallback(
    async (preset) => {
      if (!preset) {
        showToast('请先选择预设', 'warning');
        return;
      }
      setSelectedPresetId(preset.id);
      const targets = queue.filter((it) => it.fileBytes);
      if (targets.length === 0) {
        showToast('请先添加已解码的 MP3 文件', 'warning');
        return;
      }
      setProcessing(true);
      setBatchProgress({ active: true, total: targets.length, completed: 0, current: '' });
      let completed = 0;
      for (const it of targets) {
        // eslint-disable-next-line no-await-in-loop
        setBatchProgress((bp) => ({ ...bp, current: it.name }));
        // eslint-disable-next-line no-await-in-loop
        await applyPresetToItem(it, preset, (frac) => {
          updateItem(it.id, { progress: frac });
        });
        completed += 1;
        setBatchProgress((bp) => ({ ...bp, completed }));
      }
      setProcessing(false);
      setBatchProgress({ active: false, total: 0, completed: 0, current: '' });
      showToast(`已批量应用「${preset.name}」到 ${targets.length} 个文件`, 'success');
    },
    [queue, applyPresetToItem, updateItem, showToast],
  );

  /* ----------------------- 下载 ----------------------- */

  const handleDownloadItem = useCallback((item) => {
    if (!item.clippedUrl) {
      showToast('该文件尚未处理完成', 'warning');
      return;
    }
    const a = document.createElement('a');
    a.href = item.clippedUrl;
    a.download = item.downloadName || `${item.name}_clipped.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [showToast]);

  const handleDownloadAll = useCallback(async () => {
    const done = queue.filter((it) => it.status === 'done' && it.clippedUrl);
    if (done.length === 0) {
      showToast('请先批量应用预设', 'warning');
      return;
    }
    showToast(`正在打包 ${done.length} 个文件为 ZIP…`, 'info');
    try {
      // 动态 import，避免把 jszip 打进主包影响首屏体积
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      await Promise.all(
        done.map(async (it) => {
          const res = await fetch(it.clippedUrl);
          const blob = await res.blob();
          const fname = it.downloadName || `${it.name}_clipped.mp3`;
          zip.file(fname, blob);
        }),
      );
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mp3-clipped.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast(`已打包 ${done.length} 个文件为 ZIP`, 'success');
    } catch (e) {
      showToast(`打包失败：${e && e.message ? e.message : e}`, 'error');
    }
  }, [queue, showToast]);

  /* ----------------------- 删除队列项 ----------------------- */

  const handleRemove = useCallback((id) => {
    setQueue((q) => {
      const it = q.find((x) => x.id === id);
      if (it && it.clippedUrl) {
        URL.revokeObjectURL(it.clippedUrl);
        urlsRef.current = urlsRef.current.filter((u) => u !== it.clippedUrl);
      }
      if (it && it.coverUrl) URL.revokeObjectURL(it.coverUrl);
      return q.filter((x) => x.id !== id);
    });
  }, []);

  const handleClear = useCallback(() => {
    queue.forEach((it) => {
      if (it.clippedUrl) {
        URL.revokeObjectURL(it.clippedUrl);
        urlsRef.current = urlsRef.current.filter((u) => u !== it.clippedUrl);
      }
      if (it.coverUrl) URL.revokeObjectURL(it.coverUrl);
    });
    setQueue([]);
  }, [queue]);

  /* ----------------------- 预设增删改 ----------------------- */

  const openAdd = () => setEditor({ open: true, editing: null });
  const openEdit = (p) => setEditor({ open: true, editing: p });
  const closeEditor = () => setEditor({ open: false, editing: null });

  const saveEditor = (data) => {
    if (editor.editing) {
      setPresets(updatePreset(editor.editing.id, data));
    } else {
      setPresets(addPreset(data));
    }
    closeEditor();
  };

  const handleDelete = (p) => {
    setPresets(deletePreset(p.id));
    if (selectedPresetId === p.id) setSelectedPresetId(null);
  };

  /* ----------------------- 拖拽上传 ----------------------- */

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };

  const readyCount = queue.filter((it) => it.fileBytes).length;
  const doneCount = queue.filter((it) => it.status === 'done' && it.clippedUrl).length;

  /* ----------------------- 渲染 ----------------------- */

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            MP3 剪辑工具
          </Typography>
          <Typography variant="body2" color="text.secondary">
            纯浏览器端处理，可批量上传多个 MP3，套用同一预设方案裁剪后逐一预览并下载。
          </Typography>
        </Box>

        {/* 1. 上传（多文件） */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            1. 上传音频（支持多选 / 拖拽多个文件）
          </Typography>
          <Box
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              border: '2px dashed',
              borderColor: dragActive ? 'primary.main' : 'divider',
              borderRadius: 2,
              p: 4,
              textAlign: 'center',
              cursor: 'pointer',
              bgcolor: dragActive ? 'action.hover' : 'background.paper',
              transition: 'all .2s',
            }}
          >
            <CloudUploadIcon color="primary" sx={{ fontSize: 40 }} />
            <Typography>点击选择或拖拽 MP3 文件到此处（可多选）</Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,.mp3"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </Box>

          {queue.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1 }}
              >
                <Typography variant="subtitle2" color="text.secondary">
                  已加入 {queue.length} 个文件（已解码 {readyCount}）
                </Typography>
                <Button size="small" color="inherit" onClick={handleClear}>
                  清空列表
                </Button>
              </Stack>
              <List disablePadding>
                {queue.map((it, idx) => (
                  <React.Fragment key={it.id}>
                    {idx > 0 && <Divider />}
                    <ListItem sx={{ alignItems: 'flex-start' }}>
                      <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                        <MusicNoteIcon color="action" />
                      </ListItemIcon>
                      <ListItemText
                        primary={it.name}
                        secondary={
                          <Stack spacing={0.5}>
                            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                              <span>{formatBytes(it.size)}</span>
                              {it.duration > 0 && <span>· {formatDuration(it.duration)}</span>}
                              {it.appliedPresetId && (
                                <span>· 已用预设</span>
                              )}
                            </Stack>
                            {it.status === 'processing' && (
                              <Box sx={{ width: 180 }}>
                                <LinearProgress
                                  variant="determinate"
                                  value={Math.round((it.progress || 0) * 100)}
                                  sx={{ borderRadius: 1 }}
                                />
                                <Typography variant="caption" color="text.secondary">
                                  处理中 {Math.round((it.progress || 0) * 100)}%
                                </Typography>
                              </Box>
                            )}
                          </Stack>
                        }
                      />
                      <Stack direction="row" spacing={1} alignItems="center">
                        {statusChip(it.status)}
                        <IconButton size="small" onClick={() => handleRemove(it.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </ListItem>
                  </React.Fragment>
                ))}
              </List>
            </Box>
          )}
        </Paper>

        {/* 2. 预设方案 */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mb: 1 }}
          >
            <Typography variant="h6">2. 预设剪辑方案</Typography>
            <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={openAdd}>
              新建方案
            </Button>
          </Stack>

          <List disablePadding>
            {presets.map((p, idx) => (
              <React.Fragment key={p.id}>
                {idx > 0 && <Divider />}
                <ListItemButton
                  selected={selectedPresetId === p.id}
                  onClick={() => setSelectedPresetId(p.id)}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <ContentCutIcon color={selectedPresetId === p.id ? 'primary' : 'action'} />
                  </ListItemIcon>
                  <ListItemText primary={p.name} secondary={describePreset(p)} />
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<LayersIcon />}
                      disabled={readyCount === 0 || processing}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApplyAll(p);
                      }}
                    >
                      应用到全部（{readyCount}）
                    </Button>
                    <Tooltip title="编辑">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(p);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p);
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </ListItemButton>
              </React.Fragment>
            ))}
            {presets.length === 0 && (
              <Typography color="text.secondary">暂无预设，点击「新建方案」添加。</Typography>
            )}
          </List>
          <Typography variant="caption" color="text.secondary">
            点选预设后，点击「应用到全部」即可把同一方案套用到所有已解码文件。
          </Typography>
        </Paper>

        {/* 3. 预览与下载 */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mb: 1 }}
          >
            <Typography variant="h6">3. 预览与下载</Typography>
            <Button
              startIcon={<DownloadIcon />}
              variant="outlined"
              size="small"
              disabled={doneCount === 0}
              onClick={handleDownloadAll}
            >
              下载全部（{doneCount}）
            </Button>
          </Stack>

          {doneCount === 0 ? (
            <Typography color="text.secondary">批量应用预设后，这里会列出每个文件的处理结果。</Typography>
          ) : (
            <List disablePadding>
              {queue
                .filter((it) => it.status === 'done' && it.clippedUrl)
                .map((it, idx) => (
                  <React.Fragment key={it.id}>
                    {idx > 0 && <Divider />}
                    <ListItem sx={{ alignItems: 'flex-start' }}>
                      <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
                        {it.coverUrl && (
                          <Box
                            component="img"
                            src={it.coverUrl}
                            alt="封面"
                            sx={{
                              width: 48,
                              height: 48,
                              borderRadius: 1,
                              objectFit: 'cover',
                              flexShrink: 0,
                              bgcolor: 'action.hover',
                            }}
                          />
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle2" noWrap>
                            {it.tags && it.tags.title ? it.tags.title : it.downloadName || it.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                            {[it.tags && it.tags.artist, it.tags && it.tags.album]
                              .filter(Boolean)
                              .join(' · ') || '（无标签）'}
                            {it.clippedDuration ? ` · 裁剪后 ${formatDuration(it.clippedDuration)}` : ''}
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                            <audio controls src={it.clippedUrl} style={{ height: 36 }} />
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<DownloadIcon />}
                              onClick={() => handleDownloadItem(it)}
                            >
                              下载
                            </Button>
                          </Stack>
                        </Box>
                      </Box>
                    </ListItem>
                  </React.Fragment>
                ))}
            </List>
          )}
        </Paper>
      </Stack>

      {/* 处理中遮罩（含整体进度） */}
      {processing && (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'rgba(0,0,0,.25)',
            zIndex: 1300,
          }}
        >
          <Paper sx={{ p: 4, width: 320 }} elevation={6}>
            <Stack spacing={2} alignItems="center">
              <CircularProgress
                variant="determinate"
                value={batchProgress.total ? (batchProgress.completed / batchProgress.total) * 100 : 0}
              />
              <Typography variant="subtitle1" fontWeight={600}>
                正在处理 {batchProgress.completed}/{batchProgress.total}
              </Typography>
              <Box sx={{ width: '100%' }}>
                <LinearProgress
                  variant="determinate"
                  value={batchProgress.total ? (batchProgress.completed / batchProgress.total) * 100 : 0}
                />
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                当前：{batchProgress.current || '—'}
              </Typography>
            </Stack>
          </Paper>
        </Box>
      )}

      {/* 全局提示 */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={toast.severity}
          variant="filled"
          onClose={() => setToast((t) => ({ ...t, open: false }))}
        >
          {toast.message}
        </Alert>
      </Snackbar>

      {/* 预设编辑对话框 */}
      <PresetEditorDialog
        open={editor.open}
        initial={editor.editing}
        onClose={closeEditor}
        onSave={saveEditor}
      />
    </Container>
  );
}
