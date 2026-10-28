// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Fish Audio 设置面板 UI 控制
// ═══════════════════════════════════════════════════════════

import { saveSettingsDebounced } from '../../../../../script.js';
import { requestFishAudioTTS, pingFishAudio, FishAudioError } from './fish-audio-tts.js';
import {
    getRoot,
    listMyVoices,
    addVoice,
    deleteVoice,
    getCurrentVoiceId,
    setCurrentVoiceId,
    getNarrationVoiceId,
    setNarrationVoiceId,
    findMyVoice,
    resolveVoicePayload,
} from './fish-audio-voices.js';

function save() { saveSettingsDebounced(); }
function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── 连接设置 ─────────────────────────────────────────────

function updateApiKeyStatus() {
    const key = getRoot().apiKey || '';
    const $st = $('#fish_api_key_status');
    if (!$st.length) return;
    $st.text(key ? '已配置' : '未配置');
}

function loadSettingsToUI() {
    const s = getRoot();
    $('#fish_api_key').val(s.apiKey || '').css('-webkit-text-security', 'disc');
    updateApiKeyStatus();
    $('#fish_base_url').val(s.baseUrl || 'https://api.fish.audio');
    $('#fish_use_proxy').prop('checked', !!s.useProxy);
    $('#fish_model').val(s.model || 's2.1-pro');
    $('#fish_format').val(s.format || 'mp3');
    // 先写入再按格式约束对齐采样率/码率可见性
    syncFormatConstraints(s.format || 'mp3', { preferSave: false });
    if (s.sampleRate) $('#fish_sample_rate').val(String(s.sampleRate));
    $('#fish_latency').val(s.latency || 'normal');
    $('#fish_speed').val(s.speed ?? 1);
    $('#fish_volume').val(s.volume ?? 0);
    $('#fish_temperature').val(s.temperature ?? 0.7);
    $('#fish_top_p').val(s.topP ?? 0.7);
    $('#fish_chunk_length').val(s.chunkLength ?? 300);
    $('#fish_sample_rate').val(String(s.sampleRate ?? 44100));
    $('#fish_mp3_bitrate').val(String(s.mp3Bitrate ?? 128));
    $('#fish_normalize_loudness').prop('checked', s.normalizeLoudness !== false);
    $('#fish_normalize').prop('checked', s.normalize !== false);
    $('#fish_test_text').val(s.testText || '');
    renderCurrentVoice();
    renderNarrationVoice();
    renderVoiceList();
}

