import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { DialogueRenderer } from '../systems/DialogueRenderer';
import { SaveManager, SaveData, HeroState, SaveSlotPreview } from '../systems/SaveManager';
import { BattleXPSummary } from '../systems/XPTracker';
import { LevelUpOverlay } from '../components/LevelUpOverlay';
import { InventoryState, ChestState, createDefaultInventory } from '../data/ItemTypes';

interface NPC {
  id: string;
  name: string;
  gridX: number;
  gridY: number;
  sprite: Phaser.GameObjects.Sprite;
  dialogue: string[];
  portrait?: string;
}

/**
 * IshetarScene2 - Post-South Gate battle Ishetar town scene
 * Player enters from the south gate with updated NPC dialogues
 */
export class IshetarScene2 extends Phaser.Scene {
  private mapImage!: Phaser.GameObjects.Image;
  private player!: Phaser.GameObjects.Sprite;
  private playerGridX: number = 20;
  private playerGridY: number = 18; // Start at south gate (new map)
  private playerFacing: 'front' | 'back' | 'left' | 'right' = 'back';
  private heroId: string = 'vicas';

  private npcs: NPC[] = [];
  private dialogueRenderer!: DialogueRenderer;
  private isInDialogue: boolean = false;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private isMoving: boolean = false;

  // Map dimensions (same as ishetar_town)
  private mapGridWidth: number = 32;
  private mapGridHeight: number = 32;

  // Terrain data (loaded from ishetar_town)
  private terrain: number[][] = [];

  // Game state
  private heroState: Record<string, HeroState> = {};
  private gameFlags: Record<string, boolean> = {};
  private playTime: number = 0;
  private sessionStartTime: number = 0;
  private inventory: InventoryState = createDefaultInventory();
  private chestStates: Record<string, ChestState> = {};

  // Menu scene (ESC key)
  private escKey!: Phaser.Input.Keyboard.Key;

  // Hrothgar combat guide callback
  private pendingHrothgarDialogue: boolean = false;

  // Choice menu state
  private choiceMenuContainer!: Phaser.GameObjects.Container;
  private choiceMenuVisible: boolean = false;
  private choiceMenuOptions: string[] = [];
  private choiceMenuSelectedIndex: number = 0;
  private choiceMenuTexts: Phaser.GameObjects.Text[] = [];

  // Dev mode flag (affects trigger marker color)
  private devMode: boolean = false;
  private choiceMenuCallback?: (choice: string) => void;

  // Save slot selection
  private selectedSaveSlot: number = 1;
  private saveSlotPreviews: SaveSlotPreview[] = [];

  // Level up overlay
  private levelUpOverlay: LevelUpOverlay | null = null;

  constructor() {
    super({ key: 'IshetarScene2' });
  }

