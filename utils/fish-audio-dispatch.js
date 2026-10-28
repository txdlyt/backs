// @ts-nocheck
// ═══════════════════════════════════════════════════════════
//  Fish Audio TTS 高层调度
//  与 nimo-dispatch / minimax-dispatch 同构，
//  供 index.js 的人物 TTS 分支消费（ttsPromises）。
// ═══════════════════════════════════════════════════════════

import { requestFishAudioTTS, FishAudioError } from './fish-audio-tts.js';
import { getRoot, resolveVoicePayload } from './fish-audio-voices.js';
import { addOrUpdateTtsItem, getTtsItem, generateTtsCacheKey } from './tts-cache.js';
import { floatBallStateManager } from './ui-float-ball.js';
import { ttsNotifyStart, ttsNotifyEnd } from './tts-notification.js';

export function generateFishAudioCacheKey(text, control, referenceId) {
    return generateTtsCacheKey(text, control || '', `fish:${referenceId || 'none'}`);
}

/**
 * @param {object} requestData
 *   {cacheKey, text, context_texts, speaker, voiceId,
 *    ir_description, special_effects, spatial, metadata}
 */
export async function initiateFishAudioRequest(requestData) {
    const {
        cacheKey, text, context_texts, speaker,
        voiceId,
        ir_description, special_effects, spatial, metadata,
    } = requestData;

    if (!text?.trim()) throw new Error('Fish Audio: 文本为空');
    if (!/[\p{L}\p{N}]/u.test(text)) {
        const msg = `Fish Audio: 跳过无可朗读字符的文本 "${text.slice(0, 20)}"`;
        console.warn('[Fish Audio Dispatch]', msg);
        throw new Error(msg);
    }
    if (!voiceId) throw new Error(`Fish Audio: 未提供 voiceId（speaker="${speaker || ''}"）`);

    const cached = getTtsItem(cacheKey);
    if (cached?.status === 'success') {
        console.log(`[Fish Audio Dispatch] cache hit: ${cacheKey}`);
        return { ...cached, metadata: { ...cached.metadata, ...metadata } };
    }

    addOrUpdateTtsItem(cacheKey, {
        cacheKey, text, context_texts,
        speaker, speaker_name: speaker,
        ir_description, special_effects, spatial,
        status: 'pending', metadata,
    });

    ttsNotifyStart('fish', 'Fish Audio');
    floatBallStateManager.startLoading();

    try {
        const settings = getRoot();
        if (!settings.apiKey) {
            throw new FishAudioError('Fish Audio: 未配置 API Key，请到「Fish Audio」设置页填写');
        }

        const payload = resolveVoicePayload(voiceId);

        const { blob, mime } = await requestFishAudioTTS(text, {
            apiKey: settings.apiKey,
            baseUrl: settings.baseUrl,
            referenceId: payload.referenceId,
            model: settings.model || 's2.1-pro',
            format: settings.format || 'mp3',
            latency: settings.latency || 'normal',
            speed: settings.speed,
            volume: settings.volume,
            temperature: settings.temperature,
            topP: settings.topP,
            chunkLength: settings.chunkLength,
            sampleRate: settings.sampleRate,
            mp3Bitrate: settings.mp3Bitrate,
            opusBitrate: settings.opusBitrate,
            normalizeLoudness: settings.normalizeLoudness,
            normalize: settings.normalize,
            useProxy: !!settings.useProxy,
        });

        const audioUrl = URL.createObjectURL(blob);
        const audioBuffer = await blob.arrayBuffer();

        const successItem = addOrUpdateTtsItem(cacheKey, {
            status: 'success',
            audioBuffer, audioBlob: blob, audioUrl,
            text, context_texts,
            speaker: `fish:${payload.displayName || voiceId}`,
            speaker_name: speaker,
            ir_description, special_effects, spatial,
        });
        return successItem;
    } catch (e) {
        console.error('[Fish Audio Dispatch] failed:', e);
        addOrUpdateTtsItem(cacheKey, { status: 'error', error: e?.message || String(e) });
        throw e;
    } finally {
        floatBallStateManager.stopLoading();
        ttsNotifyEnd('fish');
    }
}
