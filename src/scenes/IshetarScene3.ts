import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { DialogueRenderer } from '../systems/DialogueRenderer';
import { SaveManager, SaveData, HeroState, SaveSlotPreview } from '../systems/SaveManager';
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
}

/**
 * IshetarScene3 - Post-tutorial Ishetar
 * Shows congratulations message and lets the player explore with new dialogue
 */
export class IshetarScene3 extends Phaser.Scene {
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

  // Game state
  private heroState: Record<string, HeroState> = {};
  private gameFlags: Record<string, boolean> = {};
  private playTime: number = 0;
  private sessionStartTime: number = 0;
  private inventory: InventoryState = createDefaultInventory();
  private chestStates: Record<string, ChestState> = {};
  private devMode: boolean = false;

  // Menu scene (ESC key)
  private escKey!: Phaser.Input.Keyboard.Key;

  // Hrothgar combat guide callback
  private pendingHrothgarDialogue: boolean = false;

  // Save slot selection
  private selectedSaveSlot: number = 1;
  private saveSlotPreviews: SaveSlotPreview[] = [];

  private hasShownCongrats: boolean = false;

  constructor() {
    super({ key: 'IshetarScene3' });
  }

  create(data: {
    heroId?: string;
    heroState?: Record<string, HeroState>;
    gameFlags?: Record<string, boolean>;
    playTime?: number;
    inventory?: InventoryState;
    chests?: Record<string, ChestState>;
    saveData?: SaveData;
    devMode?: boolean;
  }): void {
    // Reset state to ensure clean scene restart
    this.isInDialogue = false;
    this.isMoving = false;
    this.choiceMenuVisible = false;
    this.npcs = [];
    this.hasShownCongrats = false;

    // Start town music (stop any previous music first)
    this.sound.stopAll();
    this.sound.play('music_town', { loop: true, volume: 0.5 });

    // Get passed data
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

    // Load map data from cache
    this.mapData = this.cache.json.get('data_map_ishetar');
    this.terrain = this.mapData.terrain;
    this.mapGridWidth = this.mapData.gridWidth;
    this.mapGridHeight = this.mapData.gridHeight;

    // Set player start position
    this.playerGridX = this.mapData.playerStart.x;
    this.playerGridY = this.mapData.playerStart.y;

    // Load the town map as background (scaled to 50%)
    this.mapImage = this.add.image(0, 0, 'map_ishetar_town');
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setScale(0.5);

    // Draw light grid overlay
    this.drawGridOverlay();

    // Draw exit trigger markers (east gate)
    this.drawExitTriggers();

    // Place NPCs with post-tutorial dialogue
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

    // Create dialogue renderer
    this.dialogueRenderer = new DialogueRenderer(this);

    // Create choice menu (hidden initially)
    this.createChoiceMenu();

    // Setup ESC key for menu
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // Listen for resume event (returning from MenuScene)
    this.events.on('resume', () => {
      if (this.pendingHrothgarDialogue) {
        this.pendingHrothgarDialogue = false;
        this.time.delayedCall(100, () => {
          this.showHrothgarEndingDialogue();
        });
      }
    });

    // Show congratulations message after a short delay
    this.time.delayedCall(500, () => {
      this.showCongratulations();
    });
  }

  private showCongratulations(): void {
    if (this.hasShownCongrats) return;
    this.hasShownCongrats = true;
    this.isInDialogue = true;
    this.positionDialogueForPlayer();

    // Set flag indicating player has completed the tutorial and seen the ending
    this.gameFlags['tutorial_complete'] = true;

    this.dialogueRenderer.startDialogue(
      [
        'Congratulations on completing the Tutorial!',
        'Thank you for playing!',
        'Feel free to explore Ishetar and chat with the townsfolk.'
      ],
      'THE END',
      () => {
        this.isInDialogue = false;
      }
    );
  }

