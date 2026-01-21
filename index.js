import { saveSettingsDebounced, substituteParamsExtended, generateRaw, eventSource, event_types } from '../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../extensions.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../slash-commands/SlashCommandArgument.js';
import { isTrueBoolean, download } from '../../utils.js';

const MODULE_NAME = 'impersonator';
const DEBUG = true;

const log = (...args) => DEBUG && console.log('[Impersonator]', ...args);
const warn = (...args) => console.warn('[Impersonator]', ...args);
const error = (...args) => console.error('[Impersonator]', ...args);

const defaultPreset = {
    name: 'Default',
    systemPrompt: 'You are roleplaying as {{user}}. Based on the conversation context and {{user}}\'s personality, continue the dialogue naturally. Stay in character and respond as {{user}} would.',
    contextSize: 10,
    maxTokens: 200,
    instruction: '',
    includeCharCard: false,
    includePersona: true,
    pov: 'first', // first, second, third
    responseStyle: 'medium', // short, medium, long, adaptive
};

const builtInPresets = {
    'Default': {
        name: 'Default',
        systemPrompt: 'You are {{user}}. Continue the conversation naturally based on the context and your personality. Stay in character.',
        contextSize: 10,
        maxTokens: 200,
        instruction: 'Write in first person perspective. Match the conversation style.',
        includeCharCard: false,
        includePersona: true,
        pov: 'first',
        responseStyle: 'medium',
    },
    'First Person Short': {
        name: 'First Person Short',
        systemPrompt: 'You are {{user}}. Reply briefly in first person, staying in character.',
        contextSize: 5,
        maxTokens: 100,
        instruction: 'Use "I" perspective. Keep responses to 1-2 sentences. Be direct and immediate.',
        includeCharCard: false,
        includePersona: true,
        pov: 'first',
        responseStyle: 'short',
    },
    'First Person Detailed': {
        name: 'First Person Detailed',
        systemPrompt: 'You are {{user}}. Provide detailed first-person responses that reflect your personality, thoughts, and emotions.',
        contextSize: 15,
        maxTokens: 400,
        instruction: 'Use "I" perspective. Include internal thoughts and feelings. Be descriptive and expressive.',
        includeCharCard: false,
        includePersona: true,
        pov: 'first',
        responseStyle: 'long',
    },
    'Second Person': {
        name: 'Second Person',
        systemPrompt: 'Narrate {{user}}\'s actions and responses in second person perspective.',
        contextSize: 10,
        maxTokens: 250,
        instruction: 'Use "You" perspective. Describe actions and dialogue as if narrating to the reader.',
        includeCharCard: false,
        includePersona: true,
        pov: 'second',
        responseStyle: 'medium',
    },
    'Third Person': {
        name: 'Third Person',
        systemPrompt: 'Narrate {{user}}\'s actions and responses in third person perspective.',
        contextSize: 10,
        maxTokens: 250,
        instruction: 'Use "{{user}}" or appropriate pronouns. Describe actions and dialogue from an outside perspective.',
        includeCharCard: false,
        includePersona: true,
        pov: 'third',
        responseStyle: 'medium',
    },
    'Adaptive Context': {
        name: 'Adaptive Context',
        systemPrompt: 'You are {{user}}. Analyze the recent conversation and match the style, length, and tone of previous {{user}} messages.',
        contextSize: 20,
        maxTokens: 300,
        instruction: 'Adapt to the conversation style. If previous messages were short, be brief. If detailed, be expressive. Match the established pattern.',
        includeCharCard: false,
        includePersona: true,
        pov: 'first',
        responseStyle: 'adaptive',
    },
};

const defaultSettings = {
    enabled: false,
    activePreset: 'Default',
    presets: { ...builtInPresets },
    currentSettings: { ...defaultPreset },
};

