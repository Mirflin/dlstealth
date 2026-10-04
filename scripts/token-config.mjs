import { MODULE_ID } from './disguise.mjs';

/**
 * Add the disguise fields to the Appearance tab of a token's configuration,
 * both a placed token's and an actor's prototype token. They are named
 * `flags.dlstealth.*`, so the sheet saves them with the rest of the form.
 * @param {TokenConfig|PrototypeTokenConfig} app
 * @param {HTMLElement} element
 */
export function injectTokenConfig(app, element) {
  const anchor = element.querySelector('.tab[data-tab="appearance"] .token-image-group');
  if (!anchor || element.querySelector('.dlstealth-config')) return;
  const flags = app.token?.flags?.[MODULE_ID] ?? {};
  const { createFormGroup, createTextInput } = foundry.applications.fields;

  const image = foundry.applications.elements.HTMLFilePickerElement.create({
    name: `flags.${MODULE_ID}.img`,
    type: 'imagevideo',
    value: flags.img ?? '',
    placeholder: game.settings.get(MODULE_ID, 'defaultImage'),
  });
  const name = createTextInput({
    name: `flags.${MODULE_ID}.name`,
    value: flags.name ?? '',
    placeholder: game.settings.get(MODULE_ID, 'defaultName'),
  });

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'dlstealth-config';
  const legend = document.createElement('legend');
  legend.textContent = game.i18n.localize('DLSTEALTH.Config.Legend');
  fieldset.append(
    legend,
    createFormGroup({
      label: 'DLSTEALTH.Config.Image', hint: 'DLSTEALTH.Config.ImageHint', input: image, localize: true, rootId: app.id,
    }),
    createFormGroup({
      label: 'DLSTEALTH.Config.Name', hint: 'DLSTEALTH.Config.NameHint', input: name, localize: true, rootId: app.id,
    }),
  );
  anchor.after(fieldset);
}