  create(data: {
    heroId?: string;
    heroState?: Record<string, HeroState>;
    gameFlags?: Record<string, boolean>;
    playTime?: number;
    devMode?: boolean;
    levelUps?: BattleXPSummary[];
    inventory?: InventoryState;
    chests?: Record<string, ChestState>;
    saveData?: SaveData;
  }): void {
    // Reset state to ensure clean scene restart
    this.isInDialogue = false;
    this.isMoving = false;
    this.choiceMenuVisible = false;
    this.npcs = [];

    // Start town music (stop any previous music first)
    this.sound.stopAll();
    this.sound.play('music_town', { loop: true, volume: 0.5 });

    this.heroId = data.heroId || 'vicas';
    this.heroState = data.heroState || {};
    this.gameFlags = data.gameFlags || {};
    this.playTime = data.playTime || 0;
    this.sessionStartTime = Date.now();
    this.devMode = data.devMode || false;

    // Load inventory from saveData if present, otherwise from passed data or default
    if (data.saveData) {
      this.inventory = data.saveData.inventory || createDefaultInventory();
      this.chestStates = data.saveData.chests || {};
      // Also load other state from saveData if not already set
      if (!data.heroState && data.saveData.heroState) {
        this.heroState = data.saveData.heroState;
      }
      if (!data.gameFlags && data.saveData.flags) {
        this.gameFlags = data.saveData.flags;
      }
      if (!data.playTime && data.saveData.playTime) {
        this.playTime = data.saveData.playTime;
      }
    } else {
      this.inventory = data.inventory || createDefaultInventory();
      this.chestStates = data.chests || {};
    }

    // Load terrain from the original map data
    const mapData = this.cache.json.get('data_map_ishetar');
    if (mapData) {
      // Deep copy terrain so we can modify it for post-battle state
      this.terrain = mapData.terrain.map((row: number[]) => [...row]);
      this.mapGridWidth = mapData.gridWidth;
      this.mapGridHeight = mapData.gridHeight;

      // Make north gate tiles walkable (they were blocked in pre-battle)
      // New map: trigger at (13-14, 1-2)
      this.terrain[1][13] = 0;
      this.terrain[1][14] = 0;
      this.terrain[2][13] = 0;
      this.terrain[2][14] = 0;
    }

    // Setup
    this.setupMap();
    this.setupInput();
    this.placeNPCs();
    this.createPlayer();
    this.setupCamera();

    // Initialize dialogue renderer - positioned relative to player
    this.dialogueRenderer = new DialogueRenderer(this);
    // Don't use scrollFactor(0) - we'll position relative to player instead

    // Create choice menu (hidden initially)
    this.createChoiceMenu();

    // Setup ESC key for menu
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // Show level-up screen if returning from battle with level ups
    if (data.levelUps && data.levelUps.length > 0) {
      this.time.delayedCall(100, () => {
        this.showLevelUpScreen(data.levelUps!);
      });
    }

    // Listen for resume event (returning from MenuScene)
    this.events.on('resume', () => {
      if (this.pendingHrothgarDialogue) {
        this.pendingHrothgarDialogue = false;
        this.time.delayedCall(100, () => {
          this.showHrothgarEndingDialogue();
        });
      }
    });
  }

  private setupMap(): void {
    this.mapImage = this.add.image(0, 0, 'map_ishetar_town');
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setScale(0.5);

    // Draw grid overlay
    this.drawGridOverlay();

    // DEBUG: Draw yellow boxes around trigger tiles
    this.drawDebugTriggers();
  }

  private drawGridOverlay(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, GAME_CONFIG.GRID_COLOR, GAME_CONFIG.GRID_ALPHA);

    const mapWidth = this.mapGridWidth * GAME_CONFIG.TILE_SIZE;
    const mapHeight = this.mapGridHeight * GAME_CONFIG.TILE_SIZE;

    // Draw vertical lines
    for (let x = 0; x <= this.mapGridWidth; x++) {
      const pixelX = x * GAME_CONFIG.TILE_SIZE;
      graphics.moveTo(pixelX, 0);
      graphics.lineTo(pixelX, mapHeight);
    }

    // Draw horizontal lines
    for (let y = 0; y <= this.mapGridHeight; y++) {
      const pixelY = y * GAME_CONFIG.TILE_SIZE;
      graphics.moveTo(0, pixelY);
      graphics.lineTo(mapWidth, pixelY);
    }

