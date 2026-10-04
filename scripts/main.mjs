import {
  MODULE_ID, defineStealthToken, forgetCombat, queueRefresh, redrawAll, refreshNameplates,
} from './disguise.mjs';
import { injectTokenConfig } from './token-config.mjs';

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'attribute', {
    name: 'DLSTEALTH.Settings.Attribute.Name',
    hint: 'DLSTEALTH.Settings.Attribute.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: 'Заметность',
    onChange: queueRefresh,
  });
  game.settings.register(MODULE_ID, 'cellsPerPoint', {
    name: 'DLSTEALTH.Settings.CellsPerPoint.Name',
    hint: 'DLSTEALTH.Settings.CellsPerPoint.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 1,
    onChange: queueRefresh,
  });
  game.settings.register(MODULE_ID, 'memorySeconds', {
    name: 'DLSTEALTH.Settings.MemorySeconds.Name',
    hint: 'DLSTEALTH.Settings.MemorySeconds.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 30,
    onChange: queueRefresh,
  });
  game.settings.register(MODULE_ID, 'fadeDuration', {
    name: 'DLSTEALTH.Settings.FadeDuration.Name',
    hint: 'DLSTEALTH.Settings.FadeDuration.Hint',
    scope: 'world',
    config: true,
    type: Number,
    range: { min: 0, max: 3000, step: 100 },
    default: 600,
  });
  game.settings.register(MODULE_ID, 'defaultImage', {
    name: 'DLSTEALTH.Settings.DefaultImage.Name',
    hint: 'DLSTEALTH.Settings.DefaultImage.Hint',
    scope: 'world',
    config: true,
    type: String,
    filePicker: 'imagevideo',
    default: CONST.DEFAULT_TOKEN,
    onChange: redrawAll,
  });
  game.settings.register(MODULE_ID, 'defaultName', {
    name: 'DLSTEALTH.Settings.DefaultName.Name',
    hint: 'DLSTEALTH.Settings.DefaultName.Hint',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    onChange: refreshNameplates,
  });
  game.settings.register(MODULE_ID, 'gmPreview', {
    name: 'DLSTEALTH.Settings.GMPreview.Name',
    hint: 'DLSTEALTH.Settings.GMPreview.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    onChange: queueRefresh,
  });
});

// After every init hook, so a Token class another module set up there ends up
// underneath this one rather than replacing it.
Hooks.once('setup', () => {
  CONFIG.Token.objectClass = defineStealthToken(CONFIG.Token.objectClass);
});

Hooks.on('canvasReady', queueRefresh);
Hooks.on('controlToken', queueRefresh);
Hooks.on('destroyToken', queueRefresh);
// Заметность or ownership changed.
Hooks.on('updateActor', queueRefresh);
// What this client can see changed: a door, a light, a token's vision.
Hooks.on('sightRefresh', queueRefresh);

// Fires on every frame of a move, so the disguise drops the moment a token
// steps into range rather than when it stops.
Hooks.on('refreshToken', (token, flags) => {
  if (flags.refreshPosition || flags.refreshSize) queueRefresh();
});

Hooks.on('updateToken', (document, changes) => {
  // A new disguise picture has to be loaded, which only a redraw does.
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.img`)) document.object?.renderFlags.set({ redraw: true });
  else if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.name`)) {
    document.object?.renderFlags.set({ refreshNameplate: true });
  }
  queueRefresh();
});

// A fight starting or ending changes who is remembered.
Hooks.on('updateCombat', queueRefresh);
Hooks.on('deleteCombat', (combat) => {
  queueRefresh();
  forgetCombat(combat);
});

Hooks.on('renderTokenConfig', injectTokenConfig);
Hooks.on('renderPrototypeTokenConfig', injectTokenConfig);
