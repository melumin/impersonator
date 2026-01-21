import { saveSettingsDebounced, substituteParamsExtended, generateRaw, eventSource, event_types, chat_metadata } from '../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync, saveMetadataDebounced } from '../../extensions.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../slash-commands/SlashCommandArgument.js';
import { isTrueBoolean } from '../../utils.js';
import { getWorldInfoPrompt } from '../../world-info.js';

const MODULE_NAME = 'impersonator';
const DEBUG = true;

const log = (...args) => DEBUG && console.log('[Impersonator]', ...args);
const warn = (...args) => console.warn('[Impersonator]', ...args);
const error = (...args) => console.error('[Impersonator]', ...args);

const defaultSettings = {
    enabled: false,
    systemPrompt: 'You are roleplaying as {{user}}. Based on the conversation context and {{user}}\'s personality, continue the dialogue naturally. Stay in character and respond as {{user}} would.',
    contextSize: 10,
    maxTokens: 200,
    instruction: '',
    includeCharCard: true,
    includePersona: true,
    includeWI: false,
};

const presets = {
    default: {
        systemPrompt: 'You are roleplaying as {{user}}. Based on the conversation context and {{user}}\'s personality, continue the dialogue naturally. Stay in character and respond as {{user}} would.',
        contextSize: 10,
        maxTokens: 200,
        instruction: '',
    },
    concise: {
        systemPrompt: 'You are {{user}}. Reply briefly and naturally, staying in character. Keep responses short and to the point.',
        contextSize: 5,
        maxTokens: 100,
        instruction: 'Be concise. Use 1-2 sentences maximum. Focus on immediate reactions.',
    },
    detailed: {
        systemPrompt: 'You are {{user}}. Provide detailed, thoughtful responses that reflect {{user}}\'s personality and the conversation context. Express emotions, thoughts, and reactions fully.',
        contextSize: 15,
        maxTokens: 400,
        instruction: 'Be descriptive and expressive. Show {{user}}\'s thoughts and feelings. Include internal monologue when appropriate.',
    },
    creative: {
        systemPrompt: 'You are {{user}}. Be creative and expressive in your responses. Use vivid descriptions, metaphors, and show personality through your writing style.',
        contextSize: 12,
        maxTokens: 300,
        instruction: 'Be creative and engaging. Use descriptive language. Show personality through unique expressions and reactions.',
    },
};

let settings = null;
let isProcessing = false;

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }

    Object.keys(defaultSettings).forEach(key => {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = defaultSettings[key];
        }
    });

    settings = extension_settings[MODULE_NAME];

    $('#impersonator_enabled').prop('checked', settings.enabled);
    $('#impersonator_system_prompt').val(settings.systemPrompt);
    $('#impersonator_context_size').val(settings.contextSize);
    $('#impersonator_context_size_value').text(settings.contextSize);
    $('#impersonator_max_tokens').val(settings.maxTokens);
    $('#impersonator_max_tokens_value').text(settings.maxTokens);
    $('#impersonator_instruction').val(settings.instruction);
    $('#impersonator_include_char_card').prop('checked', settings.includeCharCard);
    $('#impersonator_include_persona').prop('checked', settings.includePersona);
    $('#impersonator_include_wi').prop('checked', settings.includeWI);

    updateConfigVisibility();
    log('Settings loaded:', settings);
}

function updateConfigVisibility() {
    const enabled = settings.enabled;
    $('#impersonator_config').toggleClass('enabled', enabled);
    $('#impersonator_status').toggleClass('active', enabled);
}

async function buildImpersonationPrompt() {
    const context = getContext();
    const chat = context.chat;
    
    if (!chat || chat.length === 0) {
        warn('No chat context available');
        return null;
    }

    let systemPrompt = substituteParamsExtended(settings.systemPrompt);
    
    // Add character card if enabled
    if (settings.includeCharCard && context.characterId !== undefined) {
        const charData = context.characters[context.characterId];
        if (charData && charData.description) {
            systemPrompt += `\n\n### Character Information ({{char}}):\n${charData.description}`;
            log('Added character card to prompt');
        }
    }

    // Add user persona if enabled
    if (settings.includePersona && context.name1) {
        const persona = context.persona || '';
        if (persona) {
            systemPrompt += `\n\n### Your Persona ({{user}}):\n${persona}`;
            log('Added user persona to prompt');
        }
    }

    // Add World Info if enabled
    if (settings.includeWI) {
        try {
            const wiPrompt = await getWorldInfoPrompt();
            if (wiPrompt) {
                systemPrompt += `\n\n### World Information:\n${wiPrompt}`;
                log('Added World Info to prompt');
            }
        } catch (err) {
            warn('Failed to get World Info:', err);
        }
    }

    // Add additional instructions
    if (settings.instruction) {
        systemPrompt += `\n\n### Additional Instructions:\n${substituteParamsExtended(settings.instruction)}`;
    }

    // Build context from recent messages
    const contextSize = Math.min(settings.contextSize, chat.length);
    const recentMessages = chat.slice(-contextSize);
    
    const contextMessages = recentMessages
        .filter(msg => !msg.is_system && msg.mes)
        .map(msg => `${msg.name}: ${msg.mes}`)
        .join('\n\n');

    const userPrompt = `### Recent Conversation:\n\n${contextMessages}\n\n${context.name1}:`;

    log('Built impersonation prompt with', contextSize, 'messages');
    return { systemPrompt, userPrompt };
}

