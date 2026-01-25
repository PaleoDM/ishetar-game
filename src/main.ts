import Phaser from 'phaser';
import { GAME_CONFIG } from './config';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { TitleScene } from './scenes/TitleScene';
import { NarratorScene } from './scenes/NarratorScene';
import { IshetarScene1 } from './scenes/IshetarScene1';
import { IshetarScene2 } from './scenes/IshetarScene2';
import { IshetarScene3 } from './scenes/IshetarScene3';
import { TravelScene } from './scenes/TravelScene';
import { BattleScene } from './scenes/BattleScene';
import { TerrainEditorScene } from './scenes/TerrainEditorScene';
import { MenuScene } from './scenes/MenuScene';
import { ExploreScene } from './scenes/ExploreScene';

// Check URL parameters for special modes
const urlParams = new URLSearchParams(window.location.search);
const editorParam = urlParams.get('editor');
const isEditorMode = editorParam !== null; // ?editor or ?editor=mapname
const editorMap = editorParam && editorParam !== 'true' ? editorParam : null; // specific map to open
const isBattleTest = urlParams.get('battle') === 'true';
const isTravelTest = urlParams.get('travel') === 'true';
const isMenuTest = urlParams.get('menu') === 'true';
const isLevelUpTest = urlParams.get('levelup') === 'true';
const battleMap = urlParams.get('map') || 'hellhound_cave'; // Optional: specify which battle
const levelUpHero = urlParams.get('hero') || 'vicas'; // Optional: which hero to show level up for
const levelUpLevel = parseInt(urlParams.get('level') || '2'); // Optional: what level they reached

// Determine which scenes to load based on mode
let scenes: Phaser.Types.Scenes.SceneType[];
let gameWidth: number = GAME_CONFIG.WIDTH;
let gameHeight: number = GAME_CONFIG.HEIGHT;

if (isEditorMode) {
  scenes = [TerrainEditorScene];
  gameWidth = 1200;
  gameHeight = 800;
} else if (isMenuTest) {
  // Menu test mode: PreloadScene loads assets, then jumps directly to MenuScene
  scenes = [BootScene, PreloadScene, MenuScene];
} else if (isLevelUpTest) {
  // Level up test mode: PreloadScene loads assets, then jumps to IshetarScene1 with test level up data
  scenes = [BootScene, PreloadScene, IshetarScene1, MenuScene];
} else if (isBattleTest) {
  // Battle test mode: PreloadScene loads assets, then jumps to BattleScene
  scenes = [BootScene, PreloadScene, BattleScene, IshetarScene2, MenuScene];
} else if (isTravelTest) {
  // Travel test mode: PreloadScene loads assets, then jumps to TravelScene
  scenes = [BootScene, PreloadScene, TravelScene, BattleScene, ExploreScene, IshetarScene2, MenuScene];
} else {
  // Normal game flow
  scenes = [BootScene, PreloadScene, TitleScene, NarratorScene, IshetarScene1, IshetarScene2, TravelScene, BattleScene, ExploreScene, IshetarScene3, MenuScene];
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: gameWidth,
  height: gameHeight,
  parent: 'game-container',
  backgroundColor: '#000000',
  pixelArt: true, // Crucial for 16-bit aesthetic - no antialiasing
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: scenes,
};

const game = new Phaser.Game(config);

// Store test params in registry for scenes to access
if (isBattleTest) {
  game.registry.set('battleTestMode', true);
  game.registry.set('battleMap', battleMap);
}
if (isTravelTest) {
  game.registry.set('travelTestMode', true);
}
if (isMenuTest) {
  game.registry.set('menuTestMode', true);
}
if (isEditorMode && editorMap) {
  game.registry.set('editorMap', editorMap);
}
if (isLevelUpTest) {
  game.registry.set('levelUpTestMode', true);
  game.registry.set('levelUpHero', levelUpHero);
  game.registry.set('levelUpLevel', levelUpLevel);
}
