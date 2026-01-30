import Phaser from 'phaser';
import { GAME_CONFIG } from '../config';
import { InventoryState } from '../data/ItemTypes';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload(): void {
    // Create loading bar
    const width = GAME_CONFIG.WIDTH;
    const height = GAME_CONFIG.HEIGHT;

    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

    const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    });
    loadingText.setOrigin(0.5, 0.5);
    loadingText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Update progress bar as assets load
    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0xffffff, 1);
      progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });

    // Load all game assets here
    this.loadAssets();
  }

  private loadAssets(): void {
    // Portraits
    this.load.image('portrait_miss_tibbets', 'assets/portraits/miss_tibbets.png');
    this.load.image('portrait_vicas', 'assets/portraits/vicas.png');
    this.load.image('portrait_azrael', 'assets/portraits/azrael.png');
    this.load.image('portrait_lyra', 'assets/portraits/lyra.png');
    this.load.image('portrait_thump', 'assets/portraits/thump.png');
    this.load.image('portrait_rooker', 'assets/portraits/rooker.png');
    this.load.image('portrait_rowena', 'assets/portraits/rowena.png');
    this.load.image('portrait_meris', 'assets/portraits/meris.png');
    this.load.image('portrait_vessan', 'assets/portraits/vessan.png');
    this.load.image('portrait_sombra', 'assets/portraits/sombra.png');

    // Title screen
    this.load.image('title_screen', 'assets/title_screen.png');

    // Maps
    this.load.image('map_ishetar_town', 'assets/maps/ishetar_new.jpg');
    this.load.image('map_south_gate', 'assets/maps/south_gate.png');
    this.load.image('map_travel', 'assets/maps/travel.jpg');
    this.load.image('map_hunting_paths', 'assets/maps/hunting_paths.png');
    this.load.image('map_quetzi_shrine', 'assets/maps/quetzi_shrine.png');
    this.load.image('map_hellhound_cave', 'assets/maps/hellhound_cave.png');
    this.load.image('map_maple_tree', 'assets/maps/maple_tree.png');

    // Hero sprites (4 directions each)
    const heroes = ['vicas', 'azrael', 'lyra', 'thump', 'rooker'];
    const directions = ['front', 'back', 'left', 'right'];

    heroes.forEach((hero) => {
      directions.forEach((dir) => {
        this.load.image(`sprite_${hero}_${dir}`, `assets/sprites/heroes/${hero}_${dir}.png`);
      });
    });

    // NPC sprites
    this.load.image('sprite_rowena_front', 'assets/sprites/npcs/rowena_front.png');
    this.load.image('sprite_guard_front', 'assets/sprites/npcs/guard_front.png');
    this.load.image('sprite_villager_male_front', 'assets/sprites/npcs/villager_male_front.png');
    this.load.image('sprite_villager_female_front', 'assets/sprites/npcs/villager_female_front.png');
    this.load.image('sprite_child_male_front', 'assets/sprites/npcs/child_male_front.png');
    this.load.image('sprite_child_female_front', 'assets/sprites/npcs/child_female_front.png');
    this.load.image('sprite_pelor_front', 'assets/sprites/npcs/pelor_front.png');

    // Meris sprites (all 4 directions for victory cutscene)
    this.load.image('sprite_meris_front', 'assets/sprites/npcs/meris_front.png');
    this.load.image('sprite_meris_back', 'assets/sprites/npcs/meris_back.png');
    this.load.image('sprite_meris_left', 'assets/sprites/npcs/meris_left.png');
    this.load.image('sprite_meris_right', 'assets/sprites/npcs/meris_right.png');

    // Quetzi sprites (all 4 directions for Quetzi Shrine battle)
    this.load.image('sprite_quetzi_front', 'assets/sprites/npcs/quetzi_front.png');
    this.load.image('sprite_quetzi_back', 'assets/sprites/npcs/quetzi_back.png');
    this.load.image('sprite_quetzi_left', 'assets/sprites/npcs/quetzi_left.png');
    this.load.image('sprite_quetzi_right', 'assets/sprites/npcs/quetzi_right.png');

    // Sombra sprites (all 4 directions)
    this.load.image('sprite_sombra_front', 'assets/sprites/npcs/sombra_front.png');
    this.load.image('sprite_sombra_back', 'assets/sprites/npcs/sombra_back.png');
    this.load.image('sprite_sombra_left', 'assets/sprites/npcs/sombra_left.png');
    this.load.image('sprite_sombra_right', 'assets/sprites/npcs/sombra_right.png');

    // Object sprites (chests, etc.) - 4 directions
    this.load.image('sprite_chest_closed_front', 'assets/sprites/objects/chest_closed_front.png');
    this.load.image('sprite_chest_closed_back', 'assets/sprites/objects/chest_closed_back.png');
    this.load.image('sprite_chest_closed_left', 'assets/sprites/objects/chest_closed_left.png');
    this.load.image('sprite_chest_closed_right', 'assets/sprites/objects/chest_closed_right.png');

    // Data files
    this.load.json('data_dialogues', 'data/dialogues.json');
    this.load.json('data_heroes', 'data/heroes.json');
    this.load.json('data_map_ishetar', 'data/maps/ishetar_new.json');
    this.load.json('data_map_travel', 'data/maps/travel.json');

    // Battle system data
    this.load.json('data_enemies', 'data/enemies.json');
    this.load.json('data_abilities', 'data/abilities.json');
    this.load.json('data_items', 'data/items.json');
    this.load.json('data_battle_south_gate', 'data/battles/south_gate.json');
    this.load.json('data_battle_hunting_paths', 'data/battles/hunting_paths.json');
    this.load.json('data_battle_quetzi_shrine', 'data/battles/quetzi_shrine.json');
    this.load.json('data_battle_hellhound_cave', 'data/battles/hellhound_cave.json');
    this.load.json('data_battle_maple_tree', 'data/battles/maple_tree.json');

    // Audio / Music
    this.load.audio('music_title', 'assets/audio/title_screen.mp3');
    this.load.audio('music_town', 'assets/audio/town.mp3');
    this.load.audio('music_travel', 'assets/audio/travel.mp3');
    this.load.audio('music_combat', 'assets/audio/combat.mp3');

    // Enemy sprites (4 directions each)
    const enemies = ['lemure', 'imp', 'spined_devil', 'ogre_brute', 'ogre_hunter', 'ogre_shaman', 'vessan', 'divine_wisp', 'divine_wisp_dark', 'hellhound', 'death_dog'];
    const enemyDirections = ['front', 'back', 'left', 'right'];

    enemies.forEach((enemy) => {
      enemyDirections.forEach((dir) => {
        this.load.image(`sprite_${enemy}_${dir}`, `assets/sprites/enemies/${enemy}_${dir}.png`);
      });
    });
  }

  create(): void {
    // Set LINEAR filtering on portrait textures for smooth downscaling
    // (The game uses pixelArt: true globally, which is NEAREST - great for sprites, but
    // makes high-res portraits look blocky. This overrides just the portraits.)
    const portraitKeys = [
      'portrait_miss_tibbets',
      'portrait_vicas',
      'portrait_azrael',
      'portrait_lyra',
      'portrait_thump',
      'portrait_rooker',
      'portrait_rowena',
      'portrait_meris',
      'portrait_sombra',
    ];
    portraitKeys.forEach((key) => {
      const texture = this.textures.get(key);
      if (texture) {
        // Set filter mode via texture API
        texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        // Also directly set scaleMode on texture source for more reliable override of pixelArt: true
        const source = texture.source[0];
        if (source) {
          source.scaleMode = Phaser.ScaleModes.LINEAR;
          // If WebGL renderer, also update the GL texture filter
          if (source.glTexture && this.game.renderer.type === Phaser.WEBGL) {
            (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).setTextureFilter(
              source.glTexture,
              Phaser.Textures.FilterMode.LINEAR
            );
          }
        }
      }
    });

    // Check if we're in a test mode
    const isBattleTest = this.registry.get('battleTestMode');
    const isTravelTest = this.registry.get('travelTestMode');
    const isMenuTest = this.registry.get('menuTestMode');
    const isLevelUpTest = this.registry.get('levelUpTestMode');

    if (isLevelUpTest) {
      // Jump straight to IshetarScene1 - it will read the levelUpTestMode from registry
      this.scene.start('IshetarScene1', {
        heroId: 'vicas',
      });
    } else if (isMenuTest) {
      // Jump straight to menu scene with test party (all 5 heroes)
      const testHeroState = {
        vicas: { level: 2, xp: 75, currentHp: 18, currentMana: 8, equipment: 'ambushers_ring' as const },
        azrael: { level: 1, xp: 30, currentHp: 12, currentMana: null, currentKi: 10, equipment: 'swift_anklet' as const },
        lyra: { level: 1, xp: 45, currentHp: 8, currentMana: 15, equipment: 'healers_pendant' as const },
        thump: { level: 1, xp: 20, currentHp: 10, currentMana: 10 },
        rooker: { level: 1, xp: 15, currentHp: 14, currentMana: null, permanentBonuses: { damageBonus: 2 } },
      };
      const testInventory: InventoryState = {
        consumables: {
          healing_potion: 5,
          distilled_dendritium: 2,
          antidote: 1,
          celestial_tears: 1,
        },
        equipment: {
          unequipped: ['wardstone', 'bloodstone'],
          obtained: ['ambushers_ring', 'swift_anklet', 'healers_pendant', 'wardstone', 'bloodstone'],
        },
        damageRunes: 1,
      };
      this.scene.start('MenuScene', {
        heroState: testHeroState,
        returnScene: 'PreloadScene',
        inventory: testInventory,
      });
    } else if (isBattleTest) {
      // Jump straight to battle scene (dev mode enabled for testing)
      const battleMap = this.registry.get('battleMap') || 'south_gate';

      // Create test inventory with items for testing
      const testInventory: InventoryState = {
        consumables: {
          healing_potion: 3,
          distilled_dendritium: 2,
          antidote: 2,
          celestial_tears: 1,
        },
        equipment: {
          unequipped: [],
          obtained: ['swift_anklet', 'ambushers_ring', 'healers_pendant', 'wardstone', 'bloodstone'],
        },
        damageRunes: 1,
      };

      // Create test hero state with equipment for testing
      const testHeroState = {
        vicas: { level: 2, xp: 75, currentHp: 18, currentMana: null, currentKi: 10, equipment: 'ambushers_ring' as const },
        azrael: { level: 1, xp: 30, currentHp: 12, currentMana: null, currentKi: 10, equipment: 'swift_anklet' as const },
        lyra: { level: 1, xp: 45, currentHp: 10, currentMana: 15, equipment: 'healers_pendant' as const },
        thump: { level: 1, xp: 20, currentHp: 10, currentMana: 10, equipment: 'wardstone' as const },
        rooker: { level: 1, xp: 15, currentHp: 14, currentMana: null, equipment: 'bloodstone' as const },
      };

      this.scene.start('BattleScene', {
        battleMap: battleMap,
        heroId: 'vicas',
        devMode: true,
        inventory: testInventory,
        heroState: testHeroState,
      });
    } else if (isTravelTest) {
      // Jump straight to travel scene for testing
      this.scene.start('TravelScene', {
        heroId: 'vicas',
      });
    } else {
      // Normal game flow - show launch button to unlock audio context
      this.showLaunchButton();
    }
  }

  private showLaunchButton(): void {
    const width = GAME_CONFIG.WIDTH;
    const height = GAME_CONFIG.HEIGHT;

    // Create launch button background
    const buttonBg = this.add.graphics();
    buttonBg.fillStyle(0x222222, 0.9);
    buttonBg.fillRoundedRect(width / 2 - 100, height / 2 - 25, 200, 50, 8);
    buttonBg.lineStyle(2, 0xffffff, 1);
    buttonBg.strokeRoundedRect(width / 2 - 100, height / 2 - 25, 200, 50, 8);

    // Create launch button text
    const launchText = this.add.text(width / 2, height / 2, 'Click to Launch', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
    });
    launchText.setOrigin(0.5, 0.5);
    launchText.setResolution(GAME_CONFIG.TEXT_RESOLUTION);

    // Make the button interactive
    const hitArea = this.add.rectangle(width / 2, height / 2, 200, 50, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });

    // Hover effect
    hitArea.on('pointerover', () => {
      launchText.setColor('#ffff00');
    });
    hitArea.on('pointerout', () => {
      launchText.setColor('#ffffff');
    });

    // Click to launch
    hitArea.on('pointerdown', () => {
      // Start music (user has now interacted, so audio context is unlocked)
      this.sound.play('music_title', { loop: true, volume: 0.5 });
      // Transition to title screen
      this.scene.start('TitleScene');
    });
  }
}
