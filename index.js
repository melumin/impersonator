import { saveSettingsDebounced, substituteParamsExtended, generateRaw, eventSource, event_types, name2 } from '../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../extensions.js';
import { SlashCommandParser } from '../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../slash-commands/SlashCommandArgument.js';
import { isTrueBoolean, download } from '../utils.js';

const MODULE_NAME = 'impersonator';
const DEBUG = true;

const log = (...args) => DEBUG && console.log('[Impersonator]', ...args);
const warn = (...args) => console.warn('[Impersonator]', ...args);
const error = (...args) => console.error('[Impersonator]', ...args);

const defaultPreset = {
    name: 'Comprehensive',
    systemPrompt: `## TASK OVERVIEW
You are assisting a user who is roleplaying as {{user}} in an interactive narrative. The user wants you to write their next message from {{user}}'s perspective. This is a creative writing exercise where you embody {{user}}'s character completely.

## YOUR ROLE
You are NOT playing {{char}} or any other character. You are writing AS {{user}}, channeling their voice, personality, and perspective. Think of yourself as {{user}}'s creative writing partner - you're helping them express what their character would say, think, and do in this moment.

## CONTEXT PROVIDED
The user may provide a note or idea about what they want the message to convey: {{input}}

This is guidance about the direction, theme, or content they want in the response. Use it as inspiration and context, but transform it into natural, in-character writing. Don't copy it literally - interpret it through {{user}}'s personality and the current situation.

## CRITICAL REQUIREMENTS
1. **Character Consistency**: Stay true to {{user}}'s established personality, speech patterns, mannerisms, and behavioral traits
2. **Single Response Only**: Generate ONLY {{user}}'s next message - do not continue the conversation or write for {{char}}
3. **Contextual Awareness**: React appropriately to what {{char}} just said or did in their most recent message
4. **Narrative Continuity**: Maintain the flow and tone established in previous {{user}} messages
5. **No Meta-Commentary**: Stay in character - no breaking the fourth wall or explaining your choices
6. **Respect Boundaries**: Never control, narrate, or speak for {{char}} or other characters

## WRITING STYLE PARAMETERS
- **Point of View**: {{pov}}
- **Response Length**: {{length}}

## CREATIVE WRITING GUIDELINES
- **Avoid Clichés**: Write fresh, authentic responses that feel real rather than formulaic
- **Show, Don't Tell**: Use specific actions, dialogue, and sensory details rather than abstract descriptions
- **Internal Life**: Include {{user}}'s thoughts, feelings, and reactions when relevant to deepen characterization
- **Natural Dialogue**: Write conversation that sounds like how real people talk, with personality and subtext
- **Dynamic Action**: Balance dialogue with physical actions, gestures, and environmental interaction
- **Emotional Authenticity**: Capture genuine emotional responses appropriate to the situation and character
- **Subtext and Nuance**: People rarely say exactly what they mean - layer in complexity when appropriate
- **Pacing**: Match the energy and rhythm of the scene - tense moments feel different from casual ones

## RELATIONSHIP DYNAMICS
Consider the established relationship between {{user}} and {{char}}:
- What is their history and current dynamic?
- What are the power dynamics, emotional connections, or tensions?
- How does {{user}} typically interact with {{char}}?
- What's unsaid between them that influences their interactions?

## FINAL REMINDER
If the user provided context or an idea ({{input}}), use it to guide the message's direction and content. Incorporate the concept naturally into {{user}}'s dialogue, actions, and thoughts - interpret and transform it rather than copying it verbatim.

Now, write {{user}}'s next message.`,
    contextSize: 15,
    maxTokens: 300,
    includeCharCard: false,
    includePersona: true,
    pov: 'first',
    responseStyle: 'medium',
};

const builtInPresets = {
    'Comprehensive': defaultPreset,
};