let settings = null;
let isProcessing = false;

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = { ...defaultSettings };
    }

    // Ensure all default settings exist
    Object.keys(defaultSettings).forEach(key => {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = defaultSettings[key];
        }
    });

    // Ensure built-in presets exist
    if (!extension_settings[MODULE_NAME].presets) {
        extension_settings[MODULE_NAME].presets = { ...builtInPresets };
    } else {
        // Merge built-in presets with existing ones
        Object.keys(builtInPresets).forEach(key => {
            if (!extension_settings[MODULE_NAME].presets[key]) {
                extension_settings[MODULE_NAME].presets[key] = builtInPresets[key];
            }
        });
    }

    settings = extension_settings[MODULE_NAME];

    // Ensure activePreset is valid
    if (!settings.activePreset || !settings.presets[settings.activePreset]) {
        settings.activePreset = 'Default';
    }

    // Load current settings from active preset
    const currentPreset = settings.presets[settings.activePreset];
    settings.currentSettings = { ...currentPreset };

    log('Settings loaded:', settings);
}

function loadPresetList() {
    const select = $('#impersonator-preset-list');
    if (!select.length) {
        warn('Preset list element not found');
        return;
    }
    
    select.empty();
    
    const presetNames = Object.keys(settings.presets);
    log('Loading preset list with', presetNames.length, 'presets:', presetNames);
    
    presetNames.forEach(name => {
        select.append($('<option></option>').attr('value', name).text(name));
    });
    
    select.val(settings.activePreset);
    log('Preset list loaded, active:', settings.activePreset);
}

function loadCurrentPreset() {
    const current = settings.currentSettings;
    
    $('#impersonator_system_prompt').val(current.systemPrompt || '');
    $('#impersonator_context_size').val(current.contextSize || 10);
    $('#impersonator_context_size_value').text(current.contextSize || 10);
    $('#impersonator_max_tokens').val(current.maxTokens || 200);
    $('#impersonator_max_tokens_value').text(current.maxTokens || 200);
    $('#impersonator_instruction').val(current.instruction || '');
    $('#impersonator_include_char_card').prop('checked', current.includeCharCard === true);
    $('#impersonator_include_persona').prop('checked', current.includePersona !== false);
    $('#impersonator_pov').val(current.pov || 'first');
    $('#impersonator_response_style').val(current.responseStyle || 'medium');
    
    log('Loaded preset settings:', current);
}

function updateConfigVisibility() {
    const enabled = settings.enabled;
    $('#impersonator_config').toggleClass('enabled', enabled);
    updateImpersonateButton();
}

function updateImpersonateButton() {
    const button = $('#impersonateButton');
    if (settings.enabled) {
        button.removeClass('disabled');
        button.attr('title', 'Impersonate (Custom)');
    } else {
        button.addClass('disabled');
        button.attr('title', 'Impersonator disabled');
    }
}

