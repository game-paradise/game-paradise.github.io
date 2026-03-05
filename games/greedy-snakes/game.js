// Game State
let gameState = {
    playerName: '',
    selectedMap: 'stars',
    mapSize: 'normal',
    botDifficulty: 'easy',
    yellowMoney: getValidatedYellowMoney(),
    gameRunning: false,
    ownedSkins: JSON.parse(localStorage.getItem('ownedSkins') || '["ball-green"]'),
    selectedSkin: localStorage.getItem('selectedSkin') || 'ball-green'
};

// Checksum functions to prevent console hacking
function getYellowMoneyChecksum(amount) {
    return (amount * 17 + 42) % 1000000;
}

function getValidatedYellowMoney() {
    const amount = parseInt(localStorage.getItem('yellowMoney') || '0');
    const storedChecksum = parseInt(localStorage.getItem('yellowMoneyChecksum') || '0');
    const expectedChecksum = getYellowMoneyChecksum(amount);
    
    // If checksum doesn't match, reset to 0
    if (storedChecksum !== expectedChecksum) {
        localStorage.setItem('yellowMoney', '0');
        localStorage.setItem('yellowMoneyChecksum', getYellowMoneyChecksum(0).toString());
        return 0;
    }
    return amount;
}

function saveYellowMoney(amount) {
    // Clamp to reasonable values to prevent overflow hacks
    const validAmount = Math.max(0, Math.min(amount, 999999999));
    gameState.yellowMoney = validAmount;
    localStorage.setItem('yellowMoney', validAmount.toString());
    localStorage.setItem('yellowMoneyChecksum', getYellowMoneyChecksum(validAmount).toString());
}

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Screen elements
const startScreen = document.getElementById('startScreen');
const loadingScreen = document.getElementById('loadingScreen');
const gameScreen = document.getElementById('gameScreen');

// Game variables
let snakes = [];
let playerSnake = null;
let money = [];
let gameLoop = null;
let lastTime = 0;
let mouseX = 0;
let mouseY = 0;

// Track pressed keys to fix movement glitch
let keysPressed = {
    w: false,
    a: false,
    s: false,
    d: false,
    arrowup: false,
    arrowdown: false,
    arrowleft: false,
    arrowright: false
};

// Camera system
let camera = {
    x: 0,
    y: 0,
    zoom: 2.0 // Zoom level (2x = more zoomed in)
};

// World dimensions (larger than canvas for scrolling)
let worldWidth = 0;
let worldHeight = 0;

// Map sizes (bigger maps with more bots)
const mapSizes = {
    small: { width: 2000, height: 1500, maxBots: 8, moneyAmount: 400 },
    normal: { width: 3000, height: 2000, maxBots: 15, moneyAmount: 600 },
    big: { width: 4000, height: 3000, maxBots: 25, moneyAmount: 800 },
    huge: { width: 5000, height: 4000, maxBots: 40, moneyAmount: 1111 },
    gigantic: { width: 8000, height: 6000, maxBots: 60, moneyAmount: 1500 }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupStartScreen();
    setupSkinsPage();
    setupModPanel();
    updateYellowMoneyDisplay();
    
    // Edge detection for skins page
    document.addEventListener('mousemove', (e) => {
        if (e.clientX < 10 && !gameState.gameRunning && document.getElementById('startScreen').classList.contains('active')) {
            openSkinsPage();
        }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (gameState.gameRunning && playerSnake) {
            resizeCanvas();
            // Update camera to maintain player position
            camera.x = playerSnake.x - (canvas.width / camera.zoom / 2);
            camera.y = playerSnake.y - (canvas.height / camera.zoom / 2);
            // Clamp camera to world bounds
            camera.x = Math.max(0, Math.min(camera.x, worldWidth - (canvas.width / camera.zoom)));
            camera.y = Math.max(0, Math.min(camera.y, worldHeight - (canvas.height / camera.zoom)));
        }
    });
});

function openSkinsPage() {
    document.getElementById('startScreen').classList.remove('active');
    document.getElementById('skinsScreen').classList.add('active');
    document.getElementById('githubLink').style.display = 'none';
}

function closeSkinsPage() {
    document.getElementById('skinsScreen').classList.remove('active');
    document.getElementById('startScreen').classList.add('active');
    document.getElementById('githubLink').style.display = 'flex';
}

// Mods system
let mods = []; // Array to store available mods

function setupModPanel() {
    const modButton = document.getElementById('modButton');
    const modPanel = document.getElementById('modPanel');
    const closeModBtn = document.getElementById('closeModPanel');
    const modSearchBar = document.getElementById('modSearchBar');
    const filterMadeByDev = document.getElementById('filterMadeByDev');
    const githubLink = document.getElementById('githubLink');
    
    // Open/close mod panel
    modButton.addEventListener('click', () => {
        modPanel.classList.toggle('open');
        githubLink.classList.toggle('hidden');
    });
    
    closeModBtn.addEventListener('click', () => {
        modPanel.classList.remove('open');
        githubLink.classList.remove('hidden');
    });
    
    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        if (!modPanel.contains(e.target) && e.target !== modButton && !modButton.contains(e.target)) {
            modPanel.classList.remove('open');
            githubLink.classList.remove('hidden');
        }
    });
    
    // Search and filter functionality
    modSearchBar.addEventListener('input', updateModsList);
    filterMadeByDev.addEventListener('change', updateModsList);
}

function updateModsList() {
    const modList = document.getElementById('modList');
    const searchTerm = document.getElementById('modSearchBar').value.toLowerCase();
    const filterMadeByDev = document.getElementById('filterMadeByDev').checked;
    
    // Filter mods based on search and filters
    let filteredMods = mods.filter(mod => {
        const matchesSearch = mod.name.toLowerCase().includes(searchTerm) || 
                             mod.description.toLowerCase().includes(searchTerm);
        const matchesFilter = !filterMadeByDev || mod.author === 'dev';
        return matchesSearch && matchesFilter;
    });
    
    // Display filtered mods or no mods message
    if (filteredMods.length === 0) {
        modList.innerHTML = '<p class="no-mods-message">No mods available</p>';
    } else {
        modList.innerHTML = filteredMods.map(mod => `
            <div class="mod-item">
                <h4>${mod.name}</h4>
                <p>${mod.description}</p>
                <span class="mod-author">By: ${mod.author}</span>
            </div>
        `).join('');
    }
}

