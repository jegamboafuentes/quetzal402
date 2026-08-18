/* Goal: Create an Aztec-themed Snake game called Quetzal402 using Phaser.js (v3).
* The player controls Quetzalcoatl (the snake) on a 640x480 grid (32x32 pixel tiles).
* The snake eats Jade Stones to grow.
* Every keystroke must be logged to an array so the backend can validate the high score later.
* Use basic geometric shapes (rectangles) for the snake and food for now. */

const NETWORK_STORAGE_KEY = 'quetzal402.network';
const GAME_WIDTH = 640;
const GAME_HEIGHT = 480;
const vaultTotalEl = document.getElementById('vault-total');
const prizeEligibleEl = document.getElementById('prize-eligible');
const statusEl = document.getElementById('status');
const networkSelect = document.getElementById('network-select');
const networkBadge = document.getElementById('network-badge');
const boostBtn = document.getElementById('boost-btn');
const withdrawBtn = document.getElementById('withdraw-btn');
const thunderOverlay = document.getElementById('thunder-overlay');
const overlay = document.getElementById('game-overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMessage = document.getElementById('overlay-message');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const gameWrap = document.getElementById('game-wrap');
const hudScoreEl = document.getElementById('hud-score');
const recordCard = document.getElementById('record-card');

let lastVaultState = {};
let thunderTimer = null;

function getSelectedNetwork() {
    const saved = localStorage.getItem(NETWORK_STORAGE_KEY);
    return saved === 'base' ? 'base' : 'base-sepolia';
}

function persistNetwork(networkId) {
    localStorage.setItem(NETWORK_STORAGE_KEY, networkId);
    if (typeof window.quetzalSetSelectedNetwork === 'function') {
        window.quetzalSetSelectedNetwork(networkId);
    }
}

function explorerAddressUrl(address) {
    const base = getSelectedNetwork() === 'base'
        ? 'https://basescan.org'
        : 'https://sepolia.basescan.org';
    return `${base}/address/${address}`;
}

function readDepositAmount() {
    const parsed = Number(document.getElementById('deposit-amount')?.value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 1;
    }
    return Math.floor(parsed);
}

function applyNetworkTheme(networkId) {
    const isMainnet = networkId === 'base';
    const amount = readDepositAmount();
    document.body.dataset.network = networkId;
    if (networkSelect) {
        networkSelect.value = networkId;
    }
    if (networkBadge) {
        networkBadge.textContent = isMainnet ? 'Mainnet' : 'Testnet';
        networkBadge.className = `network-badge ${isMainnet ? 'mainnet' : 'testnet'}`;
    }
    if (boostBtn) {
        boostBtn.textContent = isMainnet
            ? `Boost Vault (${amount} USDC)`
            : `Boost Vault (${amount} Testnet USDC)`;
    }
}

function formatUsdc(value) {
    const amount = Number(value);
    return `${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'} USDC`;
}

function setVaultTotal(value) {
    const text = formatUsdc(value);
    if (vaultTotalEl) {
        vaultTotalEl.textContent = text;
    }
    if (prizeEligibleEl) {
        prizeEligibleEl.textContent = text;
    }
    document.getElementById('vault-hero')?.classList.toggle('has-funds', Number(value) > 0);
}

function setStatus(message) {
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function setHudScore(score) {
    if (hudScoreEl) {
        hudScoreEl.textContent = String(score);
    }
}

function shortenAddress(address) {
    if (!address) {
        return '—';
    }
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function canWithdrawPrize(data = lastVaultState) {
    const last = data.lastRecord;
    return Boolean(last?.walletAddress) && !last.paid;
}

function scoreToBeat(data = lastVaultState) {
    return Math.max(
        Number(data.currentRecord?.score) || 0,
        Number(data.lastRecord?.score) || 0,
    );
}

function canStartGame(data = lastVaultState) {
    return Number(data.vaultTotal) > 0;
}

const START_LOCKED_MESSAGE = 'Boost the vault with USDC to start the game.';

function setStartUnlocked(unlocked) {
    for (const btn of [startBtn, restartBtn]) {
        if (!btn) {
            continue;
        }
        btn.disabled = !unlocked;
        btn.classList.toggle('locked', !unlocked);
        btn.title = unlocked ? '' : START_LOCKED_MESSAGE;
    }

    const onStartScreen = startBtn && !startBtn.hidden;
    if (onStartScreen && !unlocked) {
        setOverlayMessage(START_LOCKED_MESSAGE, 'warn');
    } else if (onStartScreen && unlocked && overlayMessage?.textContent === START_LOCKED_MESSAGE) {
        clearOverlayMessage();
    }
}

function syncStartButton() {
    setStartUnlocked(canStartGame());
}

function setWithdrawUnlocked(unlocked) {
    if (!withdrawBtn) {
        return;
    }
    withdrawBtn.disabled = !unlocked;
    withdrawBtn.classList.toggle('unlocked', unlocked);
    withdrawBtn.classList.toggle('locked', !unlocked);
    withdrawBtn.title = unlocked
        ? 'Record broken. Withdraw the prize vault.'
        : 'Beat the current record to unlock withdraw';
    recordCard?.classList.toggle('unlocked', unlocked);
}

function playThunder() {
    if (!thunderOverlay) {
        return;
    }
    thunderOverlay.classList.remove('active');
    document.body.classList.remove('thunder-rumble');
    void thunderOverlay.offsetWidth;
    thunderOverlay.classList.add('active');
    document.body.classList.add('thunder-rumble');
    window.clearTimeout(thunderTimer);
    thunderTimer = window.setTimeout(() => {
        thunderOverlay.classList.remove('active');
        document.body.classList.remove('thunder-rumble');
    }, 1200);
}

function applyVaultState(data = {}, { celebrate } = {}) {
    lastVaultState = data;
    if (data.vaultTotal != null) {
        setVaultTotal(data.vaultTotal);
    }

    const currentEl = document.getElementById('current-record');
    const lastEl = document.getElementById('last-record');
    const amountEl = document.getElementById('last-amount');
    const collectorEl = document.getElementById('last-collector');
    const last = data.lastRecord;

    if (currentEl) {
        currentEl.textContent = String(scoreToBeat(data));
    }
    if (lastEl) {
        lastEl.textContent = last ? String(last.score) : '—';
    }
    if (amountEl) {
        amountEl.textContent = last && last.amount != null
            ? formatUsdc(last.amount)
            : '—';
    }
    if (collectorEl) {
        collectorEl.textContent = shortenAddress(last?.walletAddress);
        collectorEl.title = last?.walletAddress || '';
    }

    const vaultAddressEl = document.getElementById('vault-address');
    if (vaultAddressEl) {
        vaultAddressEl.textContent = data.receiver ? shortenAddress(data.receiver) : '—';
        vaultAddressEl.title = data.receiver || '';
        if (data.receiver) {
            vaultAddressEl.href = explorerAddressUrl(data.receiver);
        } else {
            vaultAddressEl.removeAttribute('href');
        }
    }

    const unlocked = canWithdrawPrize(data);
    setWithdrawUnlocked(unlocked);
    syncStartButton();
    if (celebrate && (data.claimed || unlocked)) {
        playThunder();
        setStatus('Record broken! Withdraw Prize is unlocked.');
    }
}

function syncWithdrawButton() {
    setWithdrawUnlocked(canWithdrawPrize(lastVaultState));
}

window.applyVaultState = applyVaultState;
window.syncWithdrawButton = syncWithdrawButton;

async function loadVault() {
    const network = getSelectedNetwork();
    const res = await fetch(`/api/vault?network=${encodeURIComponent(network)}`);
    if (!res.ok) {
        throw new Error('Could not load vault total');
    }
    const data = await res.json();
    applyVaultState(data);
}

window.refreshVault = () => loadVault().catch((err) => setStatus(err.message));

applyNetworkTheme(getSelectedNetwork());
if (networkSelect) {
    networkSelect.addEventListener('change', () => {
        persistNetwork(networkSelect.value);
        applyNetworkTheme(networkSelect.value);
        loadVault().catch((err) => setStatus(err.message));
    });
}
const depositAmountInput = document.getElementById('deposit-amount');
if (depositAmountInput) {
    depositAmountInput.addEventListener('input', () => {
        applyNetworkTheme(getSelectedNetwork());
    });
}

loadVault().catch((err) => setStatus(err.message));

function setOverlayMessage(message, tone = 'info') {
    if (overlayMessage) {
        overlayMessage.textContent = message || '';
        overlayMessage.hidden = !message;
        overlayMessage.className = tone;
    }
    if (message) {
        setStatus(message);
    }
}

function clearOverlayMessage() {
    setOverlayMessage('');
}

function showStartOverlay() {
    overlayTitle.textContent = 'Quetzalcoatl Approaches...';
    clearOverlayMessage();
    startBtn.hidden = false;
    restartBtn.hidden = true;
    overlay.classList.remove('hidden');
    gameWrap?.classList.remove('is-playing');
    document.body.classList.remove('is-playing');
    syncStartButton();
}

function showRestartOverlay() {
    overlayTitle.textContent = 'Game Over';
    clearOverlayMessage();
    startBtn.hidden = true;
    restartBtn.hidden = false;
    overlay.classList.remove('hidden');
    gameWrap?.classList.remove('is-playing');
    document.body.classList.remove('is-playing');
    syncStartButton();
}

function focusGameCanvas() {
    startBtn.blur();
    restartBtn.blur();
    if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
    }
    const canvas = document.querySelector('#game canvas');
    if (canvas) {
        canvas.setAttribute('tabindex', '0');
        canvas.focus({ preventScroll: true });
    }
}

function hideOverlay() {
    overlay.classList.add('hidden');
    gameWrap?.classList.add('is-playing');
    document.body.classList.add('is-playing');
    focusGameCanvas();
}

function applyDirection(scene, x, y, key) {
    if (!scene || !scene.isRunning || scene.isGameOver) {
        return;
    }
    if (scene.nextDirection.x === x && scene.nextDirection.y === y) {
        return;
    }
    if (scene.nextDirection.x + x === 0 && scene.nextDirection.y + y === 0) {
        return;
    }

    scene.nextDirection = { x, y };
    scene.inputLog.push({
        key,
        score: scene.score,
        timestamp: Math.round(scene.time.now),
    });
}

const DIRECTION_MAP = {
    ArrowUp: [0, -1, 'UP'],
    ArrowDown: [0, 1, 'DOWN'],
    ArrowLeft: [-1, 0, 'LEFT'],
    ArrowRight: [1, 0, 'RIGHT'],
    up: [0, -1, 'UP'],
    down: [0, 1, 'DOWN'],
    left: [-1, 0, 'LEFT'],
    right: [1, 0, 'RIGHT'],
};

window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
        event.preventDefault();
    }

    const mapped = DIRECTION_MAP[event.key];
    if (mapped) {
        applyDirection(gameScene, mapped[0], mapped[1], mapped[2]);
    }
}, { passive: false });

