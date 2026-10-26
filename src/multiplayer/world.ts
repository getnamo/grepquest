import * as THREE from 'three';
import { runner, label, solid, lineBox } from '../cyber/world.ts';
import { laneAngle, polar, nodePosition, NODE_RADII, LAYERS, arenaCovers, arenaPatrols, NODE_NAMES } from './arena.ts';
import type { RaceSnapshot } from './arena.ts';
import type { Vec } from '../cyber/model.ts';
function ring(r: number, color: number, thickness = .035, start = 0, length = Math.PI * 2) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, thickness, 4, 128, length), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .65 }));
  mesh.rotation.set(Math.PI / 2, 0, start); mesh.position.y = .06; return mesh;
}
export class ArenaWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, .1, 210);
  private actors = new Map<string, THREE.Group>();
  private gates: { mesh: THREE.Group; owner: string; layer: number }[] = [];
  private nodes: { mesh: THREE.Group; owner: string; stage: number }[] = [];
  private patrols: THREE.Group[] = [];
  private observer: ResizeObserver;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private cameraReady = false;
  constructor(readonly host: HTMLElement, readonly selfId: string, snapshot: RaceSnapshot, onMove: (point: Vec) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.setClearColor(0x060d19); this.scene.fog = new THREE.FogExp2(0x081323, .012);
    this.renderer.domElement.setAttribute('aria-label', 'Circular multiplayer cyberspace arena. Tap the ground to move.'); this.renderer.domElement.tabIndex = 0;
    host.replaceChildren(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0x6a91ba, 1.9)); const light = new THREE.DirectionalLight(0x8fdcff, 2.5); light.position.set(10, 40, 20); this.scene.add(light);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(48, 48, .4, 96), new THREE.MeshStandardMaterial({ color: 0x0b192b, roughness: .45, metalness: .6 })); floor.position.y = -.3; this.scene.add(floor);
    const grid = new THREE.GridHelper(96, 48, 0x245975, 0x15334a); grid.position.y = -.07; this.scene.add(grid);
    for (const r of [47, ...LAYERS, 2]) this.scene.add(ring(r, r === 47 ? 0x58c5dd : 0x345774, r === 47 ? .08 : .035));
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16, height = 5 + i * 7 % 14, point = polar(51 + i % 3 * 3, angle);
      const tower = solid(3, height, 3, 0x0c1b2d); tower.position.set(point.x, height / 2, point.z); this.scene.add(tower);
      const edges = lineBox(3, height, 3, 0x244b72); edges.position.copy(tower.position); this.scene.add(edges);
    }
    for (const c of arenaCovers(snapshot.capacity)) {
      const box = solid(c.w, c.h, c.d, 0x102a3a); box.position.set(c.x, c.h / 2, c.z); this.scene.add(box);
      const edges = lineBox(c.w, c.h, c.d, 0x356b7d); edges.position.copy(box.position); this.scene.add(edges);
    }
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x6ef7ff, emissiveIntensity: 1, wireframe: true })); core.position.y = 5; this.scene.add(core);
    const coreLabel = label('THE CORE', '#c0f7ff', 5); coreLabel.position.y = 9; this.scene.add(coreLabel);
    for (const racer of snapshot.racers) {
      const color = new THREE.Color(racer.color), actor = runner(color.getHex());
      actor.position.set(racer.position.x, 0, racer.position.z);
      const title = label(racer.id === selfId ? `${racer.name} / YOU` : racer.name, racer.color, 3.8); title.position.y = 3.4; actor.add(title); this.actors.set(racer.id, actor); this.scene.add(actor);
      const angle = laneAngle(racer.slot, snapshot.capacity), rayStart = polar(46, angle), rayEnd = polar(3, angle);
      const pathGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(rayStart.x, .02, rayStart.z), new THREE.Vector3(rayEnd.x, .02, rayEnd.z)]);
      this.scene.add(new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .16 })));
      NODE_RADII.forEach((_, stage) => {
        const point = nodePosition(racer.slot, snapshot.capacity, stage), node = new THREE.Group(); node.position.set(point.x, 0, point.z);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, .3, 6), new THREE.MeshStandardMaterial({ color: 0x163448, roughness: .4, metalness: .5 })); pad.position.y = .1; node.add(pad);
        const halo = ring(1.8, color.getHex(), .055); halo.position.y = .3; node.add(halo);
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.65), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1, wireframe: true })); gem.position.y = 2; node.add(gem); node.userData.gem = gem;
        const base = solid(.65, 1.3, .65, 0x16384a); base.position.y = .7; node.add(base);
        const text = label(`${stage + 1} / ${NODE_NAMES[stage]}`, racer.color, 4); text.position.y = 3.6; node.add(text);
        this.nodes.push({ mesh: node, owner: racer.id, stage }); this.scene.add(node);
      });
      LAYERS.forEach((r, layer) => {
        const group = new THREE.Group(), span = Math.PI * 2 / snapshot.capacity - .04, from = angle - span / 2;
        // Three world-space laser arcs outline each runner's personal access layer.
        for (const y of [.3, 1.1, 1.9]) {
          const points = Array.from({ length: 65 }, (_, i) => { const p = polar(r, from + span * i / 64); return new THREE.Vector3(p.x, y, p.z); });
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .35 })));
        }
        this.gates.push({ mesh: group, owner: racer.id, layer }); this.scene.add(group);
      });
    }
    for (let i = 0; i < snapshot.capacity * 3; i++) {
      const group = new THREE.Group(); const eye = new THREE.Mesh(new THREE.OctahedronGeometry(.55), new THREE.MeshBasicMaterial({ color: 0xff617c })); eye.position.y = 2.5; group.add(eye);
      const vertices = [0, .025, 0]; for (let j = 0; j <= 20; j++) { const a = -.52 + j / 20 * 1.04; vertices.push(Math.sin(a) * 7, .025, Math.cos(a) * 7); }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); const indices: number[] = []; for (let j = 1; j <= 20; j++) indices.push(0, j, j + 1); geometry.setIndex(indices);
      group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xff4d79, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
      this.patrols.push(group); this.scene.add(group);
    }
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
    this.renderer.domElement.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const bounds = this.renderer.domElement.getBoundingClientRect(); this.ray.setFromCamera(new THREE.Vector2((e.clientX - bounds.left) / bounds.width * 2 - 1, -(e.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
      const point = new THREE.Vector3(); if (this.ray.ray.intersectPlane(this.plane, point)) onMove({ x: point.x, z: point.z });
    });
  }
  private resize() { const w = this.host.clientWidth, h = this.host.clientHeight; this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix(); }
  render(snapshot: RaceSnapshot, dt = 1 / 60) {
    const self = snapshot.racers.find(p => p.id === this.selfId); if (!self) return;
    for (const racer of snapshot.racers) {
      const actor = this.actors.get(racer.id)!; const previous = actor.position.clone(); actor.position.set(racer.position.x, 0, racer.position.z);
      const moving = previous.distanceTo(actor.position) > .001;
      if (moving) actor.rotation.y = Math.atan2(actor.position.x - previous.x, actor.position.z - previous.z);
      (actor.userData.legs as THREE.Mesh[]).forEach((leg, i) => leg.rotation.x = moving ? Math.sin(snapshot.elapsed * 13 + i * Math.PI) * .5 : 0);
      actor.visible = !racer.dnf;
    }
    for (const gate of this.gates) gate.mesh.visible = snapshot.racers.find(p => p.id === gate.owner)!.stage <= gate.layer;
    for (const node of this.nodes) {
      const racer = snapshot.racers.find(p => p.id === node.owner)!;
      const gem = node.mesh.userData.gem as THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
      gem.rotation.y = snapshot.elapsed * .7;
      gem.material.emissive.set(racer.stage > node.stage ? '#a1ffcf' : racer.color); gem.material.emissiveIntensity = racer.stage === node.stage ? 1.4 : .5;
    }
    arenaPatrols(snapshot).forEach((p, i) => { this.patrols[i].visible = !p.disabled; this.patrols[i].position.set(p.position.x, 0, p.position.z); this.patrols[i].rotation.y = p.angle; });
    const angle = laneAngle(self.slot, snapshot.capacity), actor = this.actors.get(self.id)!;
    const offset = polar(this.host.clientWidth < 700 ? 24 : 21, angle), look = polar(7, angle);
    const desired = new THREE.Vector3(actor.position.x + offset.x, this.host.clientWidth < 700 ? 28 : 24, actor.position.z + offset.z);
    if (!this.cameraReady) { this.camera.position.copy(desired); this.cameraReady = true; } else this.camera.position.lerp(desired, 1 - Math.exp(-9 * dt));
    this.camera.lookAt(actor.position.x - look.x, 0, actor.position.z - look.z); this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.observer.disconnect(); this.scene.traverse(object => { const mesh = object as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) { (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose(); } }); this.renderer.dispose(); this.host.replaceChildren(); }
}
