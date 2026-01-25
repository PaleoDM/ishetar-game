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
  sprite: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Sprite;
  dialogue: string[];
  portrait?: string;
}

interface MapTrigger {
  id: string;
  type: string;
  tiles: Array<{ x: number; y: number }>;
  battleMap?: string;
  cutscene?: string[];
}

interface MapData {
  id: string;
  displayName: string;
  gridWidth: number;
  gridHeight: number;
  terrain: number[][];
  npcs: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    portrait: string | null;
    dialogue: string;
  }>;
  heroPositions: Array<{ x: number; y: number }>;
  playerStart: { x: number; y: number };
  triggers?: MapTrigger[];
}

/**
 * IshetarScene1 - Initial Ishetar town scene (pre-South Gate battle)
 */
export class IshetarScene1 extends Phaser.Scene {
  private mapImage!: Phaser.GameObjects.Image;
  private player!: Phaser.GameObjects.Sprite;
  private playerGridX: number = 15;
  private playerGridY: number = 15;
  private playerFacing: 'front' | 'back' | 'left' | 'right' = 'front';
  private heroId: string = 'vicas';

  private npcs: NPC[] = [];
  private dialogueRenderer!: DialogueRenderer;
  private isInDialogue: boolean = false;

  // Choice menu state
  private choiceMenuContainer!: Phaser.GameObjects.Container;
  private choiceMenuVisible: boolean = false;
  private choiceMenuOptions: string[] = [];
  private choiceMenuSelectedIndex: number = 0;
  private choiceMenuTexts: Phaser.GameObjects.Text[] = [];
  private choiceMenuCallback?: (choice: string) => void;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private isMoving: boolean = false;

  // Map data
  private mapData!: MapData;
  private terrain: number[][] = [];
  private mapGridWidth: number = 32;
  private mapGridHeight: number = 32;

  // Track triggered events (so they don't re-trigger)
  private triggeredEvents: Set<string> = new Set();

  // Dev mode flag (affects trigger marker color)
  private devMode: boolean = false;

  // Game state for save/load
  private heroState: Record<string, HeroState> = {};
  private gameFlags: Record<string, boolean> = {};
  private playTime: number = 0; // Total play time in seconds
  private sessionStartTime: number = 0; // When this session started
  private inventory: InventoryState = createDefaultInventory();
  private chestStates: Record<string, ChestState> = {};

  // Menu scene (ESC key)
  private escKey!: Phaser.Input.Keyboard.Key;

  // Hrothgar combat guide callback
  private pendingHrothgarDialogue: boolean = false;

  // Save slot selection
  private selectedSaveSlot: number = 1;
  private saveSlotPreviews: SaveSlotPreview[] = [];

  // Level up overlay
  private levelUpOverlay: LevelUpOverlay | null = null;

  constructor() {
    super({ key: 'IshetarScene1' });
  }

  create(data: {
    heroId?: string;
    saveData?: SaveData;
    // Data returning from battle
    heroState?: Record<string, HeroState>;
    gameFlags?: Record<string, boolean>;
    playTime?: number;
    levelUps?: BattleXPSummary[];
    devMode?: boolean;
    inventory?: InventoryState;
    chests?: Record<string, ChestState>;
  }): void {
    // Reset state to ensure clean scene restart
    this.isInDialogue = false;
    this.isMoving = false;
    this.choiceMenuVisible = false;
    this.npcs = [];
    this.triggeredEvents = new Set();

    // Start town music (stop any previous music first)
    this.sound.stopAll();
    this.sound.play('music_town', { loop: true, volume: 0.5 });

    // Set dev mode flag (affects trigger marker color)
    this.devMode = data.devMode || false;

    // Get selected hero from scene data
    this.heroId = data.heroId || 'vicas';

    // Initialize game state
    if (data.saveData) {
      // Loading from save
      this.heroState = data.saveData.heroState;
      this.gameFlags = data.saveData.flags;
      this.playTime = data.saveData.playTime;
      this.playerGridX = data.saveData.playerPosition.x;
      this.playerGridY = data.saveData.playerPosition.y;
      this.inventory = data.saveData.inventory || createDefaultInventory();
      this.chestStates = data.saveData.chests || {};
    } else if (data.heroState) {
      // Returning from battle with updated state
      this.heroState = data.heroState;
      this.gameFlags = data.gameFlags || {};
      this.playTime = data.playTime || 0;
      this.inventory = data.inventory || createDefaultInventory();
      this.chestStates = data.chests || {};
      // Player position remains where they were (not reset)
    } else {
      // New game - create fresh hero state
      this.heroState = SaveManager.createInitialHeroState();
      this.gameFlags = {};
      this.playTime = 0;
      this.inventory = createDefaultInventory();
      this.chestStates = {};
    }

    // Start tracking session time
    this.sessionStartTime = Date.now();

    // Load map data from cache
    this.mapData = this.cache.json.get('data_map_ishetar');
    this.terrain = this.mapData.terrain;
    this.mapGridWidth = this.mapData.gridWidth;
    this.mapGridHeight = this.mapData.gridHeight;

    // Set player start position from map data (only if not loading from save)
    if (!data.saveData) {
      this.playerGridX = this.mapData.playerStart.x;
      this.playerGridY = this.mapData.playerStart.y;
    }

    // Load the town map as background (scaled to 50%)
    this.mapImage = this.add.image(0, 0, 'map_ishetar_town');
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setScale(0.5);

    // Draw light grid overlay
    this.drawGridOverlay();

    // DEBUG: Draw yellow boxes around trigger tiles
    this.drawDebugTriggers();

    // Place NPCs from map data
    this.placeNPCs();

    // Create player sprite
    this.createPlayer();

    // Setup camera to follow player
    const mapWidth = this.mapImage.width;
    const mapHeight = this.mapImage.height;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.5);

