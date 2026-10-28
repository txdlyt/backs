// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Fish Audio 音色管理
//  音色条目：{ id, nickname, referenceId }
//  id 前缀 fv_（fish voice）
// ═══════════════════════════════════════════════════════════

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';

export function getRoot() {
    if (!extension_settings[extensionName].fish_audio) {
        extension_settings[extensionName].fish_audio = {};
    }
    const r = extension_settings[extensionName].fish_audio;
    if (typeof r.apiKey !== 'string') r.apiKey = '';
    if (typeof r.baseUrl !== 'string' || !r.baseUrl) r.baseUrl = 'https://api.fish.audio';
    if (typeof r.format !== 'string') r.format = 'mp3';
    if (typeof r.latency !== 'string') r.latency = 'normal';
    if (typeof r.currentVoiceId !== 'string') r.currentVoiceId = '';
    if (typeof r.narrationVoiceId !== 'string') r.narrationVoiceId = '';
    if (typeof r.testText !== 'string') r.testText = '你好，这是 Fish Audio 语音合成的测试文本。';
    if (typeof r.useProxy !== 'boolean') r.useProxy = false;
    if (!r.model) r.model = 's2.1-pro';
    if (!r.format) r.format = 'mp3';
    if (!r.latency) r.latency = 'normal';
    if (typeof r.speed !== 'number') r.speed = 1;
    if (typeof r.volume !== 'number') r.volume = 0;
    if (typeof r.temperature !== 'number') r.temperature = 0.7;
    if (typeof r.topP !== 'number') r.topP = 0.7;
    if (typeof r.chunkLength !== 'number') r.chunkLength = 300;
    if (typeof r.sampleRate !== 'number') r.sampleRate = 44100;
    if (typeof r.mp3Bitrate !== 'number') r.mp3Bitrate = 128;
    if (typeof r.opusBitrate !== 'number') r.opusBitrate = -1000;
    if (typeof r.normalizeLoudness !== 'boolean') r.normalizeLoudness = true;
    if (typeof r.normalize !== 'boolean') r.normalize = true;
    if (!Array.isArray(r.myVoices)) r.myVoices = [];
    return r;
}

function save() { saveSettingsDebounced(); }

function genId() {
    return 'fv_' + (crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
}

export function listMyVoices() { return [...(getRoot().myVoices || [])]; }

export function listAllSpeakers() {
    return listMyVoices().map(v => ({ name: v.nickname, id: v.id }));
}

export function findVoiceByName(name) {
    if (!name) return null;
    const low = name.toLowerCase().trim();
    return getRoot().myVoices?.find(v =>
        v.nickname?.toLowerCase() === low || v.referenceId?.toLowerCase() === low,
    ) || null;
}

export function findMyVoice(id) {
    return getRoot().myVoices?.find(v => v.id === id) || null;
}

export function getCurrentVoiceId()  { return getRoot().currentVoiceId || ''; }
export function setCurrentVoiceId(id)  { getRoot().currentVoiceId  = id || ''; save(); }
export function getNarrationVoiceId() { return getRoot().narrationVoiceId || ''; }
export function setNarrationVoiceId(id) { getRoot().narrationVoiceId = id || ''; save(); }

/**
 * 添加音色条目。若 referenceId 已存在则更新昵称。
 * @returns {string} 内部 id
 */
export function addVoice({ nickname, referenceId }) {
    if (!nickname?.trim() || !referenceId?.trim()) {
        throw new Error('Fish Audio: 昵称和 reference_id 不能为空');
    }
    const root = getRoot();
    const existing = root.myVoices?.find(v => v.referenceId === referenceId.trim());
    if (existing) {
        existing.nickname = nickname.trim();
        save();
        return existing.id;
    }
    const entry = { id: genId(), nickname: nickname.trim(), referenceId: referenceId.trim() };
    root.myVoices.push(entry);
    save();
    return entry.id;
}

export function deleteVoice(id) {
    const root = getRoot();
    root.myVoices = (root.myVoices || []).filter(v => v.id !== id);
    if (root.currentVoiceId === id)  root.currentVoiceId  = '';
    if (root.narrationVoiceId === id) root.narrationVoiceId = '';
    save();
}

/**
 * 解析 voiceId → { referenceId, displayName }
 * voiceId 可以是内部 fv_xxx id，也可以直接是 referenceId 字符串。
 */
export function resolveVoicePayload(voiceId) {
    const entry = findMyVoice(voiceId) || findVoiceByName(voiceId);
    if (entry) return { referenceId: entry.referenceId, displayName: entry.nickname };
    return { referenceId: voiceId, displayName: voiceId };
}
