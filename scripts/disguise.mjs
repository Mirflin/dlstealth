/**
 * The disguise itself.
 *
 * Every token whose actor has a "Заметность" (noticeability) value is drawn on
 * each client either as itself or as its disguise image. A client sees the
 * real token when one of its observer tokens stands within the reveal radius:
 *
 *   radius = Заметность × cells per point × the scene's grid distance
 *
 * It is decided on each client, every time a token moves, so two players can
 * see the same token differently. An observer that has seen the real token
 * keeps recognising it after leaving the radius: for some seconds (kept on
 * the client), or until the end of the fight when it saw it during combat
 * (kept in the observer token's flags, so it survives a reload).
 */

export const MODULE_ID = 'dlstealth';

/**
 * The actor's Заметность as a number, or null when it has none - a token
 * without one is never disguised. The setting names either an attribute of
 * the sheet (`actor.findAttribute`, see the Magicpunk system) or a data path
 * such as `system.stealth.value` for other systems.
 * @param {Actor|null} actor
 * @returns {number|null}
 */
export function noticeOf(actor) {
  if (!actor) return null;
  const name = game.settings.get(MODULE_ID, 'attribute').trim();
  if (!name) return null;
  const attribute = actor.findAttribute?.(name);
  const raw = attribute ? attribute.value : foundry.utils.getProperty(actor, name);
  if ((raw === null) || (raw === undefined) || (String(raw).trim() === '')) return null;
  const notice = Number(raw);
  return Number.isFinite(notice) ? notice : null;
}

/**
 * The tokens this client looks through, the way Foundry picks vision: the
 * controlled ones, or every owned one when none is controlled. null means
 * "see everything as it is" - the GM, unless they asked to preview through
 * the tokens they control.
 * @returns {Token[]|null}
 */
export function getObservers() {
  const controlled = canvas.tokens.controlled;
  if (game.user.isGM) return (controlled.length && game.settings.get(MODULE_ID, 'gmPreview')) ? controlled : null;
  return controlled.length ? controlled : canvas.tokens.placeables.filter((token) => token.isOwner);
}

/**
 * The distance within which the token is recognised, in scene units, or null
 * when it is never disguised.
 * @param {Token} token
 * @returns {number|null}
 */
function revealRadius(token) {
  const notice = noticeOf(token.actor);
  if (notice === null) return null;
  return notice * game.settings.get(MODULE_ID, 'cellsPerPoint') * canvas.grid.distance;
}

/**
 * @param {Token} observer
 * @param {Token} target
 * @param {number} radius   from revealRadius()
 * @returns {boolean}
 */
function inRange(observer, target, radius) {
  return canvas.grid.measurePath([observer.center, target.center]).distance <= radius;
}

/**
 * Can this client see the token right now - not hidden from it by the GM,
 * not behind a wall or in the dark? Foundry's own test (`Token#isVisible`),
 * minus the screen culling: a token off the edge of the screen is still seen.
 * @param {Token} token
 * @returns {boolean}
 */
function isSeen(token) {
  if (token.document.hidden && !game.user.isGM) return false;
  if (!canvas.visibility.tokenVision) return true;
  if (game.user.isGM && !canvas.effects.visionSources.some((source) => source.active)) return true;
  return canvas.visibility.testVisibility(token.document.getVisibilityTestPoints(), { tolerance: 0, object: token });
}

/**
 * The fight under way on this scene, or null.
 * @returns {Combat|null}
 */
function activeCombat() {
  const combat = game.combat;
  return combat?.started ? combat : null;
}

/**
 * When each observer last saw each disguised token, keyed
 * `${observer.id}.${target.id}`: Infinity while it is in sight, then the
 * moment it lost sight of it.
 * @type {Map<string, number>}
 */
const lastSeen = new Map();

/** The pending refresh for when the soonest memory runs out. */
let forgetTimer = null;
let forgetAt = Infinity;

function pairKey(observer, target) {
  return `${observer.id}.${target.id}`;
}