function bindTouchControls() {
    let swipeOrigin = null;
    const swipeTarget = gameWrap || document.getElementById('game');
    if (!swipeTarget) {
        return;
    }

    const lockScroll = (event) => {
        event.preventDefault();
    };

    swipeTarget.addEventListener('touchstart', (event) => {
        const touch = event.changedTouches[0];
        swipeOrigin = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });

    swipeTarget.addEventListener('touchmove', lockScroll, { passive: false });

    swipeTarget.addEventListener('touchend', (event) => {
        if (!swipeOrigin) {
            return;
        }
        const touch = event.changedTouches[0];
        const dx = touch.clientX - swipeOrigin.x;
        const dy = touch.clientY - swipeOrigin.y;
        swipeOrigin = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) {
            return;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
            applyDirection(gameScene, dx > 0 ? 1 : -1, 0, dx > 0 ? 'RIGHT' : 'LEFT');
        } else {
            applyDirection(gameScene, 0, dy > 0 ? 1 : -1, dy > 0 ? 'DOWN' : 'UP');
        }
    }, { passive: true });
}

const TILE = 32;
const MOVE_MS = 150;
const SNAKE_HEAD_COLOR = 0x02C39A;
const SNAKE_BODY_COLOR = 0x00A896;
const JADE_COLOR = 0xF5C451;
const COLS = GAME_WIDTH / TILE;
const ROWS = GAME_HEIGHT / TILE;

