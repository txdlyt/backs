// @ts-nocheck
// Fish Audio TTS — 兼容接口（与 ST-iPhonie 一致）
// POST {base}/compat/v1/audio/speech  application/json

export class FishAudioError extends Error {
    constructor(message, status = null, detail = null) {
        super(message);
        this.name = 'FishAudioError';
        this.status = status;
        this.detail = detail;
    }
}

/** iPhonie 同款模型列表 */
export const FISH_MODELS = [
    { id: 's2.1-pro', label: 's2.1-pro（推荐）' },
    { id: 's2.1-pro-free', label: 's2.1-pro-free' },
    { id: 's2-pro', label: 's2-pro' },
    { id: 's1', label: 's1' },
    { id: 'drama-3', label: 'drama-3（原生接口，需代理/中转）' },
];

export const FISH_DEFAULT_MODEL = 's2.1-pro';

export function normalizeBaseUrl(url) {
    return String(url || 'https://api.fish.audio').trim().replace(/\/+$/, '');
}

/** drama-3 等不在兼容列表的模型走 native */
export function isNativeModel(model) {
    const m = String(model || '').replace(/^fish-audio\//, '');
    return m === 'drama-3';
}

export function resolveRequestUrl(baseUrl, { mode = 'compat', useProxy = false } = {}) {
    const base = normalizeBaseUrl(baseUrl);
    const path = mode === 'native' ? '/v1/tts' : '/compat/v1/audio/speech';
    const full = `${base}${path}`;
    if (full.startsWith('/proxy/')) return full;
    if (useProxy && mode === 'native') {
        try {
            const u = new URL(full);
            if (u.hostname === 'api.fish.audio' || u.hostname.endsWith('.fish.audio')) {
                return `/proxy/${full}`;
            }
        } catch (_) {}
    }
    return full;
}

function sleep(ms, signal) {
    if (!(ms > 0)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let done = false, tm = null;
        const fin = (fn, v) => {
            if (done) return; done = true;
            tm && clearTimeout(tm);
            signal && signal.removeEventListener('abort', onAbort);
            fn(v);
        };
        const onAbort = () => fin(reject, new FishAudioError('请求已取消'));
        if (signal?.aborted) { onAbort(); return; }
        tm = setTimeout(() => fin(resolve), ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function parseRetryAfterMs(val) {
    const raw = String(val || '').trim();
    if (!raw) return 5000;
    const s = Number(raw);
    if (Number.isFinite(s) && s >= 0) return Math.min(60000, Math.max(1000, Math.round(s * 1000)));
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? Math.min(60000, Math.max(1000, ts - Date.now())) : 5000;
}

/** 组装 provider.options['fish-audio'] 参数（对齐 iPhonie） */
export function buildFishOptions(opts = {}) {
    const prosody = {};
    if (opts.speed != null && opts.speed !== '') prosody.speed = Number(opts.speed);
    if (opts.volume != null && opts.volume !== '') prosody.volume = Number(opts.volume);
    if (opts.normalizeLoudness != null) prosody.normalize_loudness = !!opts.normalizeLoudness;

    const body = {};
    if (Object.keys(prosody).length) body.prosody = prosody;
    if (opts.temperature != null && opts.temperature !== '') body.temperature = Number(opts.temperature);
    if (opts.topP != null && opts.topP !== '') body.top_p = Number(opts.topP);
    if (opts.latency) body.latency = opts.latency;
    if (opts.chunkLength != null && opts.chunkLength !== '') body.chunk_length = Number(opts.chunkLength);
    if (opts.minChunkLength != null && opts.minChunkLength !== '') body.min_chunk_length = Number(opts.minChunkLength);
    if (opts.normalize != null) body.normalize = !!opts.normalize;
    if (opts.conditionOnPreviousChunks != null) body.condition_on_previous_chunks = !!opts.conditionOnPreviousChunks;
    if (opts.sampleRate != null && opts.sampleRate !== '') body.sample_rate = Number(opts.sampleRate);
    if (opts.mp3Bitrate != null && opts.mp3Bitrate !== '' && (opts.format || 'mp3') === 'mp3') {
        body.mp3_bitrate = Number(opts.mp3Bitrate);
    }
    if (opts.opusBitrate != null && opts.opusBitrate !== '' && (opts.format || '') === 'opus') {
        body.opus_bitrate = Number(opts.opusBitrate);
    }
    // format 在兼容层用 response_format，native 时放 body
    if (opts.format) body.format = opts.format;
    return body;
}

/**
 * @param {string} text
 * @param {object} opts — apiKey, baseUrl, referenceId, model, format, speed, volume, ...
 */
export async function requestFishAudioTTS(text, opts = {}) {
    const {
        apiKey,
        baseUrl,
        referenceId,
        model = FISH_DEFAULT_MODEL,
        format = 'mp3',
        useProxy = false,
        timeout = 30000,
        retryCount = 2,
        signal,
    } = opts;

    if (!text?.trim()) throw new FishAudioError('Fish Audio: 文本为空');
    if (!apiKey) throw new FishAudioError('Fish Audio: 未配置 API Key');
    if (!referenceId) throw new FishAudioError('Fish Audio: 未配置 reference_id（音色 ID）');

    const modelId = String(model || FISH_DEFAULT_MODEL).replace(/^fish-audio\//, '');
    const mode = opts.mode || (isNativeModel(modelId) ? 'native' : 'compat');
    const url = resolveRequestUrl(baseUrl, { mode, useProxy });
    const fishOpts = buildFishOptions({ ...opts, format });

    for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
            const ctrl = new AbortController();
            const tm = setTimeout(() => ctrl.abort(), timeout);
            signal?.addEventListener('abort', () => ctrl.abort(), { once: true });

            let resp;
            try {
                if (mode === 'native') {
                    resp = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                            'model': modelId,
                        },
                        body: JSON.stringify({
                            text: String(text).trim(),
                            reference_id: String(referenceId).trim(),
                            ...fishOpts,
                            format: format || 'mp3',
                        }),
                        signal: ctrl.signal,
                        credentials: useProxy ? 'include' : 'omit',
                    });
                } else {
                    // 兼容接口：与 iPhonie 相同结构
                    const { format: _f, ...providerBody } = fishOpts;
                    resp = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: `fish-audio/${modelId}`,
                            input: String(text).trim(),
                            voice: String(referenceId).trim(),
                            response_format: format || 'mp3',
                            provider: {
                                options: {
                                    'fish-audio': providerBody,
                                },
                            },
                        }),
                        signal: ctrl.signal,
                        credentials: 'omit',
                    });
                }
                clearTimeout(tm);
            } catch (e) {
                clearTimeout(tm);
                const isTimeout = e?.name === 'AbortError';
                if (!isTimeout || attempt >= retryCount) {
                    throw new FishAudioError(
                        isTimeout ? `请求超时 (${timeout / 1000}s)` : `网络错误: ${e?.message || e}`,
                        isTimeout ? 408 : null,
                    );
                }
                continue;
            }

            if (resp.status === 429) {
                const waitMs = parseRetryAfterMs(resp.headers.get('retry-after'));
                if (attempt >= retryCount) {
                    const t = await resp.text().catch(() => '');
                    throw new FishAudioError(`HTTP 429: ${t.slice(0, 200) || 'Too many requests'}`, 429, t);
                }
                await sleep(waitMs, signal);
                continue;
            }

            if (!resp.ok) {
                const t = await resp.text().catch(() => '');
                throw new FishAudioError(`HTTP ${resp.status}: ${t.slice(0, 400)}`, resp.status, t);
            }

            const buf = await resp.arrayBuffer();
            if (!buf || buf.byteLength === 0) throw new FishAudioError('Fish Audio: 返回了空音频数据');

            const mimes = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg; codecs=opus', flac: 'audio/flac', pcm: 'audio/pcm' };
            const mime = mimes[format] || 'audio/mpeg';
            return { blob: new Blob([buf], { type: mime }), mime, format };
        } catch (e) {
            const retry = attempt < retryCount
                && e instanceof FishAudioError
                && (e.status === 408 || (typeof e.status === 'number' && e.status >= 500));
            if (!retry) throw e;
            console.warn(`[Fish Audio TTS] retry ${attempt + 1}/${retryCount}:`, e);
        }
    }
    throw new FishAudioError('Fish Audio: 重试次数用尽');
}

export async function pingFishAudio(opts = {}) {
    if (!opts.referenceId) throw new FishAudioError('Fish Audio: 测试需要提供 reference_id');
    const { blob } = await requestFishAudioTTS('你好', {
        ...opts,
        format: opts.format || 'mp3',
        timeout: opts.timeout || 20000,
        retryCount: 0,
    });
    return { ok: true, bytes: blob.size };
}