const skins = [
    { id: 'ball-green', name: 'Green Ball', cost: 0, type: 'ball', color: '#44FF44', preview: 'ball-skin-green', automatic: true },
    { id: 'ball-red', name: 'Red Ball', cost: 5, type: 'ball', color: '#FF4444', preview: 'ball-skin-red' },
    { id: 'ball-blue', name: 'Blue Ball', cost: 5, type: 'ball', color: '#4444FF', preview: 'ball-skin-blue' },
    { id: 'ball-purple', name: 'Purple Ball', cost: 5, type: 'ball', color: '#DD44DD', preview: 'ball-skin-purple' },
    { id: 'ball-yellow', name: 'Yellow Ball', cost: 5, type: 'ball', color: '#FFFF44', preview: 'ball-skin-yellow' },
    { id: 'ball-cyan', name: 'Cyan Ball', cost: 5, type: 'ball', color: '#44FFFF', preview: 'ball-skin-cyan' },
    { id: 'error', name: 'ERROR :]', cost: 100, type: 'vector', preview: 'vector-skin' }
];

let currentSkinIndex = 0;

function setupSkinsPage() {
    const prevBtn = document.getElementById('prevSkinBtn');
    const nextBtn = document.getElementById('nextSkinBtn');
    const selectBtn = document.getElementById('selectSkinBtn');
    const backBtn = document.getElementById('backButton');
    
    // Always start at green ball (index 0)
    currentSkinIndex = 0;
    
    prevBtn.addEventListener('click', () => {
        showSkinItem((currentSkinIndex - 1 + skins.length) % skins.length);
    });
    
    nextBtn.addEventListener('click', () => {
        showSkinItem((currentSkinIndex + 1) % skins.length);
    });
    
    selectBtn.addEventListener('click', () => {
        const skin = skins[currentSkinIndex];
        if (gameState.ownedSkins.includes(skin.id)) {
            gameState.selectedSkin = skin.id;
            localStorage.setItem('selectedSkin', skin.id);
            closeSkinsPage();
        } else {
            if (gameState.yellowMoney >= skin.cost) {
                saveYellowMoney(gameState.yellowMoney - skin.cost);
                gameState.ownedSkins.push(skin.id);
                localStorage.setItem('ownedSkins', JSON.stringify(gameState.ownedSkins));
                gameState.selectedSkin = skin.id;
                localStorage.setItem('selectedSkin', skin.id);
                updateSkinsDisplay();
                updateYellowMoneyDisplay();
            }
        }
    });
    
    backBtn.addEventListener('click', () => {
        closeSkinsPage();
    });
    
    updateSkinsDisplay();
}

function showSkinItem(index) {
    currentSkinIndex = index;
    updateSkinsDisplay();
}

function updateSkinsDisplay() {
    document.querySelectorAll('.skin-item').forEach((item, index) => {
        item.classList.remove('active');
    });
    document.getElementById('skinItem' + currentSkinIndex).classList.add('active');
    
    // Update all skin names and statuses
    skins.forEach((skin, index) => {
        const nameEl = document.getElementById('skinName' + index);
        const statusEl = document.getElementById('skinStatus' + index);
        if (nameEl) nameEl.textContent = skin.name;
        
        const isOwned = gameState.ownedSkins.includes(skin.id);
        if (statusEl) {
            if (isOwned || skin.automatic) {
                statusEl.textContent = 'Owned';
                statusEl.className = 'skin-status owned';
            } else {
                statusEl.innerHTML = `${skin.cost} <span class="money-icon">💰</span>`;
                statusEl.className = 'skin-status locked';
            }
        }
    });
    
    const skin = skins[currentSkinIndex];
    const isOwned = gameState.ownedSkins.includes(skin.id);
    const selectBtn = document.getElementById('selectSkinBtn');
    
    if (isOwned) {
        selectBtn.textContent = 'Select Skin';
        selectBtn.disabled = false;
    } else {
        selectBtn.textContent = `Buy for ${skin.cost} 💰`;
        selectBtn.disabled = gameState.yellowMoney < skin.cost;
    }
}

