/**
 * CampfirePhysics
 * Lightweight HTML5 Canvas physics engine for the campfire fire area.
 * Handles: sparks, falling items (sticks, whittled figures), pile mechanics,
 * and particle effects with true gravity, bounce, and drag.
 *
 * Uses requestAnimationFrame for smooth 60fps simulation.
 * Renders FontAwesome icons via ctx.fillText() for pile items.
 */

// FontAwesome unicode map for whittled figures and sticks
const FA_UNICODE = {
    "fas fa-dog": "\uf6d3",
    "fas fa-dove": "\uf4ba",
    "fas fa-star": "\uf005",
    "fas fa-shield-alt": "\uf3ed",
    "fas fa-paw": "\uf1b0",
    "fas fa-dragon": "\uf6d5",
    "fas fa-tree": "\uf1bb",
    "fas fa-fish": "\uf578",
    "fas fa-grip-lines-vertical": "\uf7a5",
    "fas fa-fire-alt": "\uf7e4"
};

/** Physics constants */
const GRAVITY = 600;          // px/s²
const DRAG = 0.998;           // per-frame velocity multiplier
const GROUND_BOUNCE = 0.35;   // energy retained on ground bounce
const SETTLE_THRESHOLD = 15;  // px/s below which objects settle
const SPARK_GRAVITY = 200;    // lighter gravity for sparks
const SPARK_DRAG = 0.96;
const ANGULAR_DRAG = 0.998;   // gentle rotation slowdown per frame (visible tumble)
const MAX_ANGULAR_VEL = 8;    // rad/s cap

// Fire zone: items settling here catch fire
const FIRE_ZONE_LEFT = 0.30;  // 30% from left edge
const FIRE_ZONE_RIGHT = 0.70; // 70% from left edge
const FIRE_ZONE_TOP = 0.40;   // 40% from top
const FIRE_SPREAD_DIST = 40;  // px: how close items must be to spread fire
const BURN_DURATION = 2.5;    // seconds an item burns before turning to ash
const BURN_IGNITE_DELAY = 0.5; // seconds before a fire-zone item starts burning
const SPREAD_INTERVAL = 0.3;  // seconds between fire spread checks per burning item

/**
 * @typedef {Object} PhysicsObject
 * @property {string} type - 'spark' | 'item' | 'flash' | 'embers'
 * @property {number} x - position in canvas pixels
 * @property {number} y - position in canvas pixels
 * @property {number} vx - velocity x (px/s)
 * @property {number} vy - velocity y (px/s)
 * @property {string} color - CSS color string
 * @property {number} life - remaining life in seconds
 * @property {number} maxLife - starting life
 * @property {number} size - radius for sparks, font size for items
 * @property {number} rotation - current rotation in radians
 * @property {number} angularVel - rotation speed in rad/s
 * @property {boolean} settled - has come to rest on ground
 * @property {string} [icon] - FontAwesome class for items
 * @property {string} [label] - tooltip label
 * @property {string} [owner] - player who created this
 * @property {Function} [onSettle] - callback when item settles
 */

export class CampfirePhysics {
    /** @type {HTMLCanvasElement} */
    _canvas = null;
    /** @type {CanvasRenderingContext2D} */
    _ctx = null;
    /** @type {PhysicsObject[]} */
    _objects = [];
    /** @type {number|null} */
    _animFrame = null;
    /** @type {number} */
    _lastTime = 0;
    /** @type {number} Ground Y as fraction of canvas height (0-1) */
    _groundLevel = 0.93;
    /** Is the engine running */
    _running = false;
    /** Settled pile items */
    _settledPile = [];
    /** Flash effects */
    _flashes = [];
    /** Callback when an item burns to ash: (item) => void */
    onItemBurned = null;
    /** @type {Map<string, Map<string, OffscreenCanvas>>} icon class -> color -> rendered canvas */
    _iconCache = new Map();
    /** Whether icon font is ready */
    _fontReady = false;

    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this._canvas = canvas;
        this._ctx = canvas.getContext("2d");
        this._resizeCanvas();
        this._running = true;
        this._lastTime = performance.now();
        this._tick = this._tick.bind(this);
        this._animFrame = requestAnimationFrame(this._tick);