function memoryMs() {
  return Math.max(0, game.settings.get(MODULE_ID, 'memorySeconds')) * 1000;
}

/**
 * Does the observer still remember the target it lost sight of? While it
 * does, a refresh is booked for the moment it forgets.
 * @param {Token} observer
 * @param {Token} target
 * @param {number} now
 * @returns {boolean}
 */
function remembers(observer, target, now) {
  const seen = lastSeen.get(pairKey(observer, target));
  if (seen === undefined) return false;
  const until = seen + memoryMs();
  if (until <= now) return false;
  if ((until !== Infinity) && (until < forgetAt)) {
    clearTimeout(forgetTimer);
    forgetAt = until;
    forgetTimer = setTimeout(() => {
      forgetAt = Infinity;
      queueRefresh();
    }, until - now + 1);
  }
  return true;
}

/**
 * Has the observer seen the target during this fight?
 * @param {Token} observer
 * @param {Token} target
 * @param {Combat|null} combat   from activeCombat()
 * @returns {boolean}
 */
function seenInCombat(observer, target, combat) {
  return !!combat && !!observer.document.getFlag(MODULE_ID, `seen.${combat.id}.${target.id}`);
}

/** Combat sightings being written, so a move doesn't write one on every frame. */
const pendingSightings = new Set();

/**
 * Note in the observer token's flags that it has seen the target in this
 * fight. The observer is always a token this user owns, so they may write it.
 * @param {Token} observer
 * @param {Token} target
 * @param {Combat} combat
 */
function recordCombatSighting(observer, target, combat) {
  const key = `seen.${combat.id}.${target.id}`;
  if (observer.document.getFlag(MODULE_ID, key)) return;
  const pending = `${observer.document.uuid}.${key}`;
  if (pendingSightings.has(pending)) return;
  pendingSightings.add(pending);
  observer.document.setFlag(MODULE_ID, key, true).finally(() => pendingSightings.delete(pending));
}

/**
 * Note which disguised tokens each observer can see from within their radius
 * right now, and when it lost sight of the ones it no longer can.
 * @param {Token[]} observers
 * @param {number} now
 */
function recordSightings(observers, now) {
  const combat = activeCombat();
  const inSight = new Set();
  for (const target of canvas.tokens.placeables) {
    if (!game.user.isGM && target.isOwner) continue;
    const radius = revealRadius(target);
    if (radius === null) continue;
    const near = observers.filter((observer) => (observer !== target) && inRange(observer, target, radius));
    if (!near.length || !isSeen(target)) continue;
    for (const observer of near) {
      inSight.add(pairKey(observer, target));
      if (combat) recordCombatSighting(observer, target, combat);
    }
  }
  for (const [key, seen] of lastSeen) {
    if (inSight.has(key)) continue;
    if (seen === Infinity) lastSeen.set(key, now);
    else if (seen + memoryMs() < now) lastSeen.delete(key);
  }
  for (const key of inSight) lastSeen.set(key, Infinity);
}

/**
 * When a fight ends, the GM wipes what was seen in it from the tokens' flags.
 * @param {Combat} combat
 */
export async function forgetCombat(combat) {
  if (!game.users.activeGM?.isSelf) return;
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .filter((token) => token.getFlag(MODULE_ID, `seen.${combat.id}`))
      .map((token) => ({ _id: token.id, flags: { [MODULE_ID]: { seen: { [combat.id]: _del } } } }));
    if (updates.length) await scene.updateEmbeddedDocuments('Token', updates);
  }
}

/**
 * Should this client see the token under its disguise? Not when one of its
 * observers is within the radius now, saw it in this fight, or lost sight of
 * it only a moment ago.
 * @param {Token} token
 * @param {Token[]|null} observers   from getObservers()
 * @param {number} [now]
 * @returns {boolean}
 */