function setupStartScreen() {
    // Setup modal popups for Map Theme
    const mapDisplayBtn = document.getElementById('mapDisplayBtn');
    const mapModal = document.getElementById('mapModal');
    const mapValue = document.getElementById('mapValue');

    mapDisplayBtn.addEventListener('click', () => {
        // Toggle modal visibility
        mapModal.classList.toggle('active');
        // Close other modals
        document.getElementById('sizeModal').classList.remove('active');
        document.getElementById('difficultyModal').classList.remove('active');
    });

    document.querySelectorAll('#mapModal .modal-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) return;
            document.querySelectorAll('#mapModal .modal-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            gameState.selectedMap = btn.dataset.map;
            mapValue.textContent = btn.textContent.trim();
            mapModal.classList.remove('active');
        });
    });

    // Setup modal popups for Map Size
    const sizeDisplayBtn = document.getElementById('sizeDisplayBtn');
    const sizeModal = document.getElementById('sizeModal');
    const sizeValue = document.getElementById('sizeValue');

    sizeDisplayBtn.addEventListener('click', () => {
        // Toggle modal visibility
        sizeModal.classList.toggle('active');
        // Close other modals
        document.getElementById('mapModal').classList.remove('active');
        document.getElementById('difficultyModal').classList.remove('active');
    });

    document.querySelectorAll('#sizeModal .modal-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) return;
            document.querySelectorAll('#sizeModal .modal-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            gameState.mapSize = btn.dataset.size;
            sizeValue.textContent = btn.textContent.trim();
            sizeModal.classList.remove('active');
        });
    });

    // Setup modal popups for Difficulty
    const difficultyDisplayBtn = document.getElementById('difficultyDisplayBtn');
    const difficultyModal = document.getElementById('difficultyModal');
    const difficultyValue = document.getElementById('difficultyValue');

    difficultyDisplayBtn.addEventListener('click', () => {
        // Toggle modal visibility
        difficultyModal.classList.toggle('active');
        // Close other modals
        document.getElementById('mapModal').classList.remove('active');
        document.getElementById('sizeModal').classList.remove('active');
    });

    document.querySelectorAll('#difficultyModal .modal-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) return;
            document.querySelectorAll('#difficultyModal .modal-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            gameState.botDifficulty = btn.dataset.difficulty;
            difficultyValue.textContent = btn.textContent.trim();
            difficultyModal.classList.remove('active');
        });
    });

    // Close modals when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.option-selector') && !e.target.closest('.option-display-btn')) {
            document.getElementById('mapModal').classList.remove('active');
            document.getElementById('sizeModal').classList.remove('active');
            document.getElementById('difficultyModal').classList.remove('active');
        }
    });

    // Start button
    document.getElementById('startButton').addEventListener('click', () => {
        gameState.playerName = document.getElementById('playerName').value || 'Player';
        startGame();
    });
}

function updateYellowMoneyDisplay() {
    document.getElementById('yellowMoneyCount').textContent = gameState.yellowMoney;
    if (document.getElementById('yellowMoneyCountGame')) {
        document.getElementById('yellowMoneyCountGame').textContent = gameState.yellowMoney;
    }
    if (document.getElementById('yellowMoneySkins')) {
        document.getElementById('yellowMoneySkins').textContent = gameState.yellowMoney;
    }
}

function startGame() {
    startScreen.classList.remove('active');
    loadingScreen.classList.add('active');
    
    // Longer loading time for gigantic map
    const loadTime = gameState.mapSize === 'gigantic' ? 3500 : 2000;
    
    // Simulate loading
    setTimeout(() => {
        loadingScreen.classList.remove('active');
        gameScreen.classList.add('active');
        initGame();
    }, loadTime);
}