        // Pre-render icons once fonts are loaded
        document.fonts.ready.then(() => {
            this._fontReady = true;
            this._iconCache.clear();
        });
    }

    /** Resize canvas to match its CSS dimensions. */
    _resizeCanvas() {
        const rect = this._canvas.getBoundingClientRect();
        this._canvas.width = rect.width * (window.devicePixelRatio || 1);
        this._canvas.height = rect.height * (window.devicePixelRatio || 1);
        this._ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
        this._displayWidth = rect.width;
        this._displayHeight = rect.height;
    }

    /** Ground Y in pixels. */
    get groundY() {
        return this._displayHeight * this._groundLevel;
    }

    // ──────── Public API ────────

    /**
     * Emit sparks radially from a point.
     * @param {number} x - x position (0-1 normalized)
     * @param {number} y - y position (0-1 normalized)
     * @param {string} color - CSS color
     * @param {number} [count=10] - number of sparks
     */
    emitSparks(x, y, color = "#ffcc33", count = 10) {
        const px = x * this._displayWidth;
        const py = y * this._displayHeight;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 80 + Math.random() * 150;
            this._objects.push({
                type: "spark",
                x: px,
                y: py,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 40, // bias upward slightly
                color,
                life: 0.5 + Math.random() * 0.5,
                maxLife: 1.0,
                size: 1.5 + Math.random() * 2,
                rotation: 0,
                angularVel: 0,
                settled: false
            });
        }
    }

    /**
     * Add a colored flash at a point (trinket toss effect).
     * @param {number} x - x position (0-1 normalized)
     * @param {number} y - y position (0-1 normalized)
     * @param {string} color - CSS color
     */
    addFlash(x, y, color) {
        this._flashes.push({
            x: x * this._displayWidth,
            y: y * this._displayHeight,
            color,
            life: 0.6,
            maxLife: 0.6,
            radius: 60 + Math.random() * 30
        });
        // Also emit colored sparks
        this.emitSparks(x, y, color, 8);
    }

    /**
     * Drop an item (stick or whittled figure) with gravity physics.
     * @param {number} x - drop x (0-1 normalized)
     * @param {number} y - drop y (0-1 normalized)
     * @param {string} icon - FontAwesome class
     * @param {string} color - CSS color
     * @param {object} [opts] - {label, owner, onSettle, burstOnSettle}
     */
    addFallingItem(x, y, icon, color, opts = {}) {
        const px = x * this._displayWidth;
        const py = y * this._displayHeight;
        // Spin influenced by drop position: dropping left of center spins CW, right spins CCW
        const centerBias = (x - 0.5) * -6; // how far from center determines spin direction
        const spinVariance = (Math.random() - 0.5) * 4;
        this._objects.push({
            type: "item",
            x: px,
            y: py,
            vx: (Math.random() - 0.5) * 30,
            vy: 10,
            color,
            life: 999,
            maxLife: 999,
            size: 24,
            rotation: (Math.random() - 0.5) * 0.5,
            angularVel: centerBias + spinVariance,
            settled: false,
            icon,
            label: opts.label ?? "",
            owner: opts.owner ?? "",
            onSettle: opts.onSettle ?? null,
            burstOnSettle: opts.burstOnSettle ?? false
        });
    }

    /**
     * Ignite all settled pile items (manual trigger).
     * @returns {number} Number of items ignited
     */
    ignitePile() {
        let count = 0;
        for (const item of this._settledPile) {
            if (!item.burning) {
                item.burning = true;
                item.burnTimer = 0;
                item.spreadTimer = 0;
                count++;
            }
        }
        return count;
    }

    /**
     * Check if a position is inside the fire zone.
     */
    _isInFireZone(x, y) {
        const nx = x / this._displayWidth;
        const ny = y / this._displayHeight;
        return nx >= FIRE_ZONE_LEFT && nx <= FIRE_ZONE_RIGHT && ny >= FIRE_ZONE_TOP;
    }

    /**
     * Emit upward ember particles (ambient background effect).
     * @param {number} [count=3]
     */
    emitEmbers(count = 3) {
        const cx = this._displayWidth * 0.5;
        const cy = this.groundY - 20;

        for (let i = 0; i < count; i++) {
            this._objects.push({
                type: "spark",
                x: cx + (Math.random() - 0.5) * 60,
                y: cy + (Math.random() - 0.5) * 10,
                vx: (Math.random() - 0.5) * 20,
                vy: -(30 + Math.random() * 50),
                color: `hsl(${25 + Math.random() * 20}, 100%, ${50 + Math.random() * 20}%)`,
                life: 1.5 + Math.random() * 1.5,
                maxLife: 3.0,
                size: 1 + Math.random() * 1.5,
                rotation: 0,
                angularVel: 0,
                settled: false
            });
        }
    }

    /** Get the settled pile state (for snapshot/sync). */
    getSettledItems() {
        return this._settledPile.map(item => ({
            x: item.x / this._displayWidth,
            y: item.y / this._displayHeight,
            icon: item.icon,
            color: item.color,
            rotation: item.rotation,
            label: item.label,
            owner: item.owner
        }));
    }

    /** Restore settled items from a snapshot. */
    restoreSettledItems(items) {
        this._settledPile = items.map(item => ({
            type: "item",
            x: item.x * this._displayWidth,
            y: item.y * this._displayHeight,
            vx: 0, vy: 0,
            color: item.color,
            size: 24,
            rotation: item.rotation ?? 0,
            angularVel: 0,
            settled: true,
            icon: item.icon,
            label: item.label ?? "",
            owner: item.owner ?? ""
        }));
    }

    /**
     * Place an item directly into the settled pile (no physics).
     * Used for syncing remote clients to the authoritative position.
     * @param {number} x - normalized x (0-1)
     * @param {number} y - normalized y (0-1)
     * @param {string} icon - FA icon class
     * @param {string} color - CSS color
     * @param {object} [opts] - {label, owner, rotation}
     */
    placeSettledItem(x, y, icon, color, opts = {}) {
        const item = {
            type: "item",
            x: x * this._displayWidth,
            y: y * this._displayHeight,
            vx: 0, vy: 0,
            color,
            life: 999, maxLife: 999,
            size: 24,
            rotation: opts.rotation ?? 0,
            angularVel: 0,
            settled: true,
            icon,
            label: opts.label ?? "",
            owner: opts.owner ?? ""
        };

        this._settledPile.push(item);

        // Fire zone check
        if (this._isInFireZone(item.x, item.y)) {
            item.igniteDelay = BURN_IGNITE_DELAY;
        }

        // Catch fire if adjacent to burning item
        for (const neighbor of this._settledPile) {
            if (!neighbor.burning || neighbor === item) continue;
            const dx = item.x - neighbor.x;
            const dy = item.y - neighbor.y;
            if (Math.sqrt(dx * dx + dy * dy) < FIRE_SPREAD_DIST) {
                item.burning = true;
                item.burnTimer = 0;
                item.spreadTimer = 0;
                break;
            }
        }
    }

    /** Number of settled pile items. */
    get pileCount() {
        return this._settledPile.length;
    }

    // ──────── Physics Loop ────────

    _tick(now) {
        if (!this._running) return;

        const dt = Math.min((now - this._lastTime) / 1000, 0.05); // cap delta
        this._lastTime = now;

        this._update(dt);
        this._render();

        this._animFrame = requestAnimationFrame(this._tick);
    }

    _update(dt) {
        const groundY = this.groundY;
        const ITEM_RADIUS = 10; // collision radius for items

        // Update flashes
        for (let i = this._flashes.length - 1; i >= 0; i--) {
            this._flashes[i].life -= dt;
            if (this._flashes[i].life <= 0) this._flashes.splice(i, 1);
        }

        // Update physics objects
        for (let i = this._objects.length - 1; i >= 0; i--) {
            const obj = this._objects[i];

            // Decrease life
            obj.life -= dt;
            if (obj.life <= 0) {
                this._objects.splice(i, 1);
                continue;
            }

            if (obj.settled) continue;

            // Apply gravity
            const grav = obj.type === "spark" ? SPARK_GRAVITY : GRAVITY;
            obj.vy += grav * dt;

            // Apply drag
            const drag = obj.type === "spark" ? SPARK_DRAG : DRAG;
            obj.vx *= drag;
            obj.vy *= drag;

            // Integrate position
            obj.x += obj.vx * dt;
            obj.y += obj.vy * dt;

            // Rotation - no drag in flight, strong drag when slow/trapped
            const speed = Math.sqrt(obj.vx * obj.vx + obj.vy * obj.vy);
            if (speed < 40) obj.angularVel *= 0.92;
            if (Math.abs(obj.angularVel) > MAX_ANGULAR_VEL) obj.angularVel = Math.sign(obj.angularVel) * MAX_ANGULAR_VEL;
            obj.rotation += obj.angularVel * dt;

            // ── Item-to-item collision ──
            if (obj.type === "item") {
                // Collide with settled pile items
                for (const pile of this._settledPile) {
                    this._resolveItemCollision(obj, pile, ITEM_RADIUS, true);
                }
                // Collide with other in-flight items
                for (let j = 0; j < this._objects.length; j++) {
                    if (j === i) continue;
                    const other = this._objects[j];
                    if (other.type !== "item") continue;
                    this._resolveItemCollision(obj, other, ITEM_RADIUS, false);
                }

                // Track slow time: settle even if not on ground (resting on pile)
                if (speed < 30) {
                    obj._slowTime = (obj._slowTime || 0) + dt;
                } else {
                    obj._slowTime = 0;
                }
                if (obj._slowTime > 0.4) {
                    this._settleItem(obj, i);
                    continue;
                }
            }

            // Ground collision
            if (obj.y >= groundY) {
                obj.y = groundY;
                obj.vy *= -GROUND_BOUNCE;

                // Friction on bounce
                obj.vx *= 0.7;
                obj.angularVel *= 0.5;

                // Check if settled
                if (obj.type === "item" && Math.abs(obj.vy) < SETTLE_THRESHOLD) {
                    this._settleItem(obj, i);
                    continue;
                }

                // Sparks die on ground
                if (obj.type === "spark") {
                    obj.life = Math.min(obj.life, 0.1);
                }
            }

            // Wall boundaries (bleed slightly off-screen so items don't pile at visible edges)
            const wallBleed = 15;
            if (obj.x < -wallBleed) { obj.x = -wallBleed; obj.vx *= -0.5; }
            if (obj.x > this._displayWidth + wallBleed) { obj.x = this._displayWidth + wallBleed; obj.vx *= -0.5; }
            if (obj.y < -wallBleed) { obj.y = -wallBleed; obj.vy *= -0.3; }
        }

        // ── Update burning items in the pile ──
        this._updateBurning(dt);
    }

    /** Update burning lifecycle for settled pile items. */
    _updateBurning(dt) {
        for (let i = this._settledPile.length - 1; i >= 0; i--) {
            const item = this._settledPile[i];

            // Ignition delay countdown for fire-zone items
            if (item.igniteDelay !== undefined && item.igniteDelay > 0 && !item.burning) {
                item.igniteDelay -= dt;
                if (item.igniteDelay <= 0) {
                    item.burning = true;
                    item.burnTimer = 0;
                    item.spreadTimer = 0;
                }
                continue;
            }

            if (!item.burning) continue;

            item.burnTimer += dt;
            item.spreadTimer += dt;

            // Emit sparks while burning
            if (Math.random() < dt * 4) {
                const nx = item.x / this._displayWidth;
                const ny = item.y / this._displayHeight;
                this.emitSparks(nx, ny, item.color, 2);
            }

            // Spread fire to adjacent items
            if (item.spreadTimer >= SPREAD_INTERVAL) {
                item.spreadTimer = 0;
                for (const neighbor of this._settledPile) {
                    if (neighbor.burning || neighbor === item) continue;
                    const dx = item.x - neighbor.x;
                    const dy = item.y - neighbor.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < FIRE_SPREAD_DIST) {
                        neighbor.burning = true;
                        neighbor.burnTimer = 0;
                        neighbor.spreadTimer = 0;
                    }
                }
            }

            // Burn to ash
            if (item.burnTimer >= BURN_DURATION) {
                // Final burst
                const nx = item.x / this._displayWidth;
                const ny = item.y / this._displayHeight;
                this.emitSparks(nx, ny, "#ff6622", 6);
                this.addFlash(nx, ny, item.color);

                // Callback
                if (this.onItemBurned) this.onItemBurned(item);

                this._settledPile.splice(i, 1);
            }
        }
    }

    /**
     * Resolve collision between two items using circle-circle response.
     * @param {PhysicsObject} a - the moving item
     * @param {PhysicsObject} b - the other item (may be settled)
     * @param {number} radius - collision radius
     * @param {boolean} bIsStatic - if true, b doesn't move (settled pile item)
     */
    _resolveItemCollision(a, b, radius, bIsStatic) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const minDist = radius * 2;
        const distSq = dx * dx + dy * dy;

        if (distSq >= minDist * minDist || distSq === 0) return;

        const dist = Math.sqrt(distSq);
        const nx = dx / dist; // collision normal
        const ny = dy / dist;
        const overlap = minDist - dist;

        if (bIsStatic) {
            // Push a out entirely, bounce velocity
            a.x += nx * overlap;
            a.y += ny * overlap;

            // Reflect velocity along collision normal
            const dot = a.vx * nx + a.vy * ny;
            if (dot < 0) { // only if moving toward b
                a.vx -= 1.5 * dot * nx;
                a.vy -= 1.5 * dot * ny;
                a.vx *= 0.7; // energy loss
                a.vy *= 0.7;
                // Only add spin if actually moving fast (not vibrating in place)
                const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
                if (speed > 50) a.angularVel += (Math.random() - 0.5) * 2;
            }
        } else {
            // Both move: split separation and exchange velocity
            a.x += nx * overlap * 0.5;
            a.y += ny * overlap * 0.5;
            b.x -= nx * overlap * 0.5;
            b.y -= ny * overlap * 0.5;

            // Velocity exchange along normal
            const relVx = a.vx - b.vx;
            const relVy = a.vy - b.vy;
            const relDot = relVx * nx + relVy * ny;
            if (relDot < 0) {
                a.vx -= relDot * nx * 0.7;
                a.vy -= relDot * ny * 0.7;
                b.vx += relDot * nx * 0.7;
                b.vy += relDot * ny * 0.7;
            }
        }
    }

    /** Settle an in-flight item into the pile. */
    _settleItem(obj, index) {
        obj.settled = true;
        obj.vy = 0;
        obj.vx = 0;
        obj.angularVel = 0;

        // Nudge away from overlapping pile items
        this._nudgeFromPile(obj);

        // Move to settled pile
        this._settledPile.push(obj);
        this._objects.splice(index, 1);

        // Check if settled in or near fire zone
        if (this._isInFireZone(obj.x, obj.y)) {
            obj.igniteDelay = BURN_IGNITE_DELAY;
        }

        // Also catch fire if adjacent to something already burning
        for (const neighbor of this._settledPile) {
            if (!neighbor.burning || neighbor === obj) continue;
            const dx = obj.x - neighbor.x;
            const dy = obj.y - neighbor.y;
            if (Math.sqrt(dx * dx + dy * dy) < FIRE_SPREAD_DIST) {
                obj.burning = true;
                obj.burnTimer = 0;
                obj.spreadTimer = 0;
                break;
            }
        }

        // Burst on settle (sticks)
        if (obj.burstOnSettle) {
            const nx = obj.x / this._displayWidth;
            const ny = obj.y / this._displayHeight;
            this.emitSparks(nx, ny, "#ffaa33", 8);
        }

        // Callback
        if (obj.onSettle) obj.onSettle(obj);
    }

    /** Nudge a settling item away from existing pile items. */
    _nudgeFromPile(obj) {
        const minDist = 22;
        for (let attempt = 0; attempt < 8; attempt++) {
            let nudged = false;
            for (const existing of this._settledPile) {
                const dx = obj.x - existing.x;
                const dy = obj.y - existing.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist && dist > 0) {
                    const angle = Math.atan2(dy, dx);
                    const push = minDist - dist + 2;
                    obj.x += Math.cos(angle) * push;
                    obj.y = Math.min(obj.y, this.groundY); // keep on ground
                    nudged = true;
                    break;
                }
            }
            if (!nudged) break;
        }
        // Keep in bounds
        obj.x = Math.max(12, Math.min(this._displayWidth - 12, obj.x));
    }

    // ──────── Rendering ────────

    _render() {
        const ctx = this._ctx;
        const w = this._displayWidth;
        const h = this._displayHeight;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Render flashes
        for (const flash of this._flashes) {
            const alpha = (flash.life / flash.maxLife) * 0.5;
            const grad = ctx.createRadialGradient(
                flash.x, flash.y, 0,
                flash.x, flash.y, flash.radius
            );
            grad.addColorStop(0, this._colorWithAlpha(flash.color, alpha));
            grad.addColorStop(1, "transparent");
            ctx.fillStyle = grad;
            ctx.fillRect(flash.x - flash.radius, flash.y - flash.radius,
                         flash.radius * 2, flash.radius * 2);
        }

        // Render sparks
        for (const obj of this._objects) {
            if (obj.type === "spark") {
                const alpha = Math.max(0, obj.life / obj.maxLife);
                ctx.globalAlpha = alpha;
                ctx.fillStyle = obj.color;
                ctx.shadowColor = obj.color;
                ctx.shadowBlur = 4;
                ctx.beginPath();
                ctx.arc(obj.x, obj.y, obj.size * alpha, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1;
            }
        }

        // Render settled pile items
        for (const item of this._settledPile) {
            this._renderIcon(ctx, item);
        }

        // Render in-flight items (on top)
        for (const obj of this._objects) {
            if (obj.type === "item") {
                this._renderIcon(ctx, obj);
            }
        }
    }

    /** Render a physics item icon using cached pre-rendered images. */
    _renderIcon(ctx, obj) {
        if (!obj.icon || !this._fontReady) return;

        // Determine color and size
        let renderSize = obj.size;
        let alpha = 1;
        let color = obj.color;

        if (obj.burning && obj.burnTimer !== undefined) {
            const burnProgress = Math.min(obj.burnTimer / BURN_DURATION, 1);
            renderSize = obj.size * (1 - burnProgress * 0.6);
            alpha = 1 - burnProgress * 0.7;
            color = this._burnColor(obj.color, obj.burnTimer);
        }

        // Get or create cached icon for this class+color combo
        const cached = this._getCachedIcon(obj.icon, color, obj.size);
        if (!cached) return;

        ctx.save();
        ctx.translate(obj.x, obj.y);
        ctx.rotate(obj.rotation);
        ctx.globalAlpha = alpha;

        // Burning glow
        if (obj.burning && obj.burnTimer !== undefined) {
            const flicker = 6 + Math.sin(obj.burnTimer * 15) * 4;
            ctx.shadowColor = `rgba(255, ${100 + Math.random() * 50|0}, 0, 0.8)`;
            ctx.shadowBlur = flicker;
        } else {
            ctx.shadowColor = "rgba(0,0,0,0.6)";
            ctx.shadowBlur = 4;
        }

        const scale = renderSize / obj.size;
        const drawSize = cached.width * scale;
        ctx.drawImage(cached, -drawSize / 2, -drawSize / 2, drawSize, drawSize);

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    /** Get or create a cached icon rendering by probing the DOM for the actual FA glyph. */
    _getCachedIcon(iconClass, color, size) {
        const key = `${iconClass}|${color}`;
        if (this._iconCache.has(key)) return this._iconCache.get(key);

        // Probe the DOM: create a temporary FA element, read its computed glyph + font
        const probe = document.createElement("i");
        probe.className = iconClass;
        probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;font-size:16px;";
        document.body.appendChild(probe);

        const computed = window.getComputedStyle(probe, "::before");
        const content = computed.content;  // e.g. '"\\f6d3"' or '"\uf6d3"'
        const fontFamily = computed.fontFamily;
        const fontWeight = computed.fontWeight || "900";
        document.body.removeChild(probe);

        // Extract the actual character from the content property
        // content comes as '"X"' where X is the unicode char
        let glyph = null;
        if (content && content !== "none" && content !== "normal" && content.length >= 3) {
            glyph = content.replace(/['"]/g, "");
        }
        if (!glyph) return null;

        // Render to offscreen canvas
        const padding = 8;
        const canvasSize = size + padding * 2;
        const offscreen = document.createElement("canvas");
        offscreen.width = canvasSize;
        offscreen.height = canvasSize;
        const octx = offscreen.getContext("2d");

        octx.font = `${fontWeight} ${size}px ${fontFamily}`;
        octx.fillStyle = color;
        octx.textAlign = "center";
        octx.textBaseline = "middle";
        octx.fillText(glyph, canvasSize / 2, canvasSize / 2);

        this._iconCache.set(key, offscreen);
        return offscreen;
    }

    /** Blend item color toward char black as it burns. */
    _burnColor(color, burnTimer) {
        const progress = Math.min(burnTimer / BURN_DURATION, 1);
        if (!color.startsWith("#") || color.length < 7) return color;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        // Blend toward orange then to dark char
        const tr = Math.round(r + (180 - r) * Math.min(progress * 2, 1) * (1 - progress));
        const tg = Math.round(g * (1 - progress * 0.8));
        const tb = Math.round(b * (1 - progress * 0.9));
        return `rgb(${tr},${tg},${tb})`;
    }

    /** Convert a CSS color to rgba with alpha. */
    _colorWithAlpha(color, alpha) {
        // Simple hex to rgba
        if (color.startsWith("#")) {
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            return `rgba(${r},${g},${b},${alpha})`;
        }
        return color;
    }

    // ──────── Lifecycle ────────

    /** Stop the physics loop and clean up. */
    destroy() {
        this._running = false;
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
        this._objects = [];
        this._settledPile = [];
        this._flashes = [];
    }
}
