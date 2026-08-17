/* Goal: Create an Aztec-themed Snake game called Quetzal402 using Phaser.js (v3).
* The player controls Quetzalcoatl (the snake) on a 640x480 grid (32x32 pixel tiles).
* The snake eats Jade Stones to grow.
* Every keystroke must be logged to an array so the backend can validate the high score later.
* Use basic geometric shapes (rectangles) for the snake and food for now. */

const vaultTotalEl = document.getElementById('vault-total');
const statusEl = document.getElementById('status');

function setVaultTotal(value) {
    const amount = Number(value);
    vaultTotalEl.textContent = `${amount.toFixed(2)} USDC`;
}

function setStatus(message) {
    statusEl.textContent = message;
}

async function loadVault() {
    const res = await fetch('/api/vault');
    if (!res.ok) {
        throw new Error('Could not load vault total');
    }
    const data = await res.json();
    setVaultTotal(data.vaultTotal);
}

loadVault().catch((err) => setStatus(err.message));

const config = {
    type: Phaser.AUTO,
    width: 640,
    height: 480,
    parent: 'game',
    backgroundColor: '#0a2a1a',
    scene: {
        preload: preload,
        create: create,
        update: update,
    },
};

const game = new Phaser.Game(config);

const TILE = 32;
const MOVE_MS = 150;
const SNAKE_HEAD_COLOR = 0x3cb371;
const SNAKE_BODY_COLOR = 0x2e8b57;
const JADE_COLOR = 0xd4af37;
const COLS = 640 / TILE;
const ROWS = 480 / TILE;

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

function create() {
    this.scoreText = this.add.text(20, 20, 'Score: 0', {
        fontSize: '20px',
        color: '#d4af37',
    });

    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x1f4d29, 0.4);
    graphics.beginPath();

    for (let i = 0; i <= 640; i += TILE) {
        graphics.moveTo(i, 0);
        graphics.lineTo(i, 480);
    }
    for (let j = 0; j <= 480; j += TILE) {
        graphics.moveTo(0, j);
        graphics.lineTo(640, j);
    }

    graphics.strokePath();

    const centerX = Math.floor(COLS / 2) * TILE;
    const centerY = Math.floor(ROWS / 2) * TILE;

    this.direction = { x: 1, y: 0 };
    this.nextDirection = { x: 1, y: 0 };
    this.moveTimer = 0;
    this.inputLog = [];
    this.score = 0;
    this.isGameOver = false;
    this.snake = [];

    for (let i = 0; i < 3; i++) {
        const segment = this.add.rectangle(
            centerX - i * TILE,
            centerY,
            TILE,
            TILE,
            i === 0 ? SNAKE_HEAD_COLOR : SNAKE_BODY_COLOR,
        );
        segment.setOrigin(0, 0);
        this.snake.push(segment);
    }

    spawnJadeStone(this);

    const setDirection = (x, y, key) => {
        if (this.isGameOver) {
            return;
        }
        if (this.nextDirection.x === x && this.nextDirection.y === y) {
            return;
        }
        if (this.nextDirection.x + x === 0 && this.nextDirection.y + y === 0) {
            return;
        }

        this.nextDirection = { x, y };
        this.inputLog.push({
            key,
            score: this.score,
            timestamp: Math.round(this.time.now),
        });
    };

    this.input.keyboard.on('keydown-UP', () => setDirection(0, -1, 'UP'));
    this.input.keyboard.on('keydown-DOWN', () => setDirection(0, 1, 'DOWN'));
    this.input.keyboard.on('keydown-LEFT', () => setDirection(-1, 0, 'LEFT'));
    this.input.keyboard.on('keydown-RIGHT', () => setDirection(1, 0, 'RIGHT'));
}

async function submitScore(walletAddress, score, inputLog) {
    const res = await fetch('/api/score/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            walletAddress,
            score,
            inputLog,
        }),
    });
    const data = await res.json().catch(() => ({}));
    window.alert(data.message || `Score submit failed (${res.status})`);
}

function triggerGameOver(scene) {
    if (scene.isGameOver) {
        return;
    }

    scene.isGameOver = true;
    scene.add.text(320, 240, 'Game Over', {
        fontSize: '40px',
        color: '#d4af37',
    }).setOrigin(0.5);

    const walletAddress = window.prompt(
        'Enter your USDC Receiving Address to claim the prize if you win:',
    );

    submitScore(walletAddress, scene.score, scene.inputLog).catch((err) => {
        window.alert(err.message || 'Could not submit score.');
    });
}

function update(time, delta) {
    if (this.isGameOver) {
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

    const hitWall = nextX < 0 || nextY < 0 || nextX >= 640 || nextY >= 480;
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

        const newSegment = this.add.rectangle(tailX, tailY, TILE, TILE, SNAKE_BODY_COLOR);
        newSegment.setOrigin(0, 0);
        this.snake.push(newSegment);

        spawnJadeStone(this);
    }
}