const config = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game',
    backgroundColor: '#0A0E0D',
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
    },
    scene: {
        preload: preload,
        create: create,
        update: update,
    },
};

const game = new Phaser.Game(config);

showStartOverlay();
bindTouchControls();

let gameScene = null;

function preload() {
    // We will load Quetzalcoatl and Jade Stone assets here later
}

function isOnSnake(scene, x, y) {
    return scene.snake.some((segment) => segment.x === x && segment.y === y);
}

function spawnJadeStone(scene) {
    let x;
    let y;
    do {
        x = Phaser.Math.Between(0, COLS - 1) * TILE;
        y = Phaser.Math.Between(0, ROWS - 1) * TILE;
    } while (isOnSnake(scene, x, y));

    if (!scene.jadeStone) {
        scene.jadeStone = scene.add.rectangle(x, y, TILE, TILE, JADE_COLOR);
        scene.jadeStone.setOrigin(0, 0);
        return;
    }

    scene.jadeStone.setPosition(x, y);
}

function createSnake(scene) {
    const centerX = Math.floor(COLS / 2) * TILE;
    const centerY = Math.floor(ROWS / 2) * TILE;

    if (scene.snake) {
        scene.snake.forEach((segment) => segment.destroy());
    }
    if (scene.jadeStone) {
        scene.jadeStone.destroy();
        scene.jadeStone = null;
    }
    if (scene.gameOverText) {
        scene.gameOverText.destroy();
        scene.gameOverText = null;
    }

    scene.direction = { x: 1, y: 0 };
    scene.nextDirection = { x: 1, y: 0 };
    scene.moveTimer = 0;
    scene.inputLog = [];
    scene.score = 0;
    scene.isGameOver = false;
    scene.isRunning = false;
    scene.snake = [];
    scene.scoreText.setText('Score: 0');
    setHudScore(0);

    for (let i = 0; i < 3; i++) {
        const segment = scene.add.rectangle(
            centerX - i * TILE,
            centerY,
            TILE,
            TILE,
            i === 0 ? SNAKE_HEAD_COLOR : SNAKE_BODY_COLOR,
        );
        segment.setOrigin(0, 0);
        scene.snake.push(segment);
    }

    spawnJadeStone(scene);
}