function resizeCanvas() {
    // Make canvas fullscreen
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function initGame() {
    try {
        const size = mapSizes[gameState.mapSize];
        if (!size) {
            console.error('Invalid map size:', gameState.mapSize);
            return;
        }
        
        // Canvas size is fullscreen
        resizeCanvas();
        
        // World size is larger
        worldWidth = size.width;
        worldHeight = size.height;
    
    // Reset game state
    snakes = [];
    money = [];
    playerSnake = null;
    starPositions = []; // Reset stars for new map
    
    // Create player snake in world coordinates
    const playerStartX = worldWidth / 2;
    const playerStartY = worldHeight / 2;
    
    // Get selected skin
    const selectedSkinId = gameState.selectedSkin || 'ball-green';
    const selectedSkinObj = skins.find(s => s.id === selectedSkinId);
    
    playerSnake = new Snake(
        playerStartX,
        playerStartY,
        '#00ff00',
        true,
        gameState.playerName,
        selectedSkinObj
    );
    snakes.push(playerSnake);
    
    // Initialize camera to center on player (after canvas is resized)
    camera.zoom = 2.0;
    camera.x = playerStartX - (canvas.width / camera.zoom / 2);
    camera.y = playerStartY - (canvas.height / camera.zoom / 2);
    
    // Create bots
    const botCount = size.maxBots;
    for (let i = 0; i < botCount; i++) {
        let x, y;
        let attempts = 0;
        // Find a position that's not too close to existing snakes
        do {
            x = Math.random() * worldWidth;
            y = Math.random() * worldHeight;
            attempts++;
        } while (isPositionTooCloseToSnakes(x, y, 200) && attempts < 50);
        
        const bot = new Snake(x, y, getRandomColor(), false, getRandomBotName());
        bot.isBot = true;
        bot.difficulty = gameState.botDifficulty;
        snakes.push(bot);
    }
    
    // Spawn initial money based on map size
    const moneyAmount = size.moneyAmount;
    spawnMoney(moneyAmount);
    
    // Setup upgrades
    setupUpgrades();
    
    // Start game loop
    gameState.gameRunning = true;
    lastTime = performance.now();
    gameLoop = requestAnimationFrame(update);
    
    // Setup input
    setupInput();
    } catch (error) {
        console.error('Error initializing game:', error);
        alert('Error starting game. Please refresh the page.');
    }
}

function updateDirectionFromKeys() {
    if (!gameState.gameRunning || !playerSnake) return;
    
    let dx = 0;
    let dy = 0;
    
    // Check which keys are pressed
    if (keysPressed.w || keysPressed.arrowup) {
        dy = -1;
    }
    if (keysPressed.s || keysPressed.arrowdown) {
        dy = 1;
    }
    if (keysPressed.a || keysPressed.arrowleft) {
        dx = -1;
    }
    if (keysPressed.d || keysPressed.arrowright) {
        dx = 1;
    }
    
    // Only set direction if at least one key is pressed
    if (dx !== 0 || dy !== 0) {
        playerSnake.setDirection(dx, dy, true); // Allow reversals from keyboard
    }
}

function setupInput() {
    // Key down handler
    const keyDownHandler = (e) => {
        if (!gameState.gameRunning || !playerSnake) return;
        
        const key = e.key.toLowerCase();
        
        // Upgrade hotkeys
        if (key === '1') {
            const cost = playerSnake.getUpgradeCost('size');
            if (playerSnake.greenMoney >= cost && playerSnake.sizeLevel < 20) {
                playerSnake.buyUpgrade('size');
                document.getElementById('sizeCost').textContent = playerSnake.getUpgradeCost('size');
                document.getElementById('sizeLevel').textContent = playerSnake.sizeLevel;
                document.getElementById('greenMoneyCount').textContent = playerSnake.greenMoney;
                document.getElementById('upgradeSize').disabled = 
                    playerSnake.sizeLevel >= 20 || playerSnake.greenMoney < playerSnake.getUpgradeCost('size');
            }
            return;
        } else if (key === '2') {
            const cost = playerSnake.getUpgradeCost('speed');
            if (playerSnake.greenMoney >= cost && playerSnake.speedLevel < 15) {
                playerSnake.buyUpgrade('speed');
                document.getElementById('speedCost').textContent = playerSnake.getUpgradeCost('speed');
                document.getElementById('speedLevel').textContent = playerSnake.speedLevel;
                document.getElementById('greenMoneyCount').textContent = playerSnake.greenMoney;
                document.getElementById('upgradeSpeed').disabled = 
                    playerSnake.speedLevel >= 15 || playerSnake.greenMoney < playerSnake.getUpgradeCost('speed');
            }
            return;
        } else if (key === '3') {
            const cost = playerSnake.getUpgradeCost('multiplier');
            if (playerSnake.greenMoney >= cost && playerSnake.multiplierLevel < 20) {
                playerSnake.buyUpgrade('multiplier');
                document.getElementById('multiplierCost').textContent = playerSnake.getUpgradeCost('multiplier');
                document.getElementById('multiplierLevel').textContent = playerSnake.multiplierLevel;
                document.getElementById('greenMoneyCount').textContent = playerSnake.greenMoney;
                document.getElementById('upgradeMultiplier').disabled = 
                    playerSnake.multiplierLevel >= 20 || playerSnake.greenMoney < playerSnake.getUpgradeCost('multiplier');
            }
            return;
        }
        
        if (key === 'w' || key === 'arrowup' || key === 's' || key === 'arrowdown' ||
            key === 'a' || key === 'arrowleft' || key === 'd' || key === 'arrowright') {
            e.preventDefault();
            // Only update if the key state actually changed
            if (!keysPressed[key]) {
                keysPressed[key] = true;
                updateDirectionFromKeys();
            }
        }
    };
    
    // Key up handler
    const keyUpHandler = (e) => {
        const key = e.key.toLowerCase();
        if (key === 'w' || key === 'arrowup' || key === 's' || key === 'arrowdown' ||
            key === 'a' || key === 'arrowleft' || key === 'd' || key === 'arrowright') {
            e.preventDefault();
            keysPressed[key] = false;
            updateDirectionFromKeys();
        }
    };
    
    // Remove old listeners if any
    if (setupInput.keyDownHandler) {
        document.removeEventListener('keydown', setupInput.keyDownHandler);
        document.removeEventListener('keyup', setupInput.keyUpHandler);
    }
    
    setupInput.keyDownHandler = keyDownHandler;
    setupInput.keyUpHandler = keyUpHandler;
    document.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keyup', keyUpHandler);
    
    // Mouse input - convert screen coordinates to world coordinates
    const mouseHandler = (e) => {
        if (!gameState.gameRunning || !playerSnake) return;
        
        // Check if any keyboard keys are pressed - if so, ignore mouse
        if (keysPressed.w || keysPressed.arrowup || keysPressed.s || keysPressed.arrowdown ||
            keysPressed.a || keysPressed.arrowleft || keysPressed.d || keysPressed.arrowright) {
            return;
        }
        
        // Check if mouse is over UI elements
        const gameUI = document.querySelector('.game-ui');
        if (gameUI && gameUI.contains(e.target)) return;
        
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        
        // Convert screen coordinates to world coordinates
        const worldX = (screenX / camera.zoom) + camera.x;
        const worldY = (screenY / camera.zoom) + camera.y;
        
        // Calculate direction from player to mouse in world space
        const dx = worldX - playerSnake.x;
        const dy = worldY - playerSnake.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 5) {
            // Normalize direction
            playerSnake.setDirection(dx / dist, dy / dist);
        }
    };
    
    canvas.removeEventListener('mousemove', setupInput.mouseHandler);
    setupInput.mouseHandler = mouseHandler;
    canvas.addEventListener('mousemove', mouseHandler);
    
    // Touch input - for mobile support
    const touchHandler = (e) => {
        if (!gameState.gameRunning || !playerSnake) return;
        
        // Check if any keyboard keys are pressed - if so, ignore touch
        if (keysPressed.w || keysPressed.arrowup || keysPressed.s || keysPressed.arrowdown ||
            keysPressed.a || keysPressed.arrowleft || keysPressed.d || keysPressed.arrowright) {
            return;
        }
        
        // Check if touch is over UI elements
        const gameUI = document.querySelector('.game-ui');
        if (gameUI && gameUI.contains(e.target)) return;
        
        if (e.touches.length > 0) {
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const screenX = touch.clientX - rect.left;
            const screenY = touch.clientY - rect.top;
            
            // Convert screen coordinates to world coordinates
            const worldX = (screenX / camera.zoom) + camera.x;
            const worldY = (screenY / camera.zoom) + camera.y;
            
            // Calculate direction from player to touch in world space
            const dx = worldX - playerSnake.x;
            const dy = worldY - playerSnake.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 5) {
                // Normalize direction
                playerSnake.setDirection(dx / dist, dy / dist);
            }
        }
    };
    
    canvas.removeEventListener('touchmove', setupInput.touchHandler);
    setupInput.touchHandler = touchHandler;
    canvas.addEventListener('touchmove', touchHandler, false);
}

function setupUpgrades() {
    const sizeBtn = document.getElementById('upgradeSize');
    const speedBtn = document.getElementById('upgradeSpeed');
    const multiplierBtn = document.getElementById('upgradeMultiplier');
    
    sizeBtn.addEventListener('click', () => {
        playerSnake.buyUpgrade('size');
    });
    speedBtn.addEventListener('click', () => {
        playerSnake.buyUpgrade('speed');
    });
    multiplierBtn.addEventListener('click', () => {
        playerSnake.buyUpgrade('multiplier');
    });
}