    // Setup input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // Create dialogue renderer - positioned relative to player
    this.dialogueRenderer = new DialogueRenderer(this);
    // Don't use scrollFactor(0) - we'll position relative to player instead

    // Create choice menu (hidden initially)
    this.createChoiceMenu();

    // Setup ESC key for menu
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // Check for level up test mode from registry
    const levelUpTestMode = this.game.registry.get('levelUpTestMode');
    if (levelUpTestMode) {
      // Create test level up data
      const testHero = this.game.registry.get('levelUpHero') || 'vicas';
      const testLevel = this.game.registry.get('levelUpLevel') || 2;
      const testLevelUps: BattleXPSummary[] = [
        {
          heroId: testHero,
          totalXP: 50,
          leveledUp: true,
          newLevel: testLevel,
          previousLevel: testLevel - 1,
        },
      ];
      // Add a second hero if testing level 3 (to show ability unlock)
      if (testLevel === 3) {
        testLevelUps.push({
          heroId: 'lyra',
          totalXP: 75,
          leveledUp: true,
          newLevel: 3,
          previousLevel: 2,
        });
      }
      this.time.delayedCall(500, () => {
        this.showLevelUpScreen(testLevelUps);
      });
    } else if (data.levelUps && data.levelUps.length > 0) {
      // Show level-up screen if returning from battle with level ups
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

  // Position dialogue relative to player (left side of visible viewport)
  private positionDialogueForPlayer(): void {
    // At 1.5x zoom, visible area is ~533x400 world units
    // Player is at center, so offset to left side
    const playerWorldX = this.playerGridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const playerWorldY = this.playerGridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

    // Offset from player: left and slightly above center to avoid bottom cutoff
    // -180 puts it well to the left of player, -20 keeps it above center
    this.dialogueRenderer.positionRelativeTo(playerWorldX, playerWorldY, -180, -20);
  }

  private drawGridOverlay(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, GAME_CONFIG.GRID_COLOR, GAME_CONFIG.GRID_ALPHA);

    const mapWidth = this.mapImage.width;
    const mapHeight = this.mapImage.height;

    for (let x = 0; x <= mapWidth; x += GAME_CONFIG.TILE_SIZE) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, mapHeight);
    }

    for (let y = 0; y <= mapHeight; y += GAME_CONFIG.TILE_SIZE) {
      graphics.moveTo(0, y);
      graphics.lineTo(mapWidth, y);
    }

    graphics.strokePath();
  }

  private drawDebugTriggers(): void {
    if (!this.mapData.triggers) return;

    const tileSize = GAME_CONFIG.TILE_SIZE;
    const cornerLength = 8;
    const halfTile = tileSize / 2;

    // Dev mode: bright yellow for visibility
    // Player mode: light gray with grow/shrink animation
    const color = this.devMode ? 0xffff00 : 0xb0b0b0;
    const alpha = this.devMode ? 0.9 : 0.85;

    for (const trigger of this.mapData.triggers) {
      for (const tile of trigger.tiles) {
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
  }

  private placeNPCs(): void {
    // Get player's hero name for Rowena's dialogue
    const heroData = this.cache.json.get('data_heroes');
    const playerHero = heroData?.[this.heroId];
    const playerName = playerHero?.name || 'adventurer';

    // NPC dialogues (pre-battle only - post-battle handled by IshetarScene2)
    const npcDialogues: Record<string, string[]> = {
      rowena: [
        `Oh ${playerName}, nice to see you! I heard there was some trouble at the south gate. Would you mind checking it out?`
      ],
      guard_north: [
        `Sorry ${playerName}, the North road isn't safe. It passes too close to the Red Vale!`
      ],
      guard_east: [
        `Sorry ${playerName}, the East road isn't safe. There are many wild creatures in the wilderness!`
      ],
      villager_male: [
        "Did you see Thump this morning? He paints the Fall colors on all the leaves, you know!"
      ],
      villager_female: [
        "Winter's coming and no supply ships from the Empire... we'll have to rely on each other, as always."
      ],
      child_male: [
        "Wow, are you one of the heroes? I heard you can beat up demons!"
      ],
      child_female: [
        "Mama says Gatekeeper's Remembrance Day is almost here. We have to leave offerings for the departed!"
      ],
      hrothgar: [
        "I may be an old veteran, but I can still help you learn combat tactics!",
        "And be sure to bring me any equipment you find. I can help you attune to it."
      ],
      pelor: [
        "*You burn your offering at the shrine. You find yourself fully rested. Would you like to record your progress for the bards?*"
      ],
    };

    // Hero dialogues (when talking to party members)
    const heroDialogues: Record<string, string[]> = {
      vicas: ["I sure hope this is just a social call...don't tell me you've been in a scrap without me!"],
      rooker: ["Hey! I'm busy pondering the arcane...don't distract me!"],
      lyra: ["The light of the Dawnfather truly spoils us on this fine Autumn day!"],
      azrael: ["Is today a nappin' kinda day, or a stabbin' kinda day?"],
      thump: ["I hope you've brought a few acorns. The chipmunks are cranky after last time..."],
    };

    // Hero display names
    const heroNames: Record<string, string> = {
      vicas: 'Vicas',
      rooker: 'Rooker',
      lyra: 'Lyra',
      azrael: 'Azrael',
      thump: 'Thump',
    };

    // Place regular NPCs (like Rowena)
    this.mapData.npcs.forEach(npcInfo => {
      const pixelX = npcInfo.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const pixelY = npcInfo.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

      // Determine sprite key - some NPCs use shared sprites
      let spriteKey = `sprite_${npcInfo.id}_front`;
      if (npcInfo.id.startsWith('guard_')) {
        spriteKey = 'sprite_guard_front';
      } else if (npcInfo.id === 'villager_male') {
        spriteKey = 'sprite_villager_male_front';
      } else if (npcInfo.id === 'villager_female') {
        spriteKey = 'sprite_villager_female_front';
      } else if (npcInfo.id === 'child_male') {
        spriteKey = 'sprite_child_male_front';
      } else if (npcInfo.id === 'child_female') {
        spriteKey = 'sprite_child_female_front';
      } else if (npcInfo.id === 'hrothgar') {
        spriteKey = 'sprite_villager_male_front';
      }

      // Use NPC sprite if available, otherwise yellow placeholder
      const sprite = this.textures.exists(spriteKey)
        ? this.add.sprite(pixelX, pixelY, spriteKey)
        : this.add.rectangle(pixelX, pixelY, GAME_CONFIG.TILE_SIZE - 4, GAME_CONFIG.TILE_SIZE - 4, 0xffff00);

      // Scale sprite to match tile size
      if (sprite instanceof Phaser.GameObjects.Sprite) {
        sprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);
      }

      // Check if portrait exists for this NPC
      const portraitKey = `portrait_${npcInfo.id}`;

      this.npcs.push({
        id: npcInfo.id,
        name: npcInfo.name,
        gridX: npcInfo.x,
        gridY: npcInfo.y,
        sprite,
        dialogue: npcDialogues[npcInfo.id] || ["..."],
        portrait: this.textures.exists(portraitKey) ? portraitKey : undefined,
      });
    });

    // Place hero party members (excluding the player's chosen hero)
    const allHeroes = ['vicas', 'azrael', 'lyra', 'thump', 'rooker'];
    const partyHeroes = allHeroes.filter(h => h !== this.heroId);
    const heroPositions = this.mapData.heroPositions || [];

    partyHeroes.forEach((heroId, index) => {
      if (index >= heroPositions.length) return;

      const pos = heroPositions[index];
      const pixelX = pos.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const pixelY = pos.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

      // Use actual hero sprite
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

    this.player = this.add.sprite(pixelX, pixelY, `sprite_${this.heroId}_front`);
    this.player.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);
  }

  private updatePlayerSprite(): void {
    this.player.setTexture(`sprite_${this.heroId}_${this.playerFacing}`);
  }

  private isPassable(gridX: number, gridY: number): boolean {
    // Out of bounds check
    if (gridX < 0 || gridX >= this.mapGridWidth) return false;
    if (gridY < 0 || gridY >= this.mapGridHeight) return false;

    // Check terrain (0 = walkable, 1 = difficult but passable, 2 = impassable)
    const terrainValue = this.terrain[gridY]?.[gridX];
    if (terrainValue === 2) return false;

    // Check if NPC is blocking
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

    // Check if destination is passable
    if (!this.isPassable(newGridX, newGridY)) return;

    // Move the player
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

  private tryInteract(): void {
    if (this.isInDialogue) {
      this.dialogueRenderer.advance();
      return;
    }

    let checkX = this.playerGridX;
    let checkY = this.playerGridY;

    if (this.playerFacing === 'right') checkX += 1;
    else if (this.playerFacing === 'left') checkX -= 1;
    else if (this.playerFacing === 'front') checkY += 1;
    else if (this.playerFacing === 'back') checkY -= 1;

    const npc = this.npcs.find(n => n.gridX === checkX && n.gridY === checkY);

    if (npc) {
      this.startNPCDialogue(npc);
    }
  }

  private startNPCDialogue(npc: NPC): void {
    this.isInDialogue = true;
    this.positionDialogueForPlayer();

    // Special handling for Hrothgar - show Hrothgar's services menu after dialogue
    if (npc.id === 'hrothgar') {
      this.dialogueRenderer.startDialogue(npc.dialogue, npc.name, () => {
        this.isInDialogue = false;
        this.pendingHrothgarDialogue = true;
        this.scene.pause();
        this.scene.launch('MenuScene', {
          heroState: this.heroState,
          returnScene: 'IshetarScene1',
          initialView: 'hrothgar',
          inventory: this.inventory,
        });
      }, npc.portrait);
    } else if (npc.id === 'pelor') {
      // Special handling for shrine - restore resources and offer save
      this.handleShrineInteraction(npc);
    } else {
      this.dialogueRenderer.startDialogue(npc.dialogue, npc.name, () => {
        this.isInDialogue = false;
      }, npc.portrait);
    }
  }

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
      currentMap: 'ishetar_town',
      playerPosition: { x: this.playerGridX, y: this.playerGridY },
      playTime: totalPlayTime,
      heroState: this.heroState,
      flags: this.gameFlags,
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

  /**
   * Get current total play time including this session
   */
  private getCurrentPlayTime(): number {
    const sessionSeconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    return this.playTime + sessionSeconds;
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

  private checkTriggers(): void {
    if (!this.mapData.triggers) return;

    for (const trigger of this.mapData.triggers) {
      // Skip already triggered events (within this session)
      if (this.triggeredEvents.has(trigger.id)) continue;

      // Skip battles that have already been completed (persistent)
      if (trigger.type === 'battle' && trigger.battleMap && this.gameFlags[`${trigger.battleMap}_battle_complete`]) {
        continue;
      }

      // Check if player is on any trigger tile
      const onTrigger = trigger.tiles.some(
        tile => tile.x === this.playerGridX && tile.y === this.playerGridY
      );

      if (onTrigger) {
        this.triggeredEvents.add(trigger.id);
        this.handleTrigger(trigger);
        break;
      }
    }
  }

  private handleTrigger(trigger: MapTrigger): void {
    if (trigger.type === 'battle') {
      this.isInDialogue = true;

      // Show cutscene dialogue if present
      if (trigger.cutscene && trigger.cutscene.length > 0) {
        this.positionDialogueForPlayer();
        this.dialogueRenderer.startDialogue(
          trigger.cutscene,
          '',
          () => {
            // After cutscene, transition to battle
            this.scene.start('BattleScene', {
              battleMap: trigger.battleMap,
              heroId: this.heroId,
              heroState: this.heroState,
              gameFlags: this.gameFlags,
              playTime: this.getCurrentPlayTime(),
              inventory: this.inventory,
              chests: this.chestStates,
              devMode: this.devMode,
            });
          }
        );
      } else {
        // No cutscene, go directly to battle
        this.scene.start('BattleScene', {
          battleMap: trigger.battleMap,
          heroId: this.heroId,
          heroState: this.heroState,
          gameFlags: this.gameFlags,
          playTime: this.getCurrentPlayTime(),
          inventory: this.inventory,
          chests: this.chestStates,
          devMode: this.devMode,
        });
      }
    }
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
        returnScene: 'IshetarScene1',
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

    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.tryInteract();
    }

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
}