async function doImpersonate() {
    if (isProcessing) {
        toastr.warning('Impersonation already in progress', 'Impersonator');
        return null;
    }

    if (!settings.enabled) {
        log('Custom impersonation is disabled');
        return null;
    }

    const prompts = await buildImpersonationPrompt();
    
    if (!prompts) {
        toastr.error('No conversation context available', 'Impersonator');
        return null;
    }

    try {
        isProcessing = true;
        log('Starting impersonation...');
        
        const response = await generateRaw({
            prompt: prompts.userPrompt,
            systemPrompt: prompts.systemPrompt,
            responseLength: settings.maxTokens > 0 ? settings.maxTokens : undefined,
        });

        if (!response) {
            throw new Error('Empty response received');
        }

        log('Impersonation successful, length:', response.length);
        return response.trim();
    } catch (err) {
        error('Impersonation failed:', err);
        toastr.error(`Failed to generate response: ${err.message}`, 'Impersonator');
        return null;
    } finally {
        isProcessing = false;
    }
}

async function testImpersonation() {
    const result = await doImpersonate();
    
    if (result) {
        toastr.success('Test successful!', 'Impersonator');
        log('Test result:', result);
        
        // Show in a styled popup
        const popup = document.createElement('div');
        popup.className = 'imp--test-popup';
        popup.innerHTML = `
            <div class="imp--test-overlay"></div>
            <div class="imp--test-content">
                <div class="imp--test-header">
                    <h3><i class="fa-solid fa-flask"></i> Test Impersonation Result</h3>
                    <button class="imp--test-close" title="Close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="imp--test-body">
                    <div class="imp--test-label">Generated Response:</div>
                    <div class="imp--test-result">${result.replace(/\n/g, '<br>')}</div>
                    <div class="imp--test-stats">
                        <span><i class="fa-solid fa-font"></i> ${result.length} characters</span>
                        <span><i class="fa-solid fa-align-left"></i> ${result.split(/\s+/).length} words</span>
                    </div>
                </div>
                <div class="imp--test-footer">
                    <button class="imp--test-copy menu_button">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                    <button class="imp--test-close-btn menu_button">
                        <i class="fa-solid fa-check"></i> Close
                    </button>
                </div>
            </div>
        `;
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .imp--test-popup { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; }
            .imp--test-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); }
            .imp--test-content { position: relative; background: var(--SmartThemeBlurTintColor); border: 2px solid var(--SmartThemeBorderColor); border-radius: 12px; max-width: 700px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.5); animation: imp--slideIn 0.3s ease; }
            @keyframes imp--slideIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
            .imp--test-header { display: flex; align-items: center; justify-content: space-between; padding: 1.5em; border-bottom: 2px solid var(--SmartThemeBorderColor); }
            .imp--test-header h3 { margin: 0; display: flex; align-items: center; gap: 0.5em; color: var(--SmartThemeQuoteColor); }
            .imp--test-close { background: none; border: none; color: var(--grey70); cursor: pointer; font-size: 1.5em; padding: 0; transition: color 0.2s; }
            .imp--test-close:hover { color: var(--SmartThemeBodyColor); }
            .imp--test-body { padding: 1.5em; overflow-y: auto; flex: 1; }
            .imp--test-label { font-weight: 600; margin-bottom: 0.75em; color: var(--SmartThemeBodyColor); }
            .imp--test-result { background: var(--black30alpha); padding: 1em; border-radius: 8px; border-left: 3px solid var(--SmartThemeQuoteColor); font-family: var(--mainFontFamily); line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; }
            .imp--test-stats { display: flex; gap: 1.5em; margin-top: 1em; font-size: 0.9em; color: var(--grey70); }
            .imp--test-stats span { display: flex; align-items: center; gap: 0.5em; }
            .imp--test-footer { display: flex; gap: 0.75em; padding: 1.5em; border-top: 2px solid var(--SmartThemeBorderColor); }
            .imp--test-footer button { flex: 1; }
        `;
        popup.appendChild(style);
        
        document.body.appendChild(popup);
        
        const closePopup = () => document.body.removeChild(popup);
        popup.querySelector('.imp--test-overlay').addEventListener('click', closePopup);
        popup.querySelectorAll('.imp--test-close, .imp--test-close-btn').forEach(btn => {
            btn.addEventListener('click', closePopup);
        });
        popup.querySelector('.imp--test-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(result);
            toastr.success('Copied to clipboard!', 'Impersonator');
        });
    }
}

function applyPreset(presetName) {
    const preset = presets[presetName];
    
    if (!preset) {
        toastr.error('Preset not found', 'Impersonator');
        return;
    }

    settings.systemPrompt = preset.systemPrompt;
    settings.contextSize = preset.contextSize;
    settings.maxTokens = preset.maxTokens;
    settings.instruction = preset.instruction;

    $('#impersonator_system_prompt').val(preset.systemPrompt);
    $('#impersonator_context_size').val(preset.contextSize);
    $('#impersonator_context_size_value').text(preset.contextSize);
    $('#impersonator_max_tokens').val(preset.maxTokens);
    $('#impersonator_max_tokens_value').text(preset.maxTokens);
    $('#impersonator_instruction').val(preset.instruction);

    saveSettingsDebounced();
    toastr.success(`Applied "${presetName}" preset`, 'Impersonator');
    log('Applied preset:', presetName);
}

function exportSettings() {
    const exportData = {
        version: '1.0',
        settings: settings,
        timestamp: new Date().toISOString(),
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `impersonator-settings-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    toastr.success('Settings exported successfully', 'Impersonator');
    log('Settings exported');
}

function importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            if (!data.settings) {
                throw new Error('Invalid settings file');
            }
            
            Object.assign(settings, data.settings);
            loadSettings();
            saveSettingsDebounced();
            
            toastr.success('Settings imported successfully', 'Impersonator');
            log('Settings imported:', data);
        } catch (err) {
            error('Import failed:', err);
            toastr.error(`Failed to import settings: ${err.message}`, 'Impersonator');
        }
    };
    input.click();
}

// Slash command handler
async function impersonateCommand(args, value) {
    const quiet = isTrueBoolean(args?.quiet);
    
    if (!quiet) {
        toastr.info('Generating impersonated response...', 'Impersonator');
    }
    
    const result = await doImpersonate();
    return result || '';
}

jQuery(async function () {
    const settingsHtml = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    $('#extensions_settings2').append(settingsHtml);

    loadSettings();

    // Event handlers
    $('#impersonator_enabled').on('change', function () {
        settings.enabled = $(this).prop('checked');
        updateConfigVisibility();
        saveSettingsDebounced();
        log('Enabled:', settings.enabled);
    });

    $('#impersonator_system_prompt').on('input', function () {
        settings.systemPrompt = $(this).val();
        saveSettingsDebounced();
    });

    $('#impersonator_context_size').on('input', function () {
        const value = $(this).val();
        settings.contextSize = Number(value);
        $('#impersonator_context_size_value').text(value);
        saveSettingsDebounced();
    });

    $('#impersonator_max_tokens').on('input', function () {
        const value = $(this).val();
        settings.maxTokens = Number(value);
        $('#impersonator_max_tokens_value').text(value);
        saveSettingsDebounced();
    });

    $('#impersonator_instruction').on('input', function () {
        settings.instruction = $(this).val();
        saveSettingsDebounced();
    });

    $('#impersonator_include_char_card').on('change', function () {
        settings.includeCharCard = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#impersonator_include_persona').on('change', function () {
        settings.includePersona = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#impersonator_include_wi').on('change', function () {
        settings.includeWI = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#impersonator_test').on('click', testImpersonation);
    $('#impersonator_export').on('click', exportSettings);
    $('#impersonator_import').on('click', importSettings);

    $('#impersonator_preset_default').on('click', () => applyPreset('default'));
    $('#impersonator_preset_concise').on('click', () => applyPreset('concise'));
    $('#impersonator_preset_detailed').on('click', () => applyPreset('detailed'));
    $('#impersonator_preset_creative').on('click', () => applyPreset('creative'));

    // Register slash command
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'impersonate',
        callback: impersonateCommand,
        namedArgumentList: [
            SlashCommandArgument.fromProps({
                name: 'quiet',
                description: 'suppress notifications',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'false',
            }),
        ],
        helpString: 'Generate a {{user}} response using custom impersonation settings. Use quiet=true to suppress notifications.',
        aliases: ['imp', 'impers'],
    }));

    // Hook into the impersonate event if available
    eventSource.on(event_types.IMPERSONATE_READY, async (prompt) => {
        if (settings.enabled) {
            log('Impersonate event triggered');
            const result = await doImpersonate();
            if (result) {
                return result;
            }
        }
    });

    log('Extension loaded successfully');
});

export { MODULE_NAME, doImpersonate };