function update(currentTime) {
    if (!gameState.gameRunning) return;
    
    try {
        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
    
    // Update snakes
    snakes.forEach(snake => {
        if (snake.alive) {
            snake.update(deltaTime, worldWidth, worldHeight);
            
            // Bot AI
            if (snake.isBot) {
                updateBotAI(snake);
            }
        }
    });
    
    // Update camera to follow player
    if (playerSnake && playerSnake.alive) {
        // Smooth camera follow
        const targetX = playerSnake.x - (canvas.width / camera.zoom / 2);
        const targetY = playerSnake.y - (canvas.height / camera.zoom / 2);
        
        camera.x += (targetX - camera.x) * 0.1;
        camera.y += (targetY - camera.y) * 0.1;
        
        // Clamp camera to world bounds
        camera.x = Math.max(0, Math.min(camera.x, worldWidth - (canvas.width / camera.zoom)));
        camera.y = Math.max(0, Math.min(camera.y, worldHeight - (canvas.height / camera.zoom)));
    }
    
    // Check collisions
    checkCollisions();
    
    // Check money collection
    checkMoneyCollection();
    
    // Spawn new money if needed (keep minimum based on map size)
    const mapSize = mapSizes[gameState.mapSize];
    const minMoney = mapSize.moneyAmount;
    if (money.length < minMoney) {
        spawnMoney(5);
    }
    
    // Spawn new bots if needed
    const aliveBots = snakes.filter(s => s.isBot && s.alive).length;
    if (aliveBots < mapSize.maxBots && Math.random() < 0.01) {
        let x, y;
        let attempts = 0;
        // Find a position that's not too close to existing snakes
        do {
            x = Math.random() * worldWidth;
            y = Math.random() * worldHeight;
            attempts++;
        } while (isPositionTooCloseToSnakes(x, y, 200) && attempts < 50);
        
        const bot = new Snake(x, y, getRandomColor(), false, getRandomBotName());
        bot.isBot = true;
        bot.difficulty = gameState.botDifficulty;
        snakes.push(bot);
    }
    
    // Render
    render();
    
    // Update UI
    updateGameUI();
    
    // Check game over
    if (!playerSnake.alive) {
        gameOver();
        return;
    }
    
    gameLoop = requestAnimationFrame(update);
    } catch (error) {
        console.error('Error in game update:', error);
        gameState.gameRunning = false;
    }
}

function updateBotAI(bot) {
    if (!bot.alive) return;
    
    // Find nearest money
    let nearestMoney = null;
    let minDist = Infinity;
    
    money.forEach(m => {
        const dx = m.x - bot.x;
        const dy = m.y - bot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
            minDist = dist;
            nearestMoney = m;
        }
    });
    
    // Find nearest threat (other snake head)
    let nearestThreat = null;
    let threatDist = Infinity;
    
    snakes.forEach(snake => {
        if (snake !== bot && snake.alive) {
            const dx = snake.x - bot.x;
            const dy = snake.y - bot.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < threatDist && dist < 100) {
                threatDist = dist;
                nearestThreat = snake;
            }
        }
    });
    
    // Bot behavior based on difficulty
    const difficulty = bot.difficulty;
    let targetX = bot.x;
    let targetY = bot.y;
    
    if (nearestMoney) {
        const dx = nearestMoney.x - bot.x;
        const dy = nearestMoney.y - bot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (difficulty === 'easy') {
            // Easy bots are slower and less accurate
            if (Math.random() > 0.3) {
                targetX = nearestMoney.x + (Math.random() - 0.5) * 50;
                targetY = nearestMoney.y + (Math.random() - 0.5) * 50;
            }
        } else if (difficulty === 'normal') {
            // Normal bots go for money
            targetX = nearestMoney.x;
            targetY = nearestMoney.y;
        } else if (difficulty === 'hard') {
            // Hard bots avoid threats and go for money
            if (nearestThreat && threatDist < 80) {
                // Avoid threat
                const avoidDx = bot.x - nearestThreat.x;
                const avoidDy = bot.y - nearestThreat.y;
                const avoidDist = Math.sqrt(avoidDx * avoidDx + avoidDy * avoidDy);
                targetX = bot.x + (avoidDx / avoidDist) * 50;
                targetY = bot.y + (avoidDy / avoidDist) * 50;
            } else {
                targetX = nearestMoney.x;
                targetY = nearestMoney.y;
            }
        }
    }
    
    // Set direction towards target
    const dx = targetX - bot.x;
    const dy = targetY - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 5) {
        bot.setDirection(dx / dist, dy / dist);
    }
    
    // Auto-buy upgrades
    bot.autoBuyUpgrade();
}

function checkCollisions() {
    for (let i = 0; i < snakes.length; i++) {
        const snake1 = snakes[i];
        if (!snake1.alive) continue;
        
        // Borders wrap around (handled in update function), no wall collision check needed
        
        // Check collision with other snakes
        for (let j = 0; j < snakes.length; j++) {
            const snake2 = snakes[j];
            if (!snake2.alive || i === j) continue;
            
            // Head to head collision
            const headDist = Math.sqrt(
                Math.pow(snake1.x - snake2.x, 2) + 
                Math.pow(snake1.y - snake2.y, 2)
            );
            if (headDist < snake1.size + snake2.size) {
                // Drop green money when snakes die
                if (snake1.alive) {
                    dropGreenMoney(snake1);
                }
                if (snake2.alive) {
                    dropGreenMoney(snake2);
                }
                snake1.alive = false;
                snake2.alive = false;
                continue;
            }
            
            // Head to body collision
            for (let k = 1; k < snake2.body.length; k++) {
                const segment = snake2.body[k];
                const dist = Math.sqrt(
                    Math.pow(snake1.x - segment.x, 2) + 
                    Math.pow(snake1.y - segment.y, 2)
                );
                if (dist < snake1.size) {
                    // Drop green money when snake dies
                    if (snake1.alive) {
                        dropGreenMoney(snake1);
                    }
                    snake1.alive = false;
                    break;
                }
            }
        }
    }
}