export function computeDisguised(token, observers, now = Date.now()) {
  if (token.isPreview || !observers || token.controlled) return false;
  if (!game.user.isGM && token.isOwner) return false;
  const radius = revealRadius(token);
  if (radius === null) return false;
  const combat = activeCombat();
  return !observers.some((observer) => (observer !== token) && (inRange(observer, token, radius)
    || seenInCombat(observer, token, combat) || remembers(observer, token, now)));
}

/**
 * The picture shown in place of the token: its own disguise image, else the
 * module's default.
 * @param {TokenDocument} document
 * @returns {string}
 */
export function disguiseImage(document) {
  return document.getFlag(MODULE_ID, 'img') || game.settings.get(MODULE_ID, 'defaultImage') || CONST.DEFAULT_TOKEN;
}

/**
 * The name shown under a disguised token: its own disguise name, else the
 * module's default. Empty hides the nameplate rather than give the real name
 * away.
 * @param {TokenDocument} document
 * @returns {string}
 */
export function disguiseName(document) {
  return document.getFlag(MODULE_ID, 'name') || game.settings.get(MODULE_ID, 'defaultName') || '';
}

let refreshQueued = false;

/**
 * Re-decide every token on the next frame. Movement calls this on each
 * animation frame of every moving token, so the calls are merged into one
 * pass per frame.
 */
export function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    if (!canvas.ready) return;
    const observers = getObservers();
    const now = Date.now();
    if (observers) recordSightings(observers, now);
    for (const token of canvas.tokens.placeables) token.dlstealthEvaluate?.(observers, now);
  });
}

/**
 * Draw every token again - for when the disguise picture itself changed and
 * has to be loaded.
 */
export function redrawAll() {
  for (const token of canvas.tokens?.placeables ?? []) token.renderFlags.set({ redraw: true });
}

/**
 * Re-render every nameplate - for when the default disguise name changed.
 */
export function refreshNameplates() {
  for (const token of canvas.tokens?.placeables ?? []) token.renderFlags.set({ refreshNameplate: true });
}

/**
 * The Token class with the disguise built in, extending whatever class is
 * configured, so another module's Token subclass keeps working underneath.
 *
 * The real texture is never replaced, only the one the mesh shows: the
 * `refreshDisguise` render flag swaps it and then lets `refreshMesh` fit the
 * new picture into the token's square. The swap is a crossfade: for its
 * length a second mesh (the "ghost") shows the old picture over the token,
 * fading out while the token's own mesh fades in.
 * @param {typeof Token} Base
 * @returns {typeof Token}
 */
