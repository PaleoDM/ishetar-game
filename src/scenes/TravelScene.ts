import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { DialogueRenderer } from '../systems/DialogueRenderer';
import { HeroState } from '../systems/SaveManager';
import { BattleXPSummary } from '../systems/XPTracker';
import { LevelUpOverlay } from '../components/LevelUpOverlay';
import { InventoryState, ChestState, createDefaultInventory } from '../data/ItemTypes';

interface LocationBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface LocationMarker {
  id: string;
  name: string;
  bounds: LocationBounds;
  markerPosition: { x: number; y: number };
  sprite: Phaser.GameObjects.Container;
  description: string[];
  type: 'town' | 'battle' | 'blocked' | 'explore';
  battleMap?: string;
  exploreMap?: string;
  targetScene?: string;
}

interface TravelMapData {
  id: string;
  displayName: string;
  gridWidth: number;
  gridHeight: number;
  terrain: number[][];
  playerStart: { x: number; y: number };
  locations: Array<{
    id: string;
    name: string;
    bounds: LocationBounds;
    markerPosition: { x: number; y: number };
    type: 'town' | 'battle' | 'blocked' | 'explore';
    description: string[];
    battleMap?: string;
    exploreMap?: string;
    targetScene?: string;
  }>;
}

export class TravelScene extends Phaser.Scene {
  private mapImage!: Phaser.GameObjects.Image;
  private player!: Phaser.GameObjects.Sprite;
  private playerGridX: number = 10;
  private playerGridY: number = 10;
  private playerFacing: 'front' | 'back' | 'left' | 'right' = 'front';
  private heroId: string = 'vicas';

  private locations: LocationMarker[] = [];
  private dialogueRenderer!: DialogueRenderer;
  private isInDialogue: boolean = false;

  // Track which blocked locations have shown their dialogue this session
  private shownBlockedDialogue: Set<string> = new Set();

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
  private mapData!: TravelMapData;
  private terrain: number[][] = [];
  private mapGridWidth: number = 20;
  private mapGridHeight: number = 20;

  // Game state
  private heroState: Record<string, HeroState> = {};
  private gameFlags: Record<string, boolean> = {};
  private playTime: number = 0;
  private inventory: InventoryState = createDefaultInventory();
  private chestStates: Record<string, ChestState> = {};
  private devMode: boolean = false;

  // Menu scene (ESC key)
  private escKey!: Phaser.Input.Keyboard.Key;

  // Level up overlay
  private levelUpOverlay: LevelUpOverlay | null = null;

  private readonly GRID_SIZE = 24;

  // Calculate tile dimensions based on scaled map size
  private get tileWidth(): number {
    return this.mapImage?.displayWidth / this.GRID_SIZE || 32;
  }
  private get tileHeight(): number {
    return this.mapImage?.displayHeight / this.GRID_SIZE || 32;
  }

  constructor() {
    super({ key: 'TravelScene' });
  }

  shutdown(): void {
    // Stop camera follow before scene transitions to prevent drift bug in BattleScene
    this.cameras.main.stopFollow();
  }