    graphics.strokePath();
  }

  private drawDebugTriggers(): void {
    const tileSize = GAME_CONFIG.TILE_SIZE;
    const cornerLength = 8;
    const halfTile = tileSize / 2;

    // Dev mode: bright yellow for visibility
    // Player mode: light gray with grow/shrink animation
    const color = this.devMode ? 0xffff00 : 0xb0b0b0;
    const alpha = this.devMode ? 0.9 : 0.85;

    // North gate trigger tiles (just the bottom row)
    const northGateTiles = [
      { x: 13, y: 2 }, { x: 14, y: 2 },
    ];

    for (const tile of northGateTiles) {
      // Create a graphics object for each tile, centered on the tile
      const graphics = this.add.graphics();
      const centerX = tile.x * tileSize + halfTile;
      const centerY = tile.y * tileSize + halfTile;
      graphics.setPosition(centerX, centerY);

      graphics.lineStyle(2, color, alpha);

      // Draw corner brackets relative to center (-halfTile to +halfTile)
      // Top-left corner
      graphics.moveTo(-halfTile, -halfTile + cornerLength);
      graphics.lineTo(-halfTile, -halfTile);
      graphics.lineTo(-halfTile + cornerLength, -halfTile);
      // Top-right corner
      graphics.moveTo(halfTile - cornerLength, -halfTile);
      graphics.lineTo(halfTile, -halfTile);
      graphics.lineTo(halfTile, -halfTile + cornerLength);
      // Bottom-right corner
      graphics.moveTo(halfTile, halfTile - cornerLength);
      graphics.lineTo(halfTile, halfTile);
      graphics.lineTo(halfTile - cornerLength, halfTile);
      // Bottom-left corner
      graphics.moveTo(-halfTile + cornerLength, halfTile);
      graphics.lineTo(-halfTile, halfTile);
      graphics.lineTo(-halfTile, halfTile - cornerLength);

      graphics.strokePath();

      // Add grow/shrink animation (player mode only)
      if (!this.devMode) {
        this.tweens.add({
          targets: graphics,
          scale: { from: 0.95, to: 1.05 },
          duration: 800,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
        });
      }
    }
  }

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
  }

  private setupCamera(): void {
    const mapWidth = this.mapGridWidth * GAME_CONFIG.TILE_SIZE;
    const mapHeight = this.mapGridHeight * GAME_CONFIG.TILE_SIZE;

    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.5);
  }

  // Position dialogue relative to player (left side of visible viewport)
  private positionDialogueForPlayer(): void {
    const playerWorldX = this.playerGridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const playerWorldY = this.playerGridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

    // Offset from player: left and slightly above center to avoid bottom cutoff
    this.dialogueRenderer.positionRelativeTo(playerWorldX, playerWorldY, -180, -20);
  }

  private placeNPCs(): void {
    // Post-battle NPC dialogues - positions match ishetar_new map
    const npcData = [
      {
        id: 'meris', name: 'Meris', x: 22, y: 5,
        sprite: 'sprite_meris_front',
        dialogue: [
          "I was so foolish to come alone. But I had to find help for my family.",
          "My husband took my two oldest to pay respects at Old Quetzi's Shrine.",
          "But they should have been home two days ago..."
        ]
      },
      {
        id: 'rowena', name: 'Lady Rowena', x: 21, y: 5,
        sprite: 'sprite_rowena_front',
        dialogue: [
          "Ishetar is a safe haven for everyone. We have to help poor Meris and her family.",
          "Please, travel to the North Gate and see what you can do.",
          "Don't forget to burn an offering, and talk to Hrothgar if you need combat advice."
        ]
      },
      {
        id: 'guard_north', name: 'Town Guard', x: 14, y: 3,
        sprite: 'sprite_guard_front',
        dialogue: [
          "Lady Rowena said you'd be going on a rescue mission. You're so brave!",
          "I recommend taking the old hunting paths. The cliffs are full of harpies this time of year!",
          "Steer clear of the Red Vale though. It's much too dangerous!"
        ]
      },
      {
        id: 'guard_east', name: 'Town Guard', x: 25, y: 11,
        sprite: 'sprite_guard_front',
        dialogue: [
          "The south gate is secure again, thanks to you.",
          "But I wonder... where did those creatures come from?"
        ]
      },
      {
        id: 'pelor', name: 'Shrine', x: 8, y: 4,
        sprite: 'sprite_pelor_front',
        dialogue: [
          "*You burn your offering at the shrine. You find yourself fully rested.*"
        ]
      },
      {
        id: 'villager_male', name: 'Baker', x: 9, y: 9,
        sprite: 'sprite_villager_male_front',
        dialogue: [
          "He may be surly, but Vicas is the best medic I've ever seen.",
          "We're so lucky he chose to make Ishetar home."
        ]
      },
      {
        id: 'villager_female', name: 'Gertrude', x: 9, y: 15,
        sprite: 'sprite_villager_female_front',
        dialogue: [
          "Oh, what a terrible fright! And that young lady had a little one with her!",
          "She'll be in need of one of Miss Lyra's special cups of tea!"
        ]
      },
      {
        id: 'child_male', name: 'Young Boy', x: 15, y: 18,
        sprite: 'sprite_child_male_front',
        dialogue: [
          "Did you really fight those monsters?! Wow!",
          "I bet Azrael got em all by himself! I hear their daggers are invisible!"
        ]
      },
      {
        id: 'child_female', name: 'Young Girl', x: 22, y: 15,
        sprite: 'sprite_child_female_front',
        dialogue: [
          "When I grow up, I want to learn magic!",
          "But maybe not from Rooker... he's kind of scary!"
        ]
      },
      {
        id: 'hrothgar', name: 'Hrothgar', x: 12, y: 15,
        sprite: 'sprite_villager_male_front',
        dialogue: [
          "I may be an old veteran, but I can still help you learn combat tactics!",
          "And be sure to bring me any equipment you find. I can help you attune to it."
        ]
      },
      {
        id: 'sombra', name: 'Sombra', x: 20, y: 3,
        sprite: 'sprite_sombra_front',
        dialogue: [
          "Devils. At the gate. I admit to being curious, but not this close..."
        ]
      },
    ];

    npcData.forEach(npc => {
      const pixelX = npc.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const pixelY = npc.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

      const sprite = this.add.sprite(pixelX, pixelY, npc.sprite);
      sprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);

      const portraitKey = `portrait_${npc.id}`;

      this.npcs.push({
        id: npc.id,
        name: npc.name,
        gridX: npc.x,
        gridY: npc.y,
        sprite,
        dialogue: npc.dialogue,
        portrait: this.textures.exists(portraitKey) ? portraitKey : undefined,
      });
    });

    // Place hero party members
    const heroDialogues: Record<string, string[]> = {
      vicas: ["We were lucky. That young lady and her baby could have been killed."],
      rooker: ["Fascinating creatures...I wonder what drew them here."],
      lyra: ["Light can heal or it can blind. Those devils learned the difference."],
      azrael: ["Heh. That was a good warm-up. When's the real fight?"],
      thump: ["The spirits are uneasy. Something feels very wrong..."],
    };

    const heroNames: Record<string, string> = {
      vicas: 'Vicas', rooker: 'Rooker', lyra: 'Lyra', azrael: 'Azrael', thump: 'Thump',
    };

    const heroPositions = [
      { x: 17, y: 10 }, { x: 19, y: 10 }, { x: 17, y: 12 }, { x: 19, y: 12 }
    ];

    const allHeroes = ['vicas', 'azrael', 'lyra', 'thump', 'rooker'];
    const partyHeroes = allHeroes.filter(h => h !== this.heroId);

    partyHeroes.forEach((heroId, index) => {
      if (index >= heroPositions.length) return;

      const pos = heroPositions[index];
      const pixelX = pos.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const pixelY = pos.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

      const sprite = this.add.sprite(pixelX, pixelY, `sprite_${heroId}_front`);
      sprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);

      this.npcs.push({
        id: heroId,
        name: heroNames[heroId],
        gridX: pos.x,
        gridY: pos.y,
        sprite,
        dialogue: heroDialogues[heroId] || ["..."],
        portrait: `portrait_${heroId}`,
      });
    });
  }

  private createPlayer(): void {
    const pixelX = this.playerGridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const pixelY = this.playerGridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

    this.player = this.add.sprite(pixelX, pixelY, `sprite_${this.heroId}_${this.playerFacing}`);
    this.player.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);
  }

  private updatePlayerSprite(): void {
    this.player.setTexture(`sprite_${this.heroId}_${this.playerFacing}`);
  }

  private isPassable(gridX: number, gridY: number): boolean {
    if (gridX < 0 || gridX >= this.mapGridWidth) return false;
    if (gridY < 0 || gridY >= this.mapGridHeight) return false;

    const terrainValue = this.terrain[gridY]?.[gridX];
    if (terrainValue === 2) return false;

    const npcBlocking = this.npcs.some(npc => npc.gridX === gridX && npc.gridY === gridY);
    if (npcBlocking) return false;

    return true;
  }

  private movePlayer(dx: number, dy: number): void {
    if (this.isMoving || this.isInDialogue) return;

    const newGridX = this.playerGridX + dx;
    const newGridY = this.playerGridY + dy;

    // Update facing direction
    if (dx > 0) this.playerFacing = 'right';
    else if (dx < 0) this.playerFacing = 'left';
    else if (dy > 0) this.playerFacing = 'front';
    else if (dy < 0) this.playerFacing = 'back';

    this.updatePlayerSprite();

    if (!this.isPassable(newGridX, newGridY)) return;

    this.isMoving = true;
    this.playerGridX = newGridX;
    this.playerGridY = newGridY;

    const targetX = newGridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const targetY = newGridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

    this.tweens.add({
      targets: this.player,
      x: targetX,
      y: targetY,
      duration: 150,
      ease: 'Linear',
      onComplete: () => {
        this.isMoving = false;
        this.checkTriggers();
      },
    });
  }

  private checkTriggers(): void {
    // North gate trigger - just the bottom row tiles at the north exit
    const northGateTiles = [
      { x: 13, y: 2 }, { x: 14, y: 2 },
    ];

    const onNorthGate = northGateTiles.some(
      tile => tile.x === this.playerGridX && tile.y === this.playerGridY
    );

    if (onNorthGate) {
      this.goToTravelMap();
    }
  }

  private goToTravelMap(): void {
    this.scene.start('TravelScene', {
      heroId: this.heroId,
      heroState: this.heroState,
      gameFlags: this.gameFlags,
      playTime: this.playTime,
      inventory: this.inventory,
      chests: this.chestStates,
      devMode: this.devMode,
    });
  }

  // ============================================================================
  // Choice Menu System
  // ============================================================================

  private createChoiceMenu(): void {
    this.choiceMenuContainer = this.add.container(0, 0);
    // Don't use setScrollFactor(0) - we'll position relative to player like dialogue
    this.choiceMenuContainer.setVisible(false);
    this.choiceMenuContainer.setDepth(1000);
  }

  // Position choice menu relative to player (near dialogue box)
  private positionChoiceMenuForPlayer(): void {
    const playerWorldX = this.playerGridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const playerWorldY = this.playerGridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    // Position above and to the right of player to avoid bottom cutoff
    this.choiceMenuContainer.setPosition(playerWorldX + 50, playerWorldY - 80);
  }

  private showChoiceMenu(options: string[], callback: (choice: string) => void): void {
    this.choiceMenuOptions = options;
    this.choiceMenuCallback = callback;
    this.choiceMenuSelectedIndex = 0;
    this.choiceMenuVisible = true;

    // Clear previous menu items
    this.choiceMenuContainer.removeAll(true);
    this.choiceMenuTexts = [];

    const menuX = 0;
    const menuY = 0;
    const itemHeight = 20;
    const padding = 8;

    // Create text objects first to measure width
    const tempTexts: Phaser.GameObjects.Text[] = [];
    options.forEach((option, index) => {
      const text = this.add.text(
        menuX + padding,
        menuY + padding + index * itemHeight,
        '  ' + option, // Add space for selection indicator
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: index === 0 ? '#ffff00' : '#ffffff',
        }
      );
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      tempTexts.push(text);
    });

    // Calculate menu width based on longest option
    const maxTextWidth = Math.max(...tempTexts.map(t => t.width));
    const menuWidth = Math.max(110, maxTextWidth + padding * 2);
    const menuHeight = options.length * itemHeight + padding * 2;

    // Draw background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.9);
    bg.fillRoundedRect(menuX, menuY, menuWidth, menuHeight, 6);
    bg.lineStyle(2, 0xffffff, 1);
    bg.strokeRoundedRect(menuX, menuY, menuWidth, menuHeight, 6);
    this.choiceMenuContainer.add(bg);

    // Add the text objects to container
    tempTexts.forEach((text) => {
      this.choiceMenuTexts.push(text);
      this.choiceMenuContainer.add(text);
    });

    // Position relative to player and show
    this.positionChoiceMenuForPlayer();
    this.updateChoiceMenuSelection();
    this.choiceMenuContainer.setVisible(true);
  }

  private updateChoiceMenuSelection(): void {
    this.choiceMenuTexts.forEach((text, index) => {
      if (index === this.choiceMenuSelectedIndex) {
        text.setColor('#ffff00');
        text.setText('> ' + this.choiceMenuOptions[index]);
      } else {
        text.setColor('#ffffff');
        text.setText('  ' + this.choiceMenuOptions[index]);
      }
    });
  }

  private hideChoiceMenu(): void {
    this.choiceMenuContainer.setVisible(false);
    this.choiceMenuVisible = false;
    this.isInDialogue = false;
  }

  private selectChoiceMenuOption(): void {
    const selectedOption = this.choiceMenuOptions[this.choiceMenuSelectedIndex];
    this.hideChoiceMenu();
    if (this.choiceMenuCallback) {
      this.choiceMenuCallback(selectedOption);
    }
  }

  // ============================================================================
  // Shrine Save System
  // ============================================================================

  private handleShrineInteraction(npc: NPC): void {
    // Restore all heroes to full HP/Mana/Ki immediately
    this.heroState = SaveManager.restoreAllResources(this.heroState);

    // Show shrine dialogue, then offer save choice
    this.positionDialogueForPlayer();
    this.dialogueRenderer.startDialogue(
      [...npc.dialogue, "Would you like to record your progress for the bards?"],
      npc.name,
      () => {
        this.showShrineSaveMenu();
      },
      npc.portrait
    );
  }

  private showShrineSaveMenu(): void {
    this.showChoiceMenu(['Yes', 'No'], (choice) => {
      if (choice === 'Yes') {
        this.showSaveSlotSelection();
      }
      // Either way, close dialogue (resources already restored)
    });
  }

  private formatPlayTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  private getHeroDisplayName(heroId: string): string {
    const names: Record<string, string> = {
      vicas: 'Vicas',
      azrael: 'Azrael',
      thump: 'Thump',
    };
    return names[heroId] || heroId;
  }

  private showSaveSlotSelection(): void {
    // Get current state of all save slots
    this.saveSlotPreviews = SaveManager.getAllSlotPreviews();

    // Build slot options
    const options: string[] = this.saveSlotPreviews.map((preview) => {
      if (preview.isEmpty) {
        return `Slot ${preview.slot}: [Empty]`;
      } else {
        const heroName = this.getHeroDisplayName(preview.mainHero || 'unknown');
        const level = preview.heroLevels?.[0] || 1;
        const time = this.formatPlayTime(preview.playTime || 0);
        return `Slot ${preview.slot}: ${heroName} Lv${level} ${time}`;
      }
    });
    options.push('Cancel');

    this.showChoiceMenu(options, (choice) => {
      if (choice === 'Cancel') {
        return; // User cancelled
      }

      // Extract slot number from choice (e.g., "Slot 1: ..." -> 1)
      const slotMatch = choice.match(/^Slot (\d+):/);
      if (!slotMatch) return;

      this.selectedSaveSlot = parseInt(slotMatch[1], 10);
      const preview = this.saveSlotPreviews.find(p => p.slot === this.selectedSaveSlot);

      if (preview && !preview.isEmpty) {
        // Slot is occupied - ask for confirmation
        this.showOverwriteConfirmation();
      } else {
        // Slot is empty - save directly
        this.saveGame(this.selectedSaveSlot);
      }
    });
  }

  private showOverwriteConfirmation(): void {
    const preview = this.saveSlotPreviews.find(p => p.slot === this.selectedSaveSlot);
    const heroName = this.getHeroDisplayName(preview?.mainHero || 'unknown');

    this.isInDialogue = true;
    this.positionDialogueForPlayer();
    this.dialogueRenderer.startDialogue(
      [`Overwrite ${heroName}'s tale in Slot ${this.selectedSaveSlot}?`],
      'Shrine',
      () => {
        this.showChoiceMenu(['Yes', 'No'], (choice) => {
          if (choice === 'Yes') {
            this.saveGame(this.selectedSaveSlot);
          }
          // If No, just return without saving
        });
      }
    );
  }

  private saveGame(slot: number): void {
    // Calculate current play time (existing + this session)
    const sessionSeconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const totalPlayTime = this.playTime + sessionSeconds;

    const saveData: SaveData = {
      slot: slot,
      mainHero: this.heroId,
      currentMap: 'ishetar_town_post_battle',
      playerPosition: { x: this.playerGridX, y: this.playerGridY },
      playTime: totalPlayTime,
      heroState: this.heroState,
      flags: { ...this.gameFlags, south_gate_battle_complete: true },
      timestamp: new Date().toISOString(),
      inventory: this.inventory,
      chests: this.chestStates,
    };

    const success = SaveManager.save(saveData);

    if (success) {
      // Update our tracked play time to include this session
      this.playTime = totalPlayTime;
      this.sessionStartTime = Date.now(); // Reset session start

      // Show confirmation
      this.isInDialogue = true;
      this.positionDialogueForPlayer();
      this.dialogueRenderer.startDialogue(
        ['*Your progress has been recorded by the bards.*'],
        'Shrine',
        () => {
          this.isInDialogue = false;
        }
      );
    } else {
      // Show error
      this.isInDialogue = true;
      this.positionDialogueForPlayer();
      this.dialogueRenderer.startDialogue(
        ['*The bards seem distracted. Your progress could not be recorded.*'],
        'Shrine',
        () => {
          this.isInDialogue = false;
        }
      );
    }
  }

  // ============================================================================
  // Hrothgar Combat Guide
  // ============================================================================

  private showHrothgarEndingDialogue(): void {
    this.isInDialogue = true;
    this.positionDialogueForPlayer();
    this.dialogueRenderer.startDialogue(
      ["Now get out there and show those demons what ya got!"],
      'Hrothgar',
      () => {
        this.isInDialogue = false;
      }
    );
  }

  private tryInteract(): void {
    if (this.isInDialogue) {
      if (this.dialogueRenderer.isDialogueActive()) {
        this.dialogueRenderer.advance();
      }
      return;
    }

    // Find adjacent NPC
    const facingOffsets: Record<string, { x: number; y: number }> = {
      front: { x: 0, y: 1 },
      back: { x: 0, y: -1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };

    const offset = facingOffsets[this.playerFacing];
    const targetX = this.playerGridX + offset.x;
    const targetY = this.playerGridY + offset.y;

    const npc = this.npcs.find(n => n.gridX === targetX && n.gridY === targetY);
    if (npc) {
      this.startNPCDialogue(npc);
    }
  }

  private startNPCDialogue(npc: NPC): void {
    this.isInDialogue = true;
    this.positionDialogueForPlayer();

    // Special handling for shrine - restore and offer save
    if (npc.id === 'pelor') {
      this.handleShrineInteraction(npc);
      return;
    }

    // Special handling for Hrothgar - show Hrothgar's services menu after dialogue
    if (npc.id === 'hrothgar') {
      this.dialogueRenderer.startDialogue(npc.dialogue, npc.name, () => {
        this.isInDialogue = false;
        this.pendingHrothgarDialogue = true;
        this.scene.pause();
        this.scene.launch('MenuScene', {
          heroState: this.heroState,
          returnScene: 'IshetarScene2',
          initialView: 'hrothgar',
          inventory: this.inventory,
        });
      }, npc.portrait);
      return;
    }

    this.dialogueRenderer.startDialogue(npc.dialogue, npc.name, () => {
      this.isInDialogue = false;
    }, npc.portrait);
  }

  update(): void {
    // Handle level up overlay input
    if (this.levelUpOverlay && this.levelUpOverlay.isWaitingForInput()) {
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.levelUpOverlay.handleInput();
      }
      return; // Block other input while overlay is active
    }

    // Handle ESC key to open menu
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.pause();
      this.scene.launch('MenuScene', {
        heroState: this.heroState,
        returnScene: 'IshetarScene2',
        inventory: this.inventory,
      });
      return;
    }

    // Handle choice menu input
    if (this.choiceMenuVisible) {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
        this.choiceMenuSelectedIndex = Math.max(0, this.choiceMenuSelectedIndex - 1);
        this.updateChoiceMenuSelection();
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
        this.choiceMenuSelectedIndex = Math.min(
          this.choiceMenuOptions.length - 1,
          this.choiceMenuSelectedIndex + 1
        );
        this.updateChoiceMenuSelection();
      } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.selectChoiceMenuOption();
      }
      return;
    }

    // Handle Enter key for dialogue/interaction
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.tryInteract();
    }

    // Movement - only when not in dialogue and not already moving
    if (!this.isInDialogue && !this.isMoving) {
      if (this.cursors.left.isDown) {
        this.movePlayer(-1, 0);
      } else if (this.cursors.right.isDown) {
        this.movePlayer(1, 0);
      } else if (this.cursors.up.isDown) {
        this.movePlayer(0, -1);
      } else if (this.cursors.down.isDown) {
        this.movePlayer(0, 1);
      }
    }
  }

  /**
   * Show level-up screen for heroes who leveled up after battle
   */
  private showLevelUpScreen(levelUps: BattleXPSummary[]): void {
    this.isInDialogue = true;

    // Create and show the level up overlay
    this.levelUpOverlay = new LevelUpOverlay({
      scene: this,
      levelUps,
      onComplete: () => {
        this.levelUpOverlay = null;
        this.isInDialogue = false;
      },
    });
    this.levelUpOverlay.show();
  }
}