function startRun(scene) {
    if (!canStartGame()) {
        setOverlayMessage(START_LOCKED_MESSAGE, 'warn');
        setStatus(START_LOCKED_MESSAGE);
        return;
    }
    createSnake(scene);
    scene.isRunning = true;
    hideOverlay();
}

function create() {
    gameScene = this;
    this.scoreText = this.add.text(20, 20, 'Score: 0', {
        fontSize: '16px',
        color: '#F5C451',
        fontFamily: 'monospace',
    });
    this.scoreText.setAlpha(0);

    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x16332c, 0.45);
    graphics.beginPath();

    for (let i = 0; i <= GAME_WIDTH; i += TILE) {
        graphics.moveTo(i, 0);
        graphics.lineTo(i, GAME_HEIGHT);
    }
    for (let j = 0; j <= GAME_HEIGHT; j += TILE) {
        graphics.moveTo(0, j);
        graphics.lineTo(GAME_WIDTH, j);
    }

    graphics.strokePath();
    this.input.keyboard.addCapture([
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
    ]);

    createSnake(this);
}

startBtn.addEventListener('click', () => {
    if (gameScene) {
        startRun(gameScene);
    }
});

restartBtn.addEventListener('click', () => {
    if (gameScene) {
        startRun(gameScene);
    }
});