function checkMoneyCollection() {
    snakes.forEach(snake => {
        if (!snake.alive) return;
        
        // Use a reverse loop to safely remove items while iterating
        for (let i = money.length - 1; i >= 0; i--) {
            const m = money[i];
            const dx = snake.x - m.x;
            const dy = snake.y - m.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < snake.size + m.size) {
                // Collect money - ONLY give yellow money if it's actually a yellow money item
                if (m.type === 'green') {
                    // Green money increases by 10 (with multiplier)
                    snake.greenMoney += 10 * snake.multiplier;
                } else if (m.type === 'yellow') {
                    // Yellow money increases by 1 (no multiplier) - ONLY for player
                    if (snake.isPlayer) {
                        saveYellowMoney(gameState.yellowMoney + 1);
                    }
                    // Don't track yellowMoney per snake, only global
                }
                
                money.splice(i, 1);
            }
        }
    });
}

function isPositionTooCloseToSnakes(x, y, minDistance = 200) {
    return snakes.some(snake => {
        const dx = snake.x - x;
        const dy = snake.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < minDistance;
    });
}

function spawnMoney(count) {
    for (let i = 0; i < count; i++) {
        const x = Math.random() * worldWidth;
        const y = Math.random() * worldHeight;
        // 20% yellow, 80% green
        const type = Math.random() < 0.8 ? 'green' : 'yellow';
        // Value is now just for display/type, actual values are handled in collection
        const value = type === 'green' ? 10 : 1;
        money.push(new Money(x, y, type, value));
    }
}

function dropGreenMoney(snake) {
    // Drop all the green money the snake has spent (upgrades) + what they're carrying
    let totalGreenMoney = snake.greenMoney; // Money they're currently carrying
    
    // Add back the money spent on upgrades based on level
    // Size upgrade costs
    for (let i = 1; i < snake.sizeLevel; i++) {
        totalGreenMoney += Math.floor(50 * Math.pow(1.2, i - 1));
    }
    
    // Speed upgrade costs
    for (let i = 1; i < snake.speedLevel; i++) {
        totalGreenMoney += Math.floor(40 * Math.pow(1.15, i - 1));
    }
    
    // Multiplier upgrade costs
    for (let i = 1; i < snake.multiplierLevel; i++) {
        totalGreenMoney += Math.floor(100 * Math.pow(1.3, i - 1));
    }
    
    // Spawn green money at snake's position (max 20 coins to avoid lag)
    const coinCount = Math.min(20, Math.ceil(totalGreenMoney / 50));
    const coinValue = Math.ceil(totalGreenMoney / coinCount);
    
    for (let i = 0; i < coinCount; i++) {
        const angle = (Math.random() * Math.PI * 2);
        const distance = Math.random() * 100 + 20;
        const x = snake.x + Math.cos(angle) * distance;
        const y = snake.y + Math.sin(angle) * distance;
        money.push(new Money(x, y, 'green', coinValue));
    }
}

let starPositions = [];

function generateStars() {
    starPositions = [];
    const starCount = Math.floor((worldWidth * worldHeight) / 2000);
    for (let i = 0; i < starCount; i++) {
        starPositions.push({
            x: Math.random() * worldWidth,
            y: Math.random() * worldHeight,
            size: Math.random() * 2 + 0.5,
            brightness: Math.random() * 0.8 + 0.2
        });
    }
}

