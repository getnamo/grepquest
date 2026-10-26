import * as THREE from 'three';
import { COVERS, GATES, patrols, distance } from './model.ts';
import type { Game, Vec } from './model.ts';
const CYAN = 0x39e7f5, RED = 0xff4468, PINK = 0xe16dff, GREEN = 0x99ffd0;
function lineBox(w: number, h: number, d: number, color: number) {
  return new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .65 }));
}
function solid(w: number, h: number, d: number, color: number) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: .35 }));
}
function label(text: string, color: string, size = 4) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '500 36px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(text, 256, 58);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(size, size * 96 / 512, 1); return sprite;
}
function runner(color: number) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x0d2637, emissive: color, emissiveIntensity: .45, roughness: .3 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(.7, 1.05, .4), material); torso.position.y = 1.3; group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), material); head.position.y = 2.1; group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.4, .08, .52), new THREE.MeshBasicMaterial({ color })); visor.position.y = 2.12; group.add(visor);
  const legs: THREE.Mesh[] = [];
  for (const x of [-.23, .23]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.22, .8, .25), material); leg.position.set(x, .4, 0); group.add(leg); legs.push(leg); }
  const ring = new THREE.Mesh(new THREE.RingGeometry(.65, .73, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .7 })); ring.rotation.x = -Math.PI / 2; ring.position.y = .04; group.add(ring);
  const glow = new THREE.PointLight(color, 3, 5); glow.position.y = 1.2; group.add(glow);
  group.userData.legs = legs; return group;
}
export class CyberWorld {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(49, 1, .1, 190);
  scene = new THREE.Scene();
  player = runner(CYAN); rival = runner(PINK);
  nodes: THREE.Group[] = []; gates: THREE.Group[] = []; sentinels: THREE.Group[] = [];
  private observer: ResizeObserver;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private lastPosition: Vec = { x: 0, z: 23 };
  private cameraReady = false;
  private target = new THREE.Mesh(new THREE.RingGeometry(.6, .72, 32), new THREE.MeshBasicMaterial({ color: CYAN, side: THREE.DoubleSide, transparent: true, opacity: .8 }));
  constructor(readonly host: HTMLElement, readonly onDestination: (point: Vec) => void, game: Game) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x070e1c); this.scene.fog = new THREE.FogExp2(0x080f20, .018);
    this.renderer.domElement.setAttribute('aria-label', 'Three-dimensional cyberspace grid. Use WASD or tap the ground to move.');
    this.renderer.domElement.tabIndex = 0; this.host.append(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0x668cbd, 1.7));
    const key = new THREE.DirectionalLight(0x75c6ff, 2.4); key.position.set(-15, 35, 20); this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(54, 82), new THREE.MeshStandardMaterial({ color: 0x0a1828, metalness: .7, roughness: .3 })); floor.rotation.x = -Math.PI / 2; floor.position.set(0, -.08, -12); this.scene.add(floor);
    const grid = new THREE.GridHelper(110, 55, 0x267489, 0x14374b); grid.position.set(0, -.04, -15); this.scene.add(grid);
    for (const x of [-25, 25]) { const edge = new THREE.Mesh(new THREE.BoxGeometry(.08, .06, 76), new THREE.MeshBasicMaterial({ color: CYAN })); edge.position.set(x, .02, -12); this.scene.add(edge); }
    for (const cover of COVERS) { const group = new THREE.Group(); const mesh = solid(cover.w, cover.h, cover.d, 0x112335); mesh.position.y = cover.h / 2; group.add(mesh); const edge = lineBox(cover.w, cover.h, cover.d, 0x377887); edge.position.y = cover.h / 2; group.add(edge); group.position.set(cover.x, 0, cover.z); this.scene.add(group); }
    // Distant monoliths and data lights form the city without downloaded assets.
    for (let i = 0; i < 40; i++) {
      const side = i % 2 ? 1 : -1, height = 5 + ((i * 17) % 23);
      const tower = solid(3 + i % 4, height, 4, 0x0a1527); tower.position.set(side * (29 + (i % 4) * 4), height / 2, 25 - i * 2.2); this.scene.add(tower);
      const outline = lineBox(3 + i % 4, height, 4, i % 3 ? 0x15455f : 0x52519b); outline.position.copy(tower.position); this.scene.add(outline);
    }
    const starPositions: number[] = [];
    for (let i = 0; i < 250; i++) starPositions.push(Math.sin(i * 51.7) * 75, 4 + ((i * 13) % 50), Math.cos(i * 83.2) * 80 - 20);
    const stars = new THREE.BufferGeometry(); stars.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    this.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x72c5e8, size: .1, transparent: true, opacity: .65 })));
    game.objectives.forEach((objective, index) => {
      const group = new THREE.Group(); group.position.set(objective.position.x, 0, objective.position.z);
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, .4, 6), new THREE.MeshStandardMaterial({ color: 0x12374a, emissive: 0x123044, emissiveIntensity: .5 })); platform.position.y = .12; group.add(platform);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, .045, 6, 48), new THREE.MeshBasicMaterial({ color: CYAN })); ring.rotation.x = Math.PI / 2; ring.position.y = .4; group.add(ring);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.9), new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.2, wireframe: true })); gem.position.y = 2.4; group.add(gem); group.userData.gem = gem;
      const column = new THREE.Mesh(new THREE.CylinderGeometry(.25, .9, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0x17344c, metalness: .8, roughness: .25 })); column.position.y = 1.1; group.add(column);
      const title = label(`${String(index + 1).padStart(2, '0')} / ${objective.name}`, '#70eaf5', 5); title.position.y = 4.1; group.add(title);
      const light = new THREE.PointLight(CYAN, 6, 9); light.position.y = 2; group.add(light); group.userData.light = light;
      group.userData.ring = ring; this.nodes.push(group); this.scene.add(group);
    });
    for (const z of GATES) {
      const group = new THREE.Group(); group.position.z = z;
      for (const x of [-24.5, 24.5]) { const post = solid(.5, 4, .6, 0x2c1a37); post.position.set(x, 2, 0); group.add(post); }
      const barrier = new THREE.Mesh(new THREE.PlaneGeometry(49, 3), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: .11, side: THREE.DoubleSide, depthWrite: false })); barrier.position.y = 1.5; group.add(barrier);
      for (const y of [.2, .8, 1.4, 2, 2.6, 3.2]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(49, .025, .025), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: .7 })); beam.position.y = y; group.add(beam); }
      this.gates.push(group); this.scene.add(group);
    }
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      const eye = new THREE.Mesh(new THREE.OctahedronGeometry(.7), new THREE.MeshStandardMaterial({ color: RED, emissive: RED, emissiveIntensity: 1.5 })); eye.position.y = 2.7; group.add(eye);
      const vertices = [0, .025, 0];
      const range = 9;
      for (let j = 0; j <= 24; j++) { const angle = -.52 + j / 24 * 1.04; vertices.push(Math.sin(angle) * range, .025, Math.cos(angle) * range); }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const indices: number[] = []; for (let j = 1; j <= 24; j++) indices.push(0, j, j + 1); geometry.setIndex(indices);
      group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
      const light = new THREE.PointLight(RED, 4, 9); light.position.y = 2.5; group.add(light); this.sentinels.push(group); this.scene.add(group);
    }
    const userLabel = label('YOU', '#88f6ff', 2); userLabel.position.y = 3; this.player.add(userLabel);
    const botLabel = label('ECHO-9', '#ed9aff', 2.5); botLabel.position.y = 3; this.rival.add(botLabel);
    this.scene.add(this.player, this.rival);
    this.target.rotation.x = -Math.PI / 2; this.target.position.y = .03; this.target.visible = false; this.scene.add(this.target);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
    this.renderer.domElement.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      const point = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(this.plane, point)) this.onDestination({ x: point.x, z: point.z });
    });
  }
  private resize() { const w = this.host.clientWidth, h = this.host.clientHeight; this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }
  showDestination(point?: Vec) { this.target.visible = !!point; if (point) this.target.position.set(point.x, .03, point.z); }
  render(game: Game, time: number) {
    const moving = distance(this.lastPosition, game.position) > .002;
    this.player.position.set(game.position.x, Math.sin(time * 2) * .035, game.position.z);
    if (moving) this.player.rotation.y = Math.atan2(game.position.x - this.lastPosition.x, game.position.z - this.lastPosition.z);
    (this.player.userData.legs as THREE.Mesh[]).forEach((leg, i) => leg.rotation.x = moving ? Math.sin(time * 13 + i * Math.PI) * .5 : 0);
    this.lastPosition = { ...game.position };
    this.rival.position.set(game.bot.position.x, 0, game.bot.position.z);
    if (game.bot.stage < game.objectives.length) this.rival.rotation.y = Math.atan2(game.objectives[game.bot.stage].position.x - game.bot.position.x, game.objectives[game.bot.stage].position.z - game.bot.position.z);
    this.nodes.forEach((node, i) => {
      const color = i < game.stage ? GREEN : i === game.stage ? CYAN : 0x515b94;
      const gem = node.userData.gem as THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
      gem.rotation.y = time * .6; gem.position.y = 2.4 + Math.sin(time * 2 + i) * .15; gem.material.color.setHex(color); gem.material.emissive.setHex(color);
      (node.userData.ring as THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>).material.color.setHex(color);
      (node.userData.light as THREE.PointLight).color.setHex(color);
    });
    this.gates.forEach((gate, i) => gate.visible = i >= game.stage);
    patrols(game).forEach((patrol, i) => { this.sentinels[i].visible = !patrol.disabled; this.sentinels[i].position.set(patrol.position.x, Math.sin(time * 3 + i) * .08, patrol.position.z); this.sentinels[i].rotation.y = patrol.angle; });
    const mobile = this.host.clientWidth < 700;
    const desired = new THREE.Vector3(game.position.x, mobile ? 32 : 27, game.position.z + (mobile ? 27 : 24));
    if (!this.cameraReady) { this.camera.position.copy(desired); this.cameraReady = true; } else this.camera.position.lerp(desired, .07);
    this.camera.lookAt(game.position.x, 0, game.position.z - 7);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.observer.disconnect(); this.scene.traverse(object => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) { const map = (material as THREE.MeshBasicMaterial).map; map?.dispose(); material.dispose(); } }); this.renderer.dispose(); }
}