export function defineStealthToken(Base) {
  const renderFlags = { ...Base.RENDER_FLAGS };
  renderFlags.refreshDisguise = { propagate: ['refreshMesh', 'refreshNameplate'] };
  renderFlags.refresh = { ...renderFlags.refresh, propagate: [...renderFlags.refresh.propagate, 'refreshDisguise'] };

  return class StealthToken extends Base {
    static RENDER_FLAGS = renderFlags;

    /**
     * Is this token shown under its disguise to this client right now?
     * @type {boolean}
     */
    dlstealthDisguised = false;

    /** The texture Foundry drew the token with. */
    #realTexture = null;

    /** The disguise picture. */
    #disguiseTexture = null;

    /**
     * The crossfade under way: the ghost mesh showing the old picture, and
     * how far along it is, 0 to 1.
     * @type {{ghost: PrimarySpriteMesh, progress: number}|null}
     */
    #fade = null;

    /** @override */
    async _draw(options) {
      this.#endFade();
      // Loaded first, so the picture is swapped as soon as Foundry has drawn
      // the token, before its first refresh sizes the mesh.
      this.#disguiseTexture = await foundry.canvas.loadTexture(disguiseImage(this.document), {
        fallback: CONST.DEFAULT_TOKEN,
      });
      await super._draw(options);
      this.#realTexture = this.mesh.texture;
      this.dlstealthDisguised = computeDisguised(this, getObservers());
      this.#applyTexture(false);
      // This token may be an observer of the others.
      queueRefresh();
    }

    /** @override */
    _destroy(options) {
      this.#endFade();
      super._destroy(options);
    }

    /**
     * Re-decide whether this token is disguised; re-render it when that changed.
     * @param {Token[]|null} observers   from getObservers()
     * @param {number} now
     */
    dlstealthEvaluate(observers, now) {
      const disguised = computeDisguised(this, observers, now);
      if (disguised === this.dlstealthDisguised) return;
      this.dlstealthDisguised = disguised;
      this.renderFlags.set({ refreshDisguise: true });
    }

    /** @override */
    _applyRenderFlags(flags) {
      if (flags.refreshDisguise) this.#applyTexture(true);
      super._applyRenderFlags(flags);
      // Foundry has just set the mesh's alpha, position, size...: the fade
      // and the ghost follow in the same frame.
      this.#syncFade();
    }

    /** @override */
    _refreshNameplate() {
      super._refreshNameplate();
      if (this.dlstealthDisguised) this.nameplate.text = disguiseName(this.document);
    }

    /**
     * Show the disguise or the real picture, whichever this client should see.
     * @param {boolean} animate   crossfade rather than swap at once
     */
    #applyTexture(animate) {
      if (!this.mesh || !this.#realTexture) return;
      const texture = (this.dlstealthDisguised && this.#disguiseTexture) || this.#realTexture;
      const from = this.mesh.texture;
      if (from === texture) return;
      this.mesh.texture = texture;
      if (!animate || !(game.settings.get(MODULE_ID, 'fadeDuration') > 0) || !this.mesh.visible) {
        this.#endFade();
        return;
      }
      if (this.#fade) {
        // Turned back halfway: the ghost already shows the picture coming
        // back, so the two swap and the fade runs back from where it is.
        this.#fade.ghost.texture = from;
        this.#fade.progress = 1 - this.#fade.progress;
      } else {
        const ghost = new foundry.canvas.primary.PrimarySpriteMesh({ object: this, texture: from });
        this.#fade = { ghost: canvas.primary.addChild(ghost), progress: 0 };
        canvas.app.ticker.add(this.#onFadeTick, this);
      }
    }

    #onFadeTick() {
      const fade = this.#fade;
      fade.progress = Math.min(1, fade.progress + (canvas.app.ticker.deltaMS / game.settings.get(MODULE_ID, 'fadeDuration')));
      this.#syncFade();
      if (fade.progress >= 1) this.#endFade();
    }

    /** Set both meshes' alpha for the fade, and lay the ghost over the token. */
    #syncFade() {
      const fade = this.#fade;
      if (!fade || !this.mesh) return;
      const { ghost } = fade;
      const mesh = this.mesh;
      const shown = fade.progress * fade.progress * (3 - (2 * fade.progress)); // smoothstep
      const alpha = this.alpha * this.document.alpha; // what Foundry gives the mesh
      mesh.alpha = alpha * shown;
      ghost.alpha = alpha * (1 - shown);
      const { width, height } = this.document.getSize();
      const { fit, scaleX, scaleY } = this.document.texture;
      ghost.resize(width, height, { fit, scaleX, scaleY });
      ghost.position.copyFrom(mesh.position);
      ghost.anchor.copyFrom(mesh.anchor);
      ghost.angle = mesh.angle;
      ghost.elevation = mesh.elevation;
      ghost.sortLayer = mesh.sortLayer;
      ghost.sort = mesh.sort;
      ghost.zIndex = mesh.zIndex;
      ghost.tint = mesh.tint;
      ghost.hidden = mesh.hidden;
      ghost.visible = mesh.visible;
    }

    #endFade() {
      const fade = this.#fade;
      if (!fade) return;
      this.#fade = null;
      canvas.app.ticker.remove(this.#onFadeTick, this);
      // Already gone when the whole canvas is torn down mid-fade.
      if (!fade.ghost.destroyed) fade.ghost.destroy();
      if (this.mesh && !this.mesh.destroyed) this.mesh.alpha = this.alpha * this.document.alpha;
    }
  };
}