function render() {
    // Save context
    ctx.save();
    
    // Apply camera transform (zoom and translate)
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    
    // Calculate visible bounds with some padding
    const padding = 200;
    const visibleLeft = camera.x - padding;
    const visibleRight = camera.x + (canvas.width / camera.zoom) + padding;
    const visibleTop = camera.y - padding;
    const visibleBottom = camera.y + (canvas.height / camera.zoom) + padding;
    
    // Clear canvas (draw background)
    if (gameState.selectedMap === 'stars') {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, worldWidth, worldHeight);
        
        // Draw stars (with culling)
        if (starPositions.length === 0) {
            generateStars();
        }
        starPositions.forEach(star => {
            if (star.x > visibleLeft && star.x < visibleRight && star.y > visibleTop && star.y < visibleBottom) {
                ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    } else if (gameState.selectedMap === 'rainbow') {
        const time = Date.now() / 1000;
        const gradient = ctx.createLinearGradient(0, 0, worldWidth, worldHeight);
        const hue1 = (time * 30) % 360;
        const hue2 = (hue1 + 60) % 360;
        const hue3 = (hue2 + 60) % 360;
        gradient.addColorStop(0, `hsl(${hue1}, 100%, 10%)`);
        gradient.addColorStop(0.5, `hsl(${hue2}, 100%, 10%)`);
        gradient.addColorStop(1, `hsl(${hue3}, 100%, 10%)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, worldWidth, worldHeight);
    } else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, worldWidth, worldHeight);
    }
    
    // Draw world border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeRect(0, 0, worldWidth, worldHeight);
    
    // Draw money (with culling)
    money.forEach(m => {
        if (m.x > visibleLeft && m.x < visibleRight && m.y > visibleTop && m.y < visibleBottom) {
            m.draw(ctx);
        }
    });
    
    // Draw snakes (with culling)
    snakes.forEach(snake => {
        if (snake.alive) {
            // Check if snake head is visible or close enough
            if (snake.x > visibleLeft && snake.x < visibleRight && snake.y > visibleTop && snake.y < visibleBottom) {
                snake.draw(ctx);
            }
        }
    });
    
    // Restore context
    ctx.restore();
}


function updateGameUI() {
    if (!playerSnake) return;
    
    document.getElementById('greenMoneyCount').textContent = Math.floor(playerSnake.greenMoney);
    document.getElementById('yellowMoneyCountGame').textContent = gameState.yellowMoney;
    
    document.getElementById('sizeLevel').textContent = playerSnake.sizeLevel;
    document.getElementById('speedLevel').textContent = playerSnake.speedLevel;
    document.getElementById('multiplierLevel').textContent = playerSnake.multiplierLevel;
    
    document.getElementById('sizeCost').textContent = playerSnake.getUpgradeCost('size');
    document.getElementById('speedCost').textContent = playerSnake.getUpgradeCost('speed');
    document.getElementById('multiplierCost').textContent = playerSnake.getUpgradeCost('multiplier');
    
    document.getElementById('upgradeSize').disabled = 
        playerSnake.sizeLevel >= 20 || playerSnake.greenMoney < playerSnake.getUpgradeCost('size');
    document.getElementById('upgradeSpeed').disabled = 
        playerSnake.speedLevel >= 15 || playerSnake.greenMoney < playerSnake.getUpgradeCost('speed');
    document.getElementById('upgradeMultiplier').disabled = 
        playerSnake.multiplierLevel >= 20 || playerSnake.greenMoney < playerSnake.getUpgradeCost('multiplier');
}

function gameOver() {
    gameState.gameRunning = false;
    cancelAnimationFrame(gameLoop);
    
    setTimeout(() => {
        gameScreen.classList.remove('active');
        startScreen.classList.add('active');
        updateYellowMoneyDisplay();
    }, 2000);
}

function getRandomColor() {
    const colors = ['#ff0000', '#00ffff', '#ff00ff', '#ffff00', '#ff8800', '#0088ff'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function getRandomBotName() {
    // 0.1% chance for Hog Rider (0.001 chance)
    if (Math.random() < 0.001) {
        return 'Hog Rider';
    }
    
    const prefixes = ['Cool', 'Mega', 'Ultra', 'Pro', 'Epic', 'Shadow', 'Ninja', 'Dragon', 'Thunder', 'Cyber'];
    const middles = ['Gamer', 'Snake', 'Hunter', 'Master', 'King', 'Slayer', 'Beast', 'Player', 'Eater', 'Legend'];
    const suffixes = ['X', '42', 'Pro', 'Max', 'Elite', 'God', 'Boss', 'Star', 'Ace', 'Supreme'];
    
    const nameTypes = Math.random();
    
    if (nameTypes < 0.4) {
        // CoolGamer42 style
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const middle = middles[Math.floor(Math.random() * middles.length)];
        const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        return `${prefix}${middle}${suffix}`;
    } else if (nameTypes < 0.7) {
        // coolsnakeX style
        const middle = middles[Math.floor(Math.random() * middles.length)];
        const number = Math.floor(Math.random() * 999) + 1;
        return `${middle.toLowerCase()}${number}`;
    } else {
        // prefix + middle style
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const middle = middles[Math.floor(Math.random() * middles.length)];
        return `${prefix}${middle}`;
    }
}

// Snake Class
class Snake {
    constructor(x, y, color, isPlayer, name, skin = null) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.isPlayer = isPlayer;
        this.name = name;
        this.alive = true;
        this.isBot = false;
        this.difficulty = 'easy';
        this.skin = skin; // Skin object with type and color
        this.skinColor = skin ? (skin.color || color) : color;
        
        this.dx = 1;
        this.dy = 0;
        this.size = 15; // Base size (grows slower with upgrades)
        this.speed = 100; // pixels per second
        this.body = [{ x, y }];
        
        // Money
        this.greenMoney = 0;
        this.yellowMoney = 0;
        
        // Upgrades
        this.sizeLevel = 1;
        this.speedLevel = 1;
        this.multiplierLevel = 1;
        this.multiplier = 1;
        
        // Initialize body to be longer at start
        for (let i = 1; i < 10; i++) {
            this.body.push({ x: x - i * 15, y: y });
        }
    }
    
    setDirection(dx, dy, allowReverse = false) {
        // Normalize direction vector
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.01) {
            // If no direction, don't change current direction (allow stopping at borders)
            return;
        }
        
        const normalizedDx = dx / length;
        const normalizedDy = dy / length;
        
        // Prevent reversing into body only if we have a body (unless this is keyboard input)
        if (!allowReverse && this.body.length > 1) {
            const secondSegment = this.body[1];
            const currentDirX = this.x - secondSegment.x;
            const currentDirY = this.y - secondSegment.y;
            const currentLength = Math.sqrt(currentDirX * currentDirX + currentDirY * currentDirY);
            
            if (currentLength > 0.1) {
                const currentNormX = currentDirX / currentLength;
                const currentNormY = currentDirY / currentLength;
                
                // Check if new direction is opposite to current direction
                const dot = normalizedDx * currentNormX + normalizedDy * currentNormY;
                if (dot < -0.99) {
                    return; // Don't reverse (only if nearly exactly 180 degrees)
                }
            }
        }
        
        // Always allow direction change - set normalized direction
        this.dx = normalizedDx;
        this.dy = normalizedDy;
    }
    
    update(deltaTime, worldWidth, worldHeight) {
        if (!this.alive) return;
        
        const moveDistance = (this.speed * deltaTime) / 1000;
        let newX = this.x;
        let newY = this.y;
        
        // Try to move in X direction
        if (this.dx !== 0) {
            newX = this.x + this.dx * moveDistance;
            // Check if new position would hit border
            if (newX - this.size < 0) {
                newX = this.size; // Clamp to border
                // Only stop if still trying to move in that direction
                if (this.dx < 0) {
                    this.dx = 0; // Stop horizontal movement
                }
            } else if (newX + this.size > worldWidth) {
                newX = worldWidth - this.size; // Clamp to border
                // Only stop if still trying to move in that direction
                if (this.dx > 0) {
                    this.dx = 0; // Stop horizontal movement
                }
            }
            this.x = newX;
        }
        
        // Try to move in Y direction
        if (this.dy !== 0) {
            newY = this.y + this.dy * moveDistance;
            // Check if new position would hit border
            if (newY - this.size < 0) {
                newY = this.size; // Clamp to border
                // Only stop if still trying to move in that direction
                if (this.dy < 0) {
                    this.dy = 0; // Stop vertical movement
                }
            } else if (newY + this.size > worldHeight) {
                newY = worldHeight - this.size; // Clamp to border
                // Only stop if still trying to move in that direction
                if (this.dy > 0) {
                    this.dy = 0; // Stop vertical movement
                }
            }
            this.y = newY;
        }
        
        // Update body
        this.body.unshift({ x: this.x, y: this.y });
        
        // Keep body length based on size level (size upgrade affects length)
        // Start longer (10), and each level adds more length
        const bodyLength = 10 + this.sizeLevel * 5;
        if (this.body.length > bodyLength) {
            this.body.pop();
        }
    }
    
    draw(ctx) {
        if (!this.alive) return;
        
        // Determine if this is a ball or vector snake
        const isBallSkin = !this.skin || this.skin.type === 'ball';
        const isVectorSkin = this.skin && this.skin.type === 'vector';
        const drawColor = this.skinColor || this.color;
        
        if (isBallSkin) {
            // Draw body with fade effect
            ctx.fillStyle = drawColor;
            this.body.forEach((segment, index) => {
                const alpha = 1 - (index / this.body.length) * 0.5;
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.arc(segment.x, segment.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalAlpha = 1;
            
            // Draw head
            ctx.fillStyle = drawColor;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else if (isVectorSkin) {
            // Draw vector snake - triangular segments
            ctx.fillStyle = '#FF8C00';
            this.body.forEach((segment, index) => {
                const alpha = 1 - (index / this.body.length) * 0.5;
                ctx.globalAlpha = alpha;
                
                // Draw triangle pointing in direction
                const angle = Math.atan2(this.dy, this.dx);
                ctx.save();
                ctx.translate(segment.x, segment.y);
                ctx.rotate(angle);
                
                ctx.beginPath();
                ctx.moveTo(this.size, 0);
                ctx.lineTo(-this.size * 0.5, -this.size * 0.8);
                ctx.lineTo(-this.size * 0.5, this.size * 0.8);
                ctx.closePath();
                ctx.fill();
                
                ctx.restore();
            });
            ctx.globalAlpha = 1;
            
            // Draw head
            const angle = Math.atan2(this.dy, this.dx);
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(angle);
            
            ctx.fillStyle = '#FF8C00';
            ctx.beginPath();
            ctx.moveTo(this.size, 0);
            ctx.lineTo(-this.size * 0.5, -this.size * 0.8);
            ctx.lineTo(-this.size * 0.5, this.size * 0.8);
            ctx.closePath();
            ctx.fill();
            
            // Head outline
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Draw eye
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(this.size * 0.5, -this.size * 0.3, 2, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
        }
        
        // Draw name
        if (this.isPlayer || this.isBot) {
            ctx.fillStyle = '#fff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(this.name, this.x, this.y - this.size - 10);
        }
    }
    
    getUpgradeCost(type) {
        if (type === 'size') {
            return 10 * Math.pow(1.5, this.sizeLevel - 1);
        } else if (type === 'speed') {
            return 10 * Math.pow(1.5, this.speedLevel - 1);
        } else if (type === 'multiplier') {
            return 15 * Math.pow(2, this.multiplierLevel - 1);
        }
        return 0;
    }
    
    buyUpgrade(type, isPlayer = true) {
        const cost = this.getUpgradeCost(type);
        if (this.greenMoney < cost) return false;
        
        if (type === 'size' && this.sizeLevel < 20) {
            this.greenMoney -= cost;
            this.sizeLevel++;
            // Size upgrade makes snake longer (body length) and a bit bigger (radius grows slower)
            // Radius grows slowly: base 15, +1 per level
            this.size = 15 + (this.sizeLevel - 1) * 1;
            // Camera zoom out when size increases (very slightly) - ONLY FOR PLAYER
            if (isPlayer) {
                camera.zoom = Math.max(0.5, camera.zoom - 0.03);
            }
            return true;
        } 
        
        if (type === 'speed' && this.speedLevel < 15) {
            this.greenMoney -= cost;
            this.speedLevel++;
            this.speed = 100 + (this.speedLevel - 1) * 20;
            return true;
        } 
        
        if (type === 'multiplier' && this.multiplierLevel < 20) {
            this.greenMoney -= cost;
            this.multiplierLevel++;
            this.multiplier = this.multiplierLevel;
            return true;
        }
        
        return false;
    }
    
    autoBuyUpgrade() {
        if (!this.isBot) return;
        
        // Bots auto-buy upgrades
        const upgrades = ['size', 'speed', 'multiplier'];
        const randomUpgrade = upgrades[Math.floor(Math.random() * upgrades.length)];
        
        if (this.greenMoney >= this.getUpgradeCost(randomUpgrade)) {
            this.buyUpgrade(randomUpgrade, false);  // false = bot purchase, don't zoom
        }
    }
}

// Money Class
class Money {
    constructor(x, y, type, value) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.value = value;
        this.size = type === 'green' ? 8 : 10;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 0.02;
    }
    
    update() {
        this.rotation += this.rotationSpeed;
    }
    
    draw(ctx) {
        this.update();
        
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        
        if (this.type === 'green') {
            ctx.fillStyle = '#00ff00';
        } else {
            ctx.fillStyle = '#FFD700';
        }
        
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Draw $ symbol
        ctx.fillStyle = '#000';
        ctx.font = `${this.size * 1.2}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 0);
        
        ctx.restore();
    }
}