  private positionDialogueForPlayer(): void {
    const playerWorldX = this.playerGridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
    const playerWorldY = this.playerGridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
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

  private drawExitTriggers(): void {
    // East gate exit triggers at (25, 11) and (25, 12)
    const exitSquares = [
      { x: 25, y: 11 },
      { x: 25, y: 12 },
    ];

    const halfTile = GAME_CONFIG.TILE_SIZE / 2;
    const cornerSize = 6;
    const color = 0xb0b0b0;
    const alpha = 0.85;

    for (const square of exitSquares) {
      const centerX = square.x * GAME_CONFIG.TILE_SIZE + halfTile;
      const centerY = square.y * GAME_CONFIG.TILE_SIZE + halfTile;

      const graphics = this.add.graphics();
      graphics.setPosition(centerX, centerY);
      graphics.lineStyle(2, color, alpha);

      // Draw corner brackets
      // Top-left
      graphics.moveTo(-halfTile, -halfTile + cornerSize);
      graphics.lineTo(-halfTile, -halfTile);
      graphics.lineTo(-halfTile + cornerSize, -halfTile);
      // Top-right
      graphics.moveTo(halfTile - cornerSize, -halfTile);
      graphics.lineTo(halfTile, -halfTile);
      graphics.lineTo(halfTile, -halfTile + cornerSize);
      // Bottom-left
      graphics.moveTo(-halfTile, halfTile - cornerSize);
      graphics.lineTo(-halfTile, halfTile);
      graphics.lineTo(-halfTile + cornerSize, halfTile);
      // Bottom-right
      graphics.moveTo(halfTile - cornerSize, halfTile);
      graphics.lineTo(halfTile, halfTile);
      graphics.lineTo(halfTile, halfTile - cornerSize);

      graphics.strokePath();

      // Add grow/shrink animation
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

  private isInExitTrigger(gridX: number, gridY: number): boolean {
    // East gate exit at (25, 11) and (25, 12)
    return gridX === 25 && (gridY === 11 || gridY === 12);
  }

  private exitToTravel(): void {
    this.cameras.main.stopFollow();
    this.scene.start('TravelScene', {
      heroId: this.heroId,
      heroState: this.heroState,
      gameFlags: this.gameFlags,
      playTime: this.playTime,
      playerPosition: { x: 5, y: 22 }, // Return to Ishetar location on travel map
      inventory: this.inventory,
      chests: this.chestStates,
      devMode: this.devMode,
    });
  }

  private placeNPCs(): void {
    // Post-tutorial dialogues for all NPCs
    const npcDialogues: Record<string, string[]> = {
      rowena: [
        "Dalric and Mickell are recovering well. Meris is so grateful. Thank you.",
        "Quetzi is another story. Gertrude has her heating up in the bakery.",
        "Rest now, heroes. You've earned it. But I sense this is only the beginning..."
      ],
      guard_north: [
        "First the devils, then those hellhounds... Ishetar is lucky to have you.",
        "But I hear our neighbors in the Red Vale are overrun with undead."
      ],
      guard_east: [
        "The path to the Old Maple Tree should be safe.",
        "We're all so grateful Master Thump tends to the spirits there."
      ],
      villager_male: [
        "Heroes! The whole town is talking about your deeds!",
        "Free bread for you, anytime. You've more than earned it."
      ],
      villager_female: [
        "Oh my stars, you saved Meris AND her family!",
        "And cleared those awful beasts from the roads! Bless you, truly."
      ],
      child_male: [
        "You fought HELLHOUNDS?! Real actual hellhounds?!",
        "I'm gonna tell EVERYONE! You're the coolest heroes ever!"
      ],
      child_female: [
        "Meris told me you saved her whole family!",
        "And a dragon too! Well... a little dragon. She's so pretty!"
      ],
      hrothgar: [
        "I may be an old veteran, but I can still help you learn combat tactics!",
        "And be sure to bring me any equipment you find. I can help you attune to it."
      ],
      pelor: [
        "*The flame burns bright. You sense the gods are pleased with your heroism.*"
      ],
      sombra: [
        "A corrupted celestial? And they tried to kill Quetzi?",
        "I don't like this one bit. I'll search our ancient tomes and see if I can help somehow..."
      ],
    };

    // Hero dialogues (post-tutorial)
    const heroDialogues: Record<string, string[]> = {
      vicas: ["I'm no mage, but I know how bodies work. We can definitely do something for her."],
      rooker: ["She's inherently magical. Fixing her should be an academic endeavor..."],
      lyra: ["By the Sunset, we all heal. I'm sure we can do something for Quetzi."],
      azrael: ["A blade that cuts to the soul? Just call me Scalp-real."],
      thump: ["She's a spirit at heart. We should get her to the Old Maple Tree as soon as possible."],
    };

    const heroNames: Record<string, string> = {
      vicas: 'Vicas',
      rooker: 'Rooker',
      lyra: 'Lyra',
      azrael: 'Azrael',
      thump: 'Thump',
    };

    // Place regular NPCs
    this.mapData.npcs.forEach(npcInfo => {
      const pixelX = npcInfo.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
      const pixelY = npcInfo.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

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
      } else if (npcInfo.id === 'sombra') {
        spriteKey = 'sprite_sombra_front';
      }

      const sprite = this.textures.exists(spriteKey)
        ? this.add.sprite(pixelX, pixelY, spriteKey)
        : this.add.rectangle(pixelX, pixelY, GAME_CONFIG.TILE_SIZE - 4, GAME_CONFIG.TILE_SIZE - 4, 0xffff00);

      if (sprite instanceof Phaser.GameObjects.Sprite) {
        sprite.setScale(GAME_CONFIG.TILE_SIZE / GAME_CONFIG.SPRITE_SIZE);
      }

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
        // Check if player entered exit trigger
        if (this.isInExitTrigger(this.playerGridX, this.playerGridY)) {
          this.exitToTravel();
        }
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

    if (npc.id === 'pelor') {
      // Shrine heals and offers to save
      this.handleShrineInteraction(npc);
    } else if (npc.id === 'hrothgar') {
      // Hrothgar shows flavor line then services menu
      this.dialogueRenderer.startDialogue(
        npc.dialogue,
        npc.name,
        () => {
          this.isInDialogue = false;
          this.pendingHrothgarDialogue = true;
          this.scene.pause();
          this.scene.launch('MenuScene', {
            heroState: this.heroState,
            returnScene: 'IshetarScene3',
            initialView: 'hrothgar',
            inventory: this.inventory,
          });
        },
        npc.portrait
      );
    } else {
      this.dialogueRenderer.startDialogue(npc.dialogue, npc.name, () => {
        this.isInDialogue = false;
      }, npc.portrait);
    }
  }

  private handleShrineInteraction(npc: NPC): void {
    // Restore all heroes to full HP/Mana/Ki
    this.heroState = SaveManager.restoreAllResources(this.heroState);

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
    const sessionSeconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const totalPlayTime = this.playTime + sessionSeconds;

    const saveData: SaveData = {
      slot: slot,
      mainHero: this.heroId,
      currentMap: 'ishetar_town_post_tutorial',
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
      this.playTime = totalPlayTime;
      this.sessionStartTime = Date.now();

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

  private createChoiceMenu(): void {
    this.choiceMenuContainer = this.add.container(0, 0);
    this.choiceMenuContainer.setScrollFactor(0);
    this.choiceMenuContainer.setVisible(false);
    this.choiceMenuContainer.setDepth(1000);
  }

  private showChoiceMenu(options: string[], callback: (choice: string) => void): void {
    this.choiceMenuOptions = options;
    this.choiceMenuSelectedIndex = 0;
    this.choiceMenuCallback = callback;

    // Clear previous texts
    this.choiceMenuTexts.forEach(t => t.destroy());
    this.choiceMenuTexts = [];
    this.choiceMenuContainer.removeAll(true);

    const lineHeight = 30;
    const padding = 20;

    // Create text objects first to measure width
    const tempTexts: Phaser.GameObjects.Text[] = [];
    options.forEach((option, index) => {
      const text = this.add.text(0, index * lineHeight, '  ' + option, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      });
      text.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      tempTexts.push(text);
    });

    // Calculate menu width based on longest option
    const maxTextWidth = Math.max(...tempTexts.map(t => t.width));
    const menuWidth = Math.max(200, maxTextWidth + padding * 2);
    const menuHeight = options.length * lineHeight + 20;
    const menuX = GAME_CONFIG.WIDTH / 2 - menuWidth / 2;
    const menuY = GAME_CONFIG.HEIGHT / 2 - menuHeight / 2;

    const bg = this.add.rectangle(menuX + menuWidth / 2, menuY + menuHeight / 2, menuWidth, menuHeight, 0x000000, 0.9);
    bg.setStrokeStyle(2, 0xffffff);
    this.choiceMenuContainer.add(bg);

    // Position texts and add to container
    tempTexts.forEach((text, index) => {
      text.setPosition(menuX + padding, menuY + 10 + index * lineHeight);
      this.choiceMenuContainer.add(text);
      this.choiceMenuTexts.push(text);
    });

    this.updateChoiceMenuSelection();
    this.choiceMenuContainer.setVisible(true);
    this.choiceMenuVisible = true;
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
      ["Come back when you're ready. I'll forge you something worthy of your deeds!"],
      'Hrothgar',
      () => {
        this.isInDialogue = false;
      }
    );
  }

  update(): void {
    // Handle ESC key to open menu
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.pause();
      this.scene.launch('MenuScene', {
        heroState: this.heroState,
        returnScene: 'IshetarScene3',
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