function bindConnectionEvents() {
    $('#fish_api_key').on('input', function () {
        getRoot().apiKey = String($(this).val()).trim();
        updateApiKeyStatus();
        save();
    });

    $('#fish_api_key_toggle').on('click', function () {
        const $t = $('#fish_api_key');
        const masked = $t.css('-webkit-text-security') !== 'none';
        $t.css('-webkit-text-security', masked ? 'none' : 'disc');
        $(this).find('i').attr('class', masked ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye');
    });

    $('#fish_base_url').on('input', function () {
        getRoot().baseUrl = String($(this).val()).trim() || 'https://api.fish.audio';
        save();
    });

    $('#fish_health_button').on('click', async function () {
        const $btn = $(this);
        const $st = $('#fish_health_status');
        const s = getRoot();
        const currentId = getCurrentVoiceId();
        const refId = currentId ? resolveVoicePayload(currentId).referenceId : '';

        if (!s.apiKey) { $st.text('⚠ 请先填写 API Key'); return; }
        if (!refId) { $st.text('⚠ 请先添加并选择一个音色'); return; }

        $btn.prop('disabled', true);
        $st.text('检测中…');
        try {
            const { bytes } = await pingFishAudio({
                ...collectSynthOpts(s),
                referenceId: refId,
            });
            $st.text(`✅ 连接正常（${bytes} 字节）`);
        } catch (e) {
            $st.text(`❌ ${e?.message || e}`);
        } finally {
            $btn.prop('disabled', false);
        }
    });
}

// ── 参数 ─────────────────────────────────────────────────

function bindParamEvents() {
    const num = (sel, key) => $(sel).on('input change', function () {
        const v = Number($(this).val());
        if (Number.isFinite(v)) { getRoot()[key] = v; save(); }
    });
    $('#fish_model').on('change', function () { getRoot().model = $(this).val(); save(); });
    $('#fish_format').on('change', function () {
        const format = $(this).val();
        getRoot().format = format;
        syncFormatConstraints(format, { preferSave: true });
    });
    $('#fish_opus_bitrate').on('change', function () { getRoot().opusBitrate = Number($(this).val()); save(); });
    $('#fish_latency').on('change', function () { getRoot().latency = $(this).val(); save(); });
    num('#fish_speed', 'speed');
    num('#fish_volume', 'volume');
    num('#fish_temperature', 'temperature');
    num('#fish_top_p', 'topP');
    num('#fish_chunk_length', 'chunkLength');
    $('#fish_sample_rate').on('change', function () { getRoot().sampleRate = Number($(this).val()); save(); });
    $('#fish_mp3_bitrate').on('change', function () { getRoot().mp3Bitrate = Number($(this).val()); save(); });
    $('#fish_normalize_loudness').on('change', function () { getRoot().normalizeLoudness = !!$(this).prop('checked'); save(); });
    $('#fish_normalize').on('change', function () { getRoot().normalize = !!$(this).prop('checked'); save(); });
    $('#fish_test_text').on('input', function () { getRoot().testText = $(this).val(); save(); });
}

// ── 音色管理 ─────────────────────────────────────────────

function renderCurrentVoice() {
    const id = getCurrentVoiceId();
    const entry = id ? findMyVoice(id) : null;
    $('#fish_current_voice_display').val(entry ? `${entry.nickname}  (${entry.referenceId})` : '');
}

function renderNarrationVoice() {
    const id = getNarrationVoiceId();
    const entry = id ? findMyVoice(id) : null;
    $('#fish_narration_voice_display').val(entry ? `${entry.nickname}  (${entry.referenceId})` : '');
}

function renderVoiceList() {
    const voices = listMyVoices();
    const currentId = getCurrentVoiceId();
    const narrationId = getNarrationVoiceId();
    const $list = $('#fish_voices_list');
    if (!$list.length) return;

    if (!voices.length) {
        $list.html('<div style="opacity:.5; font-size:13px;">暂无音色，请在上方添加。</div>');
        return;
    }

    const html = voices.map(v => {
        const isCurrent   = v.id === currentId;
        const isNarration = v.id === narrationId;
        const badges = [
            isCurrent   ? '<span style="background:rgba(79,124,255,.2);color:#60a5fa;padding:1px 8px;border-radius:10px;font-size:11px;">当前</span>' : '',
            isNarration ? '<span style="background:rgba(34,197,94,.2);color:#4ade80;padding:1px 8px;border-radius:10px;font-size:11px;">旁白</span>' : '',
        ].join('');
        return `
        <div class="fish-voice-item${isCurrent ? ' selected' : ''}" data-id="${esc(v.id)}">
            <div class="fname">${esc(v.nickname)} ${badges}</div>
            <div class="fmeta">${esc(v.referenceId)}</div>
            <div class="factions">
                <button data-action="set-current" data-id="${esc(v.id)}">设为当前音色</button>
                <button data-action="set-narration" data-id="${esc(v.id)}">设为旁白音色</button>
                <button class="danger" data-action="delete" data-id="${esc(v.id)}">删除</button>
            </div>
        </div>`;
    }).join('');
    $list.html(html);
}

function bindVoiceEvents() {
    $('#fish_add_voice_btn').on('click', function () {
        const nick  = String($('#fish_add_nick').val()).trim();
        const refId = String($('#fish_add_ref_id').val()).trim();
        if (!nick || !refId) {
            alert('Fish Audio：昵称和 reference_id 不能为空');
            return;
        }
        try {
            addVoice({ nickname: nick, referenceId: refId });
            $('#fish_add_nick').val('');
            $('#fish_add_ref_id').val('');
            renderVoiceList();
        } catch (e) {
            alert(e?.message || String(e));
        }
    });

    $('#fish_current_voice_clear').on('click', function () {
        setCurrentVoiceId('');
        renderCurrentVoice();
        renderVoiceList();
    });

    $('#fish_narration_voice_clear').on('click', function () {
        setNarrationVoiceId('');
        renderNarrationVoice();
        renderVoiceList();
    });

    $('#fish_voices_list').on('click', '[data-action]', function () {
        const action = $(this).data('action');
        const id = $(this).data('id');
        if (action === 'set-current') {
            setCurrentVoiceId(id);
            renderCurrentVoice();
            renderVoiceList();
        } else if (action === 'set-narration') {
            setNarrationVoiceId(id);
            renderNarrationVoice();
            renderVoiceList();
        } else if (action === 'delete') {
            if (!confirm('确认删除这个音色？')) return;
            deleteVoice(id);
            renderCurrentVoice();
            renderNarrationVoice();
            renderVoiceList();
        }
    });
}

// ── 测试合成 ─────────────────────────────────────────────

function bindTestEvents() {
    $('#fish_test_button').on('click', async function () {
        const $btn = $(this);
        const $st  = $('#fish_test_status');
        const $audio = $('#fish_test_audio');
        const s = getRoot();
        const text = String($('#fish_test_text').val()).trim() || s.testText || '你好';
        const currentId = getCurrentVoiceId();

        if (!s.apiKey)   { $st.text('⚠ 未配置 API Key'); return; }
        if (!currentId)  { $st.text('⚠ 请先选择当前音色'); return; }

        const payload = resolveVoicePayload(currentId);
        if (!payload.referenceId) { $st.text('⚠ 音色 reference_id 为空'); return; }

        $btn.prop('disabled', true);
        $st.text('合成中…');
        $audio.hide();

        try {
            const { blob } = await requestFishAudioTTS(text, {
                ...collectSynthOpts(s),
                referenceId: payload.referenceId,
            });
            const url = URL.createObjectURL(blob);
            $audio[0].src = url;
            $audio.show()[0].play().catch(() => {});
            $st.text(`✅ 合成成功（${blob.size} 字节）`);
        } catch (e) {
            $st.text(`❌ ${e?.message || e}`);
        } finally {
            $btn.prop('disabled', false);
        }
    });
}

// ── 公开初始化入口 ────────────────────────────────────────



// 官方文档采样率/码率约束（docs.fish.audio）
// MP3: 32k / 44.1k；码率 64/128/192
// WAV/PCM: 8k/16k/24k/32k/44.1k
// Opus: 仅 48k；码率 -1000(自动)/24k/32k/48k/64k
const FISH_FORMAT_CONSTRAINTS = {
    mp3: {
        sampleRates: [32000, 44100],
        defaultSampleRate: 44100,
        hint: 'MP3 仅支持 32kHz / 44.1kHz',
        showMp3: true,
        showOpus: false,
    },
    wav: {
        sampleRates: [8000, 16000, 24000, 32000, 44100],
        defaultSampleRate: 44100,
        hint: 'WAV/PCM 支持 8k～44.1kHz',
        showMp3: false,
        showOpus: false,
    },
    pcm: {
        sampleRates: [8000, 16000, 24000, 32000, 44100],
        defaultSampleRate: 44100,
        hint: 'WAV/PCM 支持 8k～44.1kHz',
        showMp3: false,
        showOpus: false,
    },
    opus: {
        sampleRates: [48000],
        defaultSampleRate: 48000,
        hint: 'Opus 固定 48kHz',
        showMp3: false,
        showOpus: true,
    },
};

function syncFormatConstraints(format, { preferSave = true } = {}) {
    const c = FISH_FORMAT_CONSTRAINTS[format] || FISH_FORMAT_CONSTRAINTS.mp3;
    const $sr = $('#fish_sample_rate');
    if (!$sr.length) return;

    const cur = Number($sr.val());
    $sr.empty();
    for (const r of c.sampleRates) {
        $sr.append(`<option value="${r}">${r}</option>`);
    }
    const next = c.sampleRates.includes(cur) ? cur : c.defaultSampleRate;
    $sr.val(String(next));

    const $hint = $('#fish_sample_rate_hint');
    if ($hint.length) $hint.text(c.hint || '');

    $('#fish_mp3_bitrate_field').toggle(!!c.showMp3);
    $('#fish_opus_bitrate_field').toggle(!!c.showOpus);

    const s = getRoot();
    s.format = format;
    s.sampleRate = next;
    if (preferSave) save();
}

function collectSynthOpts(s) {
    const format = s.format || 'mp3';
    const c = FISH_FORMAT_CONSTRAINTS[format] || FISH_FORMAT_CONSTRAINTS.mp3;
    let sampleRate = Number(s.sampleRate);
    if (!c.sampleRates.includes(sampleRate)) sampleRate = c.defaultSampleRate;
    return {
        apiKey: s.apiKey,
        baseUrl: s.baseUrl,
        model: s.model || 's2.1-pro',
        format,
        latency: s.latency || 'normal',
        speed: s.speed,
        volume: s.volume,
        temperature: s.temperature,
        topP: s.topP,
        chunkLength: s.chunkLength,
        sampleRate,
        mp3Bitrate: format === 'mp3' ? s.mp3Bitrate : undefined,
        opusBitrate: format === 'opus' ? (s.opusBitrate ?? -1000) : undefined,
        normalizeLoudness: s.normalizeLoudness,
        normalize: s.normalize,
        useProxy: !!s.useProxy,
    };
}

export function initFishAudioSettings() {
    if (!$('#st-is-tab-fish-audio').length) return;
    loadSettingsToUI();
    bindConnectionEvents();
    bindParamEvents();
    bindVoiceEvents();
    bindTestEvents();
}