  create(data: {
    heroId?: string;
    heroState?: Record<string, HeroState>;
    gameFlags?: Record<string, boolean>;
    playTime?: number;
    playerPosition?: { x: number; y: number };
    levelUps?: BattleXPSummary[];
    inventory?: InventoryState;
    chests?: Record<string, ChestState>;
    devMode?: boolean;
  }): void {
    // Get passed data
    this.heroId = data.heroId || 'vicas';
    this.heroState = data.heroState || {};
    this.gameFlags = data.gameFlags || {};
    this.playTime = data.playTime || 0;
    this.inventory = data.inventory || createDefaultInventory();
    this.chestStates = data.chests || {};
    this.devMode = data.devMode || false;

    // Reset state
    this.shownBlockedDialogue.clear();
    this.locations = [];
    this.isInDialogue = false;
    this.isMoving = false;
    this.choiceMenuVisible = false;

    // Start travel/exploration music (stop any previous music first)
    this.sound.stopAll();
    this.sound.play('music_travel', { loop: true, volume: 0.5 });

    // Load map data from cache
    this.mapData = this.cache.json.get('data_map_travel');
    this.terrain = this.mapData.terrain;
    this.mapGridWidth = this.mapData.gridWidth;
    this.mapGridHeight = this.mapData.gridHeight;

    // Set player start position
    if (data.playerPosition) {
      this.playerGridX = data.playerPosition.x;
      this.playerGridY = data.playerPosition.y;
    } else {
      this.playerGridX = this.mapData.playerStart.x;
      this.playerGridY = this.mapData.playerStart.y;
    }

    // Load the travel map as background at 50% scale
    this.mapImage = this.add.image(0, 0, 'map_travel');
    this.mapImage.setOrigin(0, 0);
    this.mapImage.setScale(0.5);

    // Draw 24x24 grid overlay
    this.drawGridOverlay();

    // Place location markers (pulsing dots)
    this.placeLocationMarkers();

    // Create player sprite
    this.createPlayer();

    // Setup camera to follow player (use displayWidth for scaled size)
    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    console.log(`Map dimensions (scaled): ${mapWidth} x ${mapHeight}`);

    // Setup input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // Create dialogue renderer
    this.dialogueRenderer = new DialogueRenderer(this);
    this.dialogueRenderer.setScrollFactor(0);

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

  private drawGridOverlay(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, GAME_CONFIG.GRID_COLOR, GAME_CONFIG.GRID_ALPHA * 0.5);

    const mapWidth = this.mapImage.displayWidth;
    const mapHeight = this.mapImage.displayHeight;

    // Draw vertical lines
    for (let x = 0; x <= this.GRID_SIZE; x++) {
      const pixelX = x * this.tileWidth;
      graphics.moveTo(pixelX, 0);
      graphics.lineTo(pixelX, mapHeight);
    }

    // Draw horizontal lines
    for (let y = 0; y <= this.GRID_SIZE; y++) {
      const pixelY = y * this.tileHeight;
      graphics.moveTo(0, pixelY);
      graphics.lineTo(mapWidth, pixelY);
    }

    graphics.strokePath();
  }