async function submitScore(walletAddress, score, inputLog) {
    const res = await fetch('/api/score/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            walletAddress,
            score,
            inputLog,
            network: getSelectedNetwork(),
        }),
    });
    const data = await res.json().catch(() => ({}));
    applyVaultState(data, { celebrate: Boolean(data.claimed) });
    return data;
}

async function triggerGameOver(scene) {
    if (scene.isGameOver) {
        return;
    }

    scene.isGameOver = true;
    scene.isRunning = false;
    showRestartOverlay();

    try {
        const currentScore = scoreToBeat();
        if (scene.score <= currentScore) {
            const message = currentScore === 0
                ? 'Eat a jade stone to claim the record.'
                : `You did not beat the current record of ${currentScore}.`;
            setOverlayMessage(message, 'warn');
            return;
        }

        if (typeof window.getConnectedWallet !== 'function') {
            throw new Error('Wallet is not ready. Refresh and connect MetaMask.');
        }

        let walletAddress = null;
        try {
            walletAddress = await window.getConnectedWallet({ request: false });
        } catch {
            // Ignore silent read failures and prompt below.
        }
        if (!walletAddress) {
            walletAddress = await window.getConnectedWallet({ request: true });
        }

        const data = await submitScore(walletAddress, scene.score, scene.inputLog);
        if (data.claimed) {
            overlayTitle.textContent = 'Record Broken!';
            setOverlayMessage('Withdraw Prize is unlocked.', 'success');
            return;
        }
        setOverlayMessage(data.message || 'Score submitted.', 'warn');
    } catch (err) {
        setOverlayMessage(err.shortMessage || err.message || 'Could not submit score.', 'error');
    }
}

function update(time, delta) {
    if (!this.isRunning || this.isGameOver) {
        return;
    }

    this.moveTimer += delta;
    if (this.moveTimer < MOVE_MS) {
        return;
    }
    this.moveTimer = 0;
    this.direction = this.nextDirection;

    const head = this.snake[0];
    const tail = this.snake[this.snake.length - 1];
    const tailX = tail.x;
    const tailY = tail.y;
    const nextX = head.x + this.direction.x * TILE;
    const nextY = head.y + this.direction.y * TILE;

    const hitWall = nextX < 0 || nextY < 0 || nextX >= GAME_WIDTH || nextY >= GAME_HEIGHT;
    const hitTail = this.snake.some((segment, index) => {
        if (index === this.snake.length - 1) {
            return false;
        }
        return segment.x === nextX && segment.y === nextY;
    });

    if (hitWall || hitTail) {
        triggerGameOver(this);
        return;
    }

    for (let i = this.snake.length - 1; i > 0; i--) {
        this.snake[i].x = this.snake[i - 1].x;
        this.snake[i].y = this.snake[i - 1].y;
    }

    head.x = nextX;
    head.y = nextY;

    if (head.x === this.jadeStone.x && head.y === this.jadeStone.y) {
        this.score += 10;
        this.scoreText.setText(`Score: ${this.score}`);
        setHudScore(this.score);

        const newSegment = this.add.rectangle(tailX, tailY, TILE, TILE, SNAKE_BODY_COLOR);
        newSegment.setOrigin(0, 0);
        this.snake.push(newSegment);

        spawnJadeStone(this);
    }
}