const defaultSettings = {
    enabled: false,
    activePreset: 'Comprehensive',
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
        settings.activePreset = 'Comprehensive';
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
    $('#impersonator_context_size').val(current.contextSize || 15);
    $('#impersonator_context_size_value').text(current.contextSize || 15);
    $('#impersonator_max_tokens').val(current.maxTokens || 300);
    $('#impersonator_max_tokens_value').text(current.maxTokens || 300);
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

    // Get POV text
    let povText = '';
    switch (current.pov) {
        case 'first':
            povText = 'Write in FIRST PERSON using "I", "me", "my"';
            break;
        case 'second':
            povText = 'Write in SECOND PERSON using "You", "your"';
            break;
        case 'third':
            povText = `Write in THIRD PERSON using "{{user}}" or appropriate pronouns`;
            break;
    }
    
    // Get length text
    let lengthText = '';
    switch (current.responseStyle) {
        case 'short':
            lengthText = 'Keep responses BRIEF (1-3 sentences). Be direct and concise.';
            break;
        case 'medium':
            lengthText = 'Provide MODERATE length responses (2-4 paragraphs). Balance action and dialogue.';
            break;
        case 'long':
            lengthText = 'Provide DETAILED responses (4+ paragraphs). Include internal thoughts, feelings, and rich descriptions.';
            break;
        case 'adaptive':
            lengthText = 'MATCH the length and style of previous {{user}} messages. Adapt to the established conversation pattern.';
            break;
    }

    // Start with the base system prompt and replace custom variables
    let systemPrompt = current.systemPrompt
        .replace(/\{\{pov\}\}/g, povText)
        .replace(/\{\{length\}\}/g, lengthText);
    
    // Add user persona if enabled (BEFORE applying macro substitution so {{persona}} works)
    if (current.includePersona !== false) {
        systemPrompt += `\n\n### {{user}}'s Character Profile:\n{{persona}}`;
        log('Added persona macro to prompt');
    }

    // Add character card if enabled (for context about who they're talking to)
    if (current.includeCharCard === true) {
        systemPrompt += `\n\n### {{char}}'s Character Profile (for context):\n{{description}}`;
        log('Added character description macro to prompt');
    }
    
    // Now apply standard macro substitution to replace all {{macros}}
    systemPrompt = substituteParamsExtended(systemPrompt);

    // Build context from recent messages
    const contextSize = Math.min(current.contextSize, chat.length);
    const recentMessages = chat.slice(-contextSize);
    
    const contextMessages = recentMessages
        .filter(msg => !msg.is_system && msg.mes)
        .map(msg => {
            const speaker = msg.is_user ? (name2 || context.name1 || 'User') : msg.name;
            return `${speaker}: ${msg.mes}`;
        })
        .join('\n\n');

    // Build user prompt - {{input}} will be replaced by SillyTavern with textarea content
    let userPrompt = `### Recent Conversation:\n\n${contextMessages}`;
    
    // Add message idea/note section if there's input
    userPrompt += `\n\n### Message Context/Idea:\nThe following is a note or idea for what the message should convey. Use this as context and inspiration for the response. Incorporate the concept naturally into {{user}}'s dialogue, actions, and thoughts - don't copy it word-for-word, but let it guide the direction and content of the message:\n{{input}}\n\n{{user}}:`;
    
    // Apply macro substitution to user prompt (this will replace {{input}} and {{user}})
    userPrompt = substituteParamsExtended(userPrompt);

    log('Built impersonation prompt - Context:', contextSize, 'messages | POV:', current.pov, '| Style:', current.responseStyle);
    log('Persona included:', current.includePersona, '| Char card included:', current.includeCharCard);
    
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
        log('System prompt:', prompts.systemPrompt.substring(0, 200) + '...');
        log('User prompt:', prompts.userPrompt.substring(0, 200) + '...');
        
        const response = await generateRaw({
            prompt: prompts.userPrompt,
            systemPrompt: prompts.systemPrompt,
            responseLength: settings.currentSettings.maxTokens > 0 ? settings.currentSettings.maxTokens : undefined,
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
        contextSize: Number($('#impersonator_context_size').val()) || 15,
        maxTokens: Number($('#impersonator_max_tokens').val()) || 300,
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
    // Remove existing button if it exists
    $('#impersonateButton').remove();
    
    // Check if the container exists - try multiple possible locations
    let container = $('#rightSendForm');
    if (!container.length) {
        container = $('#send_form');
    }
    if (!container.length) {
        warn('Send form container not found, will retry...');
        setTimeout(createImpersonateButton, 500);
        return;
    }
    
    // SVG icon for impersonate - compact user icon
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>`;
    
    const button = $(`
        <div id="impersonateButton" class="fa-solid fa-user-pen interactable" title="Impersonate (Custom Extension)" tabindex="0" style="cursor: pointer; display: flex; align-items: center; justify-content: center;">
            ${svg}
        </div>
    `);
    
    button.on('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        if (!settings.enabled) {
            toastr.warning('Impersonator is disabled. Enable it in extension settings.', 'Impersonator');
            return;
        }
        
        log('Impersonate button clicked');
        toastr.info('Generating impersonated response...', 'Impersonator');
        
        const result = await doImpersonate();
        
        if (result) {
            log('Got result, length:', result.length);
            log('Result preview:', result.substring(0, 100));
            
            // Insert into input field
            const textarea = $('#send_textarea');
            log('Textarea element found:', textarea.length > 0);
            
            if (textarea.length > 0) {
                textarea.val(result);
                log('Value set, new value length:', textarea.val().length);
                
                // Try multiple ways to trigger update
                textarea.trigger('input');
                textarea.trigger('change');
                textarea[0].dispatchEvent(new Event('input', { bubbles: true }));
                textarea.focus();
                
                toastr.success('Response generated and inserted!', 'Impersonator');
                log('Result inserted into textarea');
            } else {
                error('Textarea not found!');
                toastr.error('Could not find message input box', 'Impersonator');
            }
        } else {
            log('No result returned from doImpersonate');
        }
    });
    
    // Insert into rightSendForm, before the send button
    const sendButton = $('#send_but');
    if (sendButton.length > 0) {
        button.insertBefore(sendButton);
        log('Impersonate button inserted before send button');
    } else {
        container.prepend(button);
        log('Impersonate button prepended to container');
    }
    
    updateImpersonateButton();
    log('Impersonate button created and added to UI');
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