  private placeLocationMarkers(): void {
    this.mapData.locations.forEach(locationInfo => {
      const pixelX = locationInfo.markerPosition.x * this.tileWidth + this.tileWidth / 2;
      const pixelY = locationInfo.markerPosition.y * this.tileHeight + this.tileHeight / 2;

      // Create a container for the marker
      const container = this.add.container(pixelX, pixelY);

      // Create marker circle with color based on type
      let markerColor = 0x00ff00; // Green for accessible
      if (locationInfo.type === 'blocked') {
        markerColor = 0xff0000; // Red for blocked
      } else if (locationInfo.type === 'battle') {
        markerColor = 0xffaa00; // Orange for battle
      } else if (locationInfo.type === 'town') {
        markerColor = 0x00aaff; // Blue for town
      } else if (locationInfo.type === 'explore') {
        markerColor = 0x00ff00; // Green for explore
      }

      // Pulsing marker effect (50% smaller - radius 6 inner, 8 outer)
      const marker = this.add.circle(0, 0, 6, markerColor, 0.7);
      const markerOuter = this.add.circle(0, 0, 8, markerColor, 0.3);

      // Add pulsing animation to outer ring
      this.tweens.add({
        targets: markerOuter,
        scaleX: 1.3,
        scaleY: 1.3,
        alpha: 0,
        duration: 1000,
        repeat: -1,
        yoyo: false,
        onRepeat: () => {
          markerOuter.setScale(1);
          markerOuter.setAlpha(0.3);
        }
      });

      container.add([markerOuter, marker]);

      // Name label below marker (avoids edge cutoff)
      const label = this.add.text(0, 28, locationInfo.name, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 4, y: 2 },
      });
      label.setOrigin(0.5, 0.5);
      label.setResolution(GAME_CONFIG.TEXT_RESOLUTION);
      container.add(label);

      this.locations.push({
        id: locationInfo.id,
        name: locationInfo.name,
        bounds: locationInfo.bounds,
        markerPosition: locationInfo.markerPosition,
        sprite: container,
        description: locationInfo.description,
        type: locationInfo.type,
        battleMap: locationInfo.battleMap,
        exploreMap: locationInfo.exploreMap,
        targetScene: locationInfo.targetScene,
      });
    });
  }

  private createPlayer(): void {
    const pixelX = this.playerGridX * this.tileWidth + this.tileWidth / 2;
    const pixelY = this.playerGridY * this.tileHeight + this.tileHeight / 2;

    this.player = this.add.sprite(pixelX, pixelY, `sprite_${this.heroId}_front`);
    // Scale sprite to match tile size
    this.player.setScale(this.tileWidth / GAME_CONFIG.SPRITE_SIZE);
  }

  private updatePlayerSprite(): void {
    this.player.setTexture(`sprite_${this.heroId}_${this.playerFacing}`);
  }

  private isWithinBounds(gridX: number, gridY: number, bounds: LocationBounds): boolean {
    return gridX >= bounds.x1 && gridX <= bounds.x2 &&
           gridY >= bounds.y1 && gridY <= bounds.y2;
  }

  private getLocationAtPosition(gridX: number, gridY: number): LocationMarker | undefined {
    return this.locations.find(loc => this.isWithinBounds(gridX, gridY, loc.bounds));
  }

  private isPassable(gridX: number, gridY: number): boolean {
    // Out of bounds check
    if (gridX < 0 || gridX >= this.mapGridWidth) return false;
    if (gridY < 0 || gridY >= this.mapGridHeight) return false;

    // Check terrain (0 = walkable, 1 = difficult but passable, 2 = impassable)
    const terrainValue = this.terrain[gridY]?.[gridX];
    if (terrainValue === 2) return false;

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

    // Check if trying to enter a blocked location
    const targetLocation = this.getLocationAtPosition(newGridX, newGridY);
    if (targetLocation && targetLocation.type === 'blocked') {
      // Show warning dialogue and don't move
      if (!this.shownBlockedDialogue.has(targetLocation.id)) {
        this.shownBlockedDialogue.add(targetLocation.id);
        this.isInDialogue = true;
        this.dialogueRenderer.startDialogue(
          targetLocation.description,
          targetLocation.name,
          () => {
            this.isInDialogue = false;
          }
        );
      }
      return;
    }

    // Move the player
    this.isMoving = true;
    this.playerGridX = newGridX;
    this.playerGridY = newGridY;

    const targetX = newGridX * this.tileWidth + this.tileWidth / 2;
    const targetY = newGridY * this.tileHeight + this.tileHeight / 2;

    this.tweens.add({
      targets: this.player,
      x: targetX,
      y: targetY,
      duration: 150,
      ease: 'Linear',
      onComplete: () => {
        this.isMoving = false;
        // Check for special triggered encounters first
        if (this.checkSpecialTriggers()) {
          return; // Trigger activated, don't check regular locations
        }
        this.checkLocationProximity();
      },
    });
  }

  /**
   * Check for special triggered encounters based on game flags and position
   * Returns true if a trigger activated
   */
  private checkSpecialTriggers(): boolean {
    // Hellhound ambush: triggers on row 19 after Quetzi Shrine is complete
    if (
      this.gameFlags['quetzi_shrine_battle_complete'] &&
      !this.gameFlags['hellhound_ambush_triggered'] &&
      this.playerGridY === 19
    ) {
      this.triggerHellhoundAmbush();
      return true;
    }
    return false;
  }

  /**
   * Hellhound ambush encounter after returning from Quetzi Shrine
   */
  private triggerHellhoundAmbush(): void {
    this.gameFlags['hellhound_ambush_triggered'] = true;
    this.isInDialogue = true;

    // Pre-battle warning dialogue
    this.dialogueRenderer.startDialogue(
      ['...growl...', "Something large is hunting you. No, somethings!"],
      'Wilderness',
      () => {
        // Transition to hellhound battle
        this.scene.start('BattleScene', {
          battleMap: 'hellhound_cave',
          heroId: this.heroId,
          heroState: this.heroState,
          gameFlags: this.gameFlags,
          playTime: this.playTime,
          returnScene: 'TravelScene',
          returnPosition: { x: this.playerGridX, y: this.playerGridY },
          inventory: this.inventory,
          chests: this.chestStates,
          devMode: this.devMode,
        });
      }
    );
  }

  private checkLocationProximity(): void {
    // Check if player is within any location's bounds
    const location = this.getLocationAtPosition(this.playerGridX, this.playerGridY);

    if (location && location.type !== 'blocked') {
      this.promptLocationInteraction(location);
    }
  }

  private promptLocationInteraction(location: LocationMarker): void {
    this.isInDialogue = true;

    // Check if this battle location is now safe (after Quetzi Shrine)
    if (
      location.id === 'hunting_paths' &&
      this.gameFlags['quetzi_shrine_battle_complete']
    ) {
      this.dialogueRenderer.startDialogue(
        ['The path is now safe, thanks to you!'],
        location.name,
        () => {
          this.isInDialogue = false;
        }
      );
      return;
    }

    // Check if the shrine has been cleansed (after Quetzi Shrine battle)
    if (
      location.id === 'quetzi_shrine' &&
      this.gameFlags['quetzi_shrine_battle_complete']
    ) {
      this.dialogueRenderer.startDialogue(
        ['The Shrine has been cleansed, thanks to you.'],
        location.name,
        () => {
          this.isInDialogue = false;
        }
      );
      return;
    }

    // Show location description first
    this.dialogueRenderer.startDialogue(
      location.description,
      location.name,
      () => {
        // Go straight to the location after dialogue (no choice menu)
        this.travelToLocation(location);
      }
    );
  }

  private travelToLocation(location: LocationMarker): void {
    if (location.type === 'town' && location.targetScene) {
      // Determine which town scene to use based on game progress
      // Players on the travel map have already completed South Gate, so never use IshetarScene1
      let targetScene: string;
      if (this.gameFlags['hellhound_cave_battle_complete']) {
        targetScene = 'IshetarScene3';
      } else {
        // Before hellhound completion, use IshetarScene2
        targetScene = 'IshetarScene2';
      }

      // Transition to town scene
      this.scene.start(targetScene, {
        heroId: this.heroId,
        heroState: this.heroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
      });
    } else if (location.type === 'battle' && location.battleMap) {
      // Transition to battle
      this.scene.start('BattleScene', {
        battleMap: location.battleMap,
        heroId: this.heroId,
        heroState: this.heroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        returnScene: 'TravelScene',
        returnPosition: { x: this.playerGridX, y: this.playerGridY },
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
      });
    } else if (location.type === 'explore' && location.exploreMap) {
      // Transition to explore scene (no combat)
      this.scene.start('ExploreScene', {
        exploreMap: location.exploreMap,
        heroId: this.heroId,
        heroState: this.heroState,
        gameFlags: this.gameFlags,
        playTime: this.playTime,
        inventory: this.inventory,
        chests: this.chestStates,
        devMode: this.devMode,
      });
    }
  }

  private tryInteract(): void {
    if (this.isInDialogue) {
      this.dialogueRenderer.advance();
      return;
    }

    // Check if standing within a location
    const location = this.getLocationAtPosition(this.playerGridX, this.playerGridY);

    if (location && location.type !== 'blocked') {
      this.promptLocationInteraction(location);
    }
  }

  private createChoiceMenu(): void {
    this.choiceMenuContainer = this.add.container(0, 0);
    this.choiceMenuContainer.setScrollFactor(0);
    this.choiceMenuContainer.setVisible(false);
    this.choiceMenuContainer.setDepth(1000);
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
        returnScene: 'TravelScene',
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