async function buildImpersonationPrompt() {
    const context = getContext();
    const chat = context.chat;
    const current = settings.currentSettings;
    
    if (!chat || chat.length === 0) {
        warn('No chat context available');
        return null;
    }

    let systemPrompt = substituteParamsExtended(current.systemPrompt);
    
    // Add user persona FIRST if enabled (prioritize persona)
    if (current.includePersona !== false) {
        const persona = context.persona || '';
        if (persona) {
            systemPrompt += `\n\n### Your Persona ({{user}}):\n${persona}`;
            log('Added user persona to prompt');
        }
    }

    // Add character card ONLY if explicitly enabled
    if (current.includeCharCard === true && context.characterId !== undefined) {
        const charData = context.characters[context.characterId];
        if (charData && charData.description) {
            systemPrompt += `\n\n### Character Information ({{char}}):\n${charData.description}`;
            log('Added character card to prompt');
        }
    }

    // Add additional instructions based on POV and response style
    let styleInstructions = '';
    
    // POV instructions
    switch (current.pov) {
        case 'first':
            styleInstructions += 'Write in first person perspective using "I". ';
            break;
        case 'second':
            styleInstructions += 'Write in second person perspective using "You". ';
            break;
        case 'third':
            styleInstructions += `Write in third person perspective using "{{user}}" or appropriate pronouns. `;
            break;
    }
    
    // Response style instructions
    switch (current.responseStyle) {
        case 'short':
            styleInstructions += 'Keep responses brief and concise (1-2 sentences). ';
            break;
        case 'medium':
            styleInstructions += 'Provide moderate length responses. ';
            break;
        case 'long':
            styleInstructions += 'Provide detailed, expressive responses with internal thoughts. ';
            break;
        case 'adaptive':
            styleInstructions += 'Match the length and style of previous {{user}} messages in the conversation. ';
            break;
    }
    
    // Add custom instructions
    if (current.instruction) {
        styleInstructions += substituteParamsExtended(current.instruction);
    }
    
    if (styleInstructions) {
        systemPrompt += `\n\n### Style Instructions:\n${styleInstructions}`;
    }

    // Build context from recent messages
    const contextSize = Math.min(current.contextSize, chat.length);
    const recentMessages = chat.slice(-contextSize);
    
    const contextMessages = recentMessages
        .filter(msg => !msg.is_system && msg.mes)
        .map(msg => `${msg.name}: ${msg.mes}`)
        .join('\n\n');

    const userPrompt = `### Recent Conversation:\n\n${contextMessages}\n\n${context.name1}:`;

    log('Built impersonation prompt with', contextSize, 'messages, POV:', current.pov, 'Style:', current.responseStyle);
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

function saveCurrentToPreset() {
    const presetName = settings.activePreset;
    
    settings.currentSettings = {
        name: presetName,
        systemPrompt: $('#impersonator_system_prompt').val(),
        contextSize: Number($('#impersonator_context_size').val()),
        maxTokens: Number($('#impersonator_max_tokens').val()),
        instruction: $('#impersonator_instruction').val(),
        includeCharCard: $('#impersonator_include_char_card').prop('checked'),
        includePersona: $('#impersonator_include_persona').prop('checked'),
        pov: $('#impersonator_pov').val() || 'first',
        responseStyle: $('#impersonator_response_style').val() || 'medium',
    };
    
    settings.presets[presetName] = { ...settings.currentSettings };
    saveSettingsDebounced();
    toastr.success(`Saved to preset "${presetName}"`, 'Impersonator');
    log('Saved preset:', presetName);
}

function loadPreset(presetName) {
    if (!settings.presets[presetName]) {
        toastr.error('Preset not found', 'Impersonator');
        return;
    }
    
    settings.activePreset = presetName;
    settings.currentSettings = { ...settings.presets[presetName] };
    loadCurrentPreset();
    saveSettingsDebounced();
    log('Loaded preset:', presetName);
}

function createNewPreset() {
    const name = prompt('Enter preset name:');
    if (!name) return;
    
    if (settings.presets[name]) {
        toastr.error('Preset already exists', 'Impersonator');
        return;
    }
    
    settings.presets[name] = {
        name: name,
        systemPrompt: $('#impersonator_system_prompt').val() || defaultPreset.systemPrompt,
        contextSize: Number($('#impersonator_context_size').val()) || 10,
        maxTokens: Number($('#impersonator_max_tokens').val()) || 200,
        instruction: $('#impersonator_instruction').val() || '',
        includeCharCard: $('#impersonator_include_char_card').prop('checked'),
        includePersona: $('#impersonator_include_persona').prop('checked'),
        pov: $('#impersonator_pov').val() || 'first',
        responseStyle: $('#impersonator_response_style').val() || 'medium',
    };
    
    settings.activePreset = name;
    settings.currentSettings = { ...settings.presets[name] };
    loadPresetList();
    saveSettingsDebounced();
    toastr.success(`Created preset "${name}"`, 'Impersonator');
    log('Created preset:', name);
}

function deletePreset() {
    const presetName = settings.activePreset;
    
    if (Object.keys(builtInPresets).includes(presetName)) {
        toastr.error('Cannot delete built-in preset', 'Impersonator');
        return;
    }
    
    if (!confirm(`Delete preset "${presetName}"?`)) return;
    
    delete settings.presets[presetName];
    settings.activePreset = 'Default';
    settings.currentSettings = { ...settings.presets['Default'] };
    loadPresetList();
    loadCurrentPreset();
    saveSettingsDebounced();
    toastr.success(`Deleted preset "${presetName}"`, 'Impersonator');
    log('Deleted preset:', presetName);
}

function exportPreset() {
    const presetName = settings.activePreset;
    const preset = settings.presets[presetName];
    
    if (!preset) {
        toastr.error('No preset selected', 'Impersonator');
        return;
    }
    
    const exportData = {
        version: '1.0',
        preset: preset,
        timestamp: new Date().toISOString(),
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const filename = `impersonator-${presetName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`;
    download(dataStr, filename, 'application/json');
    
    toastr.success('Preset exported', 'Impersonator');
    log('Exported preset:', presetName);
}

function importPreset() {
    $('#impersonator-preset-importFile').trigger('click');
}

function handlePresetImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            if (!data.preset || !data.preset.name) {
                throw new Error('Invalid preset file');
            }
            
            const preset = data.preset;
            let presetName = preset.name;
            
            // Handle name conflicts
            if (settings.presets[presetName]) {
                const newName = prompt(`Preset "${presetName}" already exists. Enter a new name:`, presetName + ' (imported)');
                if (!newName) return;
                presetName = newName;
                preset.name = presetName;
            }
            
            settings.presets[presetName] = preset;
            settings.activePreset = presetName;
            settings.currentSettings = { ...preset };
            loadPresetList();
            loadCurrentPreset();
            saveSettingsDebounced();
            
            toastr.success(`Imported preset "${presetName}"`, 'Impersonator');
            log('Imported preset:', presetName);
        } catch (err) {
            error('Import failed:', err);
            toastr.error(`Failed to import preset: ${err.message}`, 'Impersonator');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
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

// Create impersonate button next to send
function createImpersonateButton() {
    // SVG icon for impersonate
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
        <path d="M15 9h6v2h-6z"/>
    </svg>`;
    
    const button = $(`
        <div id="impersonateButton" class="fa-solid" title="Impersonate (Custom)" style="cursor: pointer;">
            ${svg}
        </div>
    `);
    
    button.on('click', async function() {
        if (!settings.enabled) {
            toastr.warning('Impersonator is disabled', 'Impersonator');
            return;
        }
        
        const result = await doImpersonate();
        if (result) {
            // Insert into input field
            const textarea = $('#send_textarea');
            textarea.val(result);
            textarea.trigger('input');
        }
    });
    
    // Insert before the send button
    $('#send_but_sheld').prepend(button);
    updateImpersonateButton();
}

jQuery(async function () {
    const settingsHtml = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    $('#extensions_settings2').append(settingsHtml);

    loadSettings();
    
    // Initialize UI after settings are loaded
    $('#impersonator_enabled').prop('checked', settings.enabled);
    loadPresetList();
    loadCurrentPreset();
    updateConfigVisibility();
    
    createImpersonateButton();

    // Event handlers
    $('#impersonator_enabled').on('change', function () {
        settings.enabled = $(this).prop('checked');
        updateConfigVisibility();
        saveSettingsDebounced();
        log('Enabled:', settings.enabled);
    });

    // Preset management
    $('#impersonator-preset-list').on('change', function() {
        loadPreset($(this).val());
    });
    
    $('#impersonator-preset-new').on('click', createNewPreset);
    $('#impersonator-preset-delete').on('click', deletePreset);
    $('#impersonator-preset-export').on('click', exportPreset);
    $('#impersonator-preset-import').on('click', importPreset);
    $('#impersonator-preset-importFile').on('change', handlePresetImport);
    $('#impersonator_save_preset').on('click', saveCurrentToPreset);

    // Settings inputs
    $('#impersonator_system_prompt').on('input', function () {
        settings.currentSettings.systemPrompt = $(this).val();
    });

    $('#impersonator_context_size').on('input', function () {
        const value = $(this).val();
        settings.currentSettings.contextSize = Number(value);
        $('#impersonator_context_size_value').text(value);
    });

    $('#impersonator_max_tokens').on('input', function () {
        const value = $(this).val();
        settings.currentSettings.maxTokens = Number(value);
        $('#impersonator_max_tokens_value').text(value);
    });

    $('#impersonator_instruction').on('input', function () {
        settings.currentSettings.instruction = $(this).val();
    });

    $('#impersonator_include_char_card').on('change', function () {
        settings.currentSettings.includeCharCard = $(this).prop('checked');
    });

    $('#impersonator_include_persona').on('change', function () {
        settings.currentSettings.includePersona = $(this).prop('checked');
    });

    $('#impersonator_pov').on('change', function () {
        settings.currentSettings.pov = $(this).val();
    });

    $('#impersonator_response_style').on('change', function () {
        settings.currentSettings.responseStyle = $(this).val();
    });

    $('#impersonator_test').on('click', testImpersonation);

    // Register slash command
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'personator',
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
